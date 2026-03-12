import { NextRequest, NextResponse } from "next/server";
import { getCampaigns, createCampaign, updateCampaign } from "@/lib/meta/campaigns";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const campaigns = await getCampaigns();

    // Update cache
    for (const c of campaigns) {
      await db
        .insert(schema.campaignsCache)
        .values({
          id: c.id,
          name: c.name,
          status: c.status,
          objective: c.objective,
          dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
          lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
          budgetRemaining: c.budget_remaining ? parseFloat(c.budget_remaining) / 100 : null,
          buyingType: c.buying_type,
          startTime: c.start_time ? new Date(c.start_time) : null,
          stopTime: c.stop_time ? new Date(c.stop_time) : null,
          createdTime: c.created_time ? new Date(c.created_time) : null,
          updatedTime: c.updated_time ? new Date(c.updated_time) : null,
        })
        .onConflictDoUpdate({
          target: schema.campaignsCache.id,
          set: {
            name: c.name,
            status: c.status,
            objective: c.objective,
            dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
            syncedAt: new Date(),
          },
        });
    }

    return NextResponse.json({ data: campaigns });
  } catch (error) {
    console.error("Campaigns API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch campaigns" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await createCampaign(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create campaign" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...params } = body;
    if (!id) return NextResponse.json({ error: "Missing campaign ID" }, { status: 400 });

    await updateCampaign(id, params);

    // Update cache
    if (params.status) {
      await db.update(schema.campaignsCache).set({ status: params.status, syncedAt: new Date() }).where(eq(schema.campaignsCache.id, id));
    }
    if (params.daily_budget) {
      await db.update(schema.campaignsCache).set({ dailyBudget: params.daily_budget / 100, syncedAt: new Date() }).where(eq(schema.campaignsCache.id, id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update campaign" },
      { status: 500 }
    );
  }
}
