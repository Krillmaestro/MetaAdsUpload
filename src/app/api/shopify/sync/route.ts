import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { fetchOrdersInRange } from "@/lib/shopify/client";
import { eq, and, sql } from "drizzle-orm";
import { format, eachDayOfInterval, parseISO } from "date-fns";
import { isElevated } from "@/lib/access";

export const dynamic = "force-dynamic";

interface DailyBucket {
  totalOrders: number;
  totalRevenue: number;
  newCustomerOrders: number;
  newCustomerRevenue: number;
  returningCustomerOrders: number;
  returningCustomerRevenue: number;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { from, to } = body as { from: string; to: string };

    if (!from || !to) {
      return NextResponse.json({ error: "Missing 'from' and 'to' date strings (YYYY-MM-DD)" }, { status: 400 });
    }

    // 1. Fetch all orders from Shopify (now includes UTM data)
    const orders = await fetchOrdersInRange(from, to);

    // 2. Upsert each order into shopify_orders (per-order storage with UTM)
    let upsertedOrders = 0;
    for (const order of orders) {
      const orderDate = format(parseISO(order.createdAt), "yyyy-MM-dd");
      const shopifyOrderId = String(order.id);

      const existing = await db
        .select({ id: schema.shopifyOrders.id })
        .from(schema.shopifyOrders)
        .where(eq(schema.shopifyOrders.shopifyOrderId, shopifyOrderId))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(schema.shopifyOrders)
          .set({
            orderDate,
            totalPrice: order.totalPrice,
            isNewCustomer: order.isNewCustomer,
            customerId: order.customerId,
            customerEmail: order.customerEmail,
            utmCampaign: order.utm.utmCampaign,
            utmAdset: order.utm.utmAdset,
            utmAd: order.utm.utmAd,
            utmSource: order.utm.utmSource,
            utmMedium: order.utm.utmMedium,
            syncedAt: new Date(),
          })
          .where(eq(schema.shopifyOrders.shopifyOrderId, shopifyOrderId));
      } else {
        await db.insert(schema.shopifyOrders).values({
          shopifyOrderId,
          orderDate,
          totalPrice: order.totalPrice,
          isNewCustomer: order.isNewCustomer,
          customerId: order.customerId,
          customerEmail: order.customerEmail,
          utmCampaign: order.utm.utmCampaign,
          utmAdset: order.utm.utmAdset,
          utmAd: order.utm.utmAd,
          utmSource: order.utm.utmSource,
          utmMedium: order.utm.utmMedium,
        });
      }
      upsertedOrders++;
    }

    // 3. Bucket orders by day for daily stats
    const buckets = new Map<string, DailyBucket>();

    const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
    for (const day of days) {
      const dateStr = format(day, "yyyy-MM-dd");
      buckets.set(dateStr, {
        totalOrders: 0,
        totalRevenue: 0,
        newCustomerOrders: 0,
        newCustomerRevenue: 0,
        returningCustomerOrders: 0,
        returningCustomerRevenue: 0,
      });
    }

    for (const order of orders) {
      const dateStr = format(parseISO(order.createdAt), "yyyy-MM-dd");
      let bucket = buckets.get(dateStr);
      if (!bucket) {
        bucket = {
          totalOrders: 0,
          totalRevenue: 0,
          newCustomerOrders: 0,
          newCustomerRevenue: 0,
          returningCustomerOrders: 0,
          returningCustomerRevenue: 0,
        };
        buckets.set(dateStr, bucket);
      }

      bucket.totalOrders++;
      bucket.totalRevenue += order.totalPrice;

      if (order.isNewCustomer) {
        bucket.newCustomerOrders++;
        bucket.newCustomerRevenue += order.totalPrice;
      } else {
        bucket.returningCustomerOrders++;
        bucket.returningCustomerRevenue += order.totalPrice;
      }
    }

    // 4. Upsert into shopify_daily_stats
    let syncedDays = 0;
    let summaryNewOrders = 0;
    let summaryTotalOrders = 0;
    let summaryNewRevenue = 0;
    let summaryTotalRevenue = 0;

    for (const [dateStr, bucket] of buckets) {
      const existing = await db
        .select()
        .from(schema.shopifyDailyStats)
        .where(eq(schema.shopifyDailyStats.date, dateStr))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(schema.shopifyDailyStats)
          .set({
            totalOrders: bucket.totalOrders,
            totalRevenue: bucket.totalRevenue,
            newCustomerOrders: bucket.newCustomerOrders,
            newCustomerRevenue: bucket.newCustomerRevenue,
            returningCustomerOrders: bucket.returningCustomerOrders,
            returningCustomerRevenue: bucket.returningCustomerRevenue,
            syncedAt: new Date(),
          })
          .where(eq(schema.shopifyDailyStats.date, dateStr));
      } else {
        await db.insert(schema.shopifyDailyStats).values({
          date: dateStr,
          totalOrders: bucket.totalOrders,
          totalRevenue: bucket.totalRevenue,
          newCustomerOrders: bucket.newCustomerOrders,
          newCustomerRevenue: bucket.newCustomerRevenue,
          returningCustomerOrders: bucket.returningCustomerOrders,
          returningCustomerRevenue: bucket.returningCustomerRevenue,
        });
      }

      syncedDays++;
      summaryTotalOrders += bucket.totalOrders;
      summaryNewOrders += bucket.newCustomerOrders;
      summaryTotalRevenue += bucket.totalRevenue;
      summaryNewRevenue += bucket.newCustomerRevenue;

      // 5. Update insights rows with ncROAS for this day
      const spendRows = await db
        .select({ totalSpend: sql<number>`coalesce(sum(${schema.insights.spend}), 0)` })
        .from(schema.insights)
        .where(
          and(
            eq(schema.insights.dateStart, dateStr),
            eq(schema.insights.entityType, "campaign")
          )
        );

      const totalSpend = spendRows[0]?.totalSpend || 0;
      const ncRoas = totalSpend > 0 ? bucket.newCustomerRevenue / totalSpend : null;

      if (bucket.newCustomerRevenue > 0 || ncRoas !== null) {
        await db
          .update(schema.insights)
          .set({
            newCustomerRevenue: bucket.newCustomerRevenue,
            ncRoas: ncRoas,
          })
          .where(eq(schema.insights.dateStart, dateStr));
      }
    }

    // Count orders with UTM data
    const ordersWithUtm = orders.filter((o) => o.utm.utmAdset || o.utm.utmCampaign).length;

    return NextResponse.json({
      synced: true,
      days: syncedDays,
      orders: upsertedOrders,
      ordersWithUtm,
      summary: {
        newOrders: summaryNewOrders,
        totalOrders: summaryTotalOrders,
        newRevenue: Math.round(summaryNewRevenue),
        totalRevenue: Math.round(summaryTotalRevenue),
      },
    });
  } catch (error) {
    console.error("Shopify sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
