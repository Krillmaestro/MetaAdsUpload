import { db, schema } from "@/db";
import { and, eq, gte } from "drizzle-orm";
import { ensureCatalog, matchLineItem } from "./catalog";

const API_VERSION = "2024-01";

type ShopifyLineItem = { title?: string | null; sku?: string | null; quantity: number };
type ShopifyOrder = {
  id: number;
  created_at: string;
  cancelled_at: string | null;
  line_items: ShopifyLineItem[];
};

/** Vercel env values can carry invisible trailing characters — always trim. */
const env = (key: string) => (process.env[key] ?? "").trim();

function getStore(): string {
  const store = env("SHOPIFY_STORE");
  if (!store) throw new Error("SHOPIFY_STORE saknas");
  return store;
}

async function getAccessToken(): Promise<string> {
  const permanent = env("SHOPIFY_ACCESS_TOKEN");
  if (permanent) return permanent;
  const clientId = env("SHOPIFY_CLIENT_ID");
  const clientSecret = env("SHOPIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("SHOPIFY_CLIENT_ID/SECRET saknas i miljön");
  const res = await fetch(`https://${getStore()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Shopify nekade inloggningen (${res.status}): ${detail}`);
  }
  return (await res.json()).access_token as string;
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  const m = link.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/**
 * Pull orders and roll them up to units sold per product per day.
 *
 * Shopify only serves the last 60 days of orders without the read_all_orders scope,
 * so history is capped there; everything older survives in inventory_sales_daily
 * because rows are upserted, never replaced wholesale.
 */
export async function syncSales(days = 60): Promise<{ days: number; orders: number; rows: number; unmatched: string[] }> {
  const products = await ensureCatalog();
  const token = await getAccessToken();
  const store = getStore();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  let url: string | null =
    `https://${store}/admin/api/${API_VERSION}/orders.json?status=any&limit=250` +
    `&created_at_min=${encodeURIComponent(since)}&fields=id,created_at,cancelled_at,line_items`;

  const perDay = new Map<string, { units: number; orders: Set<number> }>();
  const unmatched = new Map<string, number>();
  let orderCount = 0;
  let page = 0;

  while (url && page < 60) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify orders ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { orders: ShopifyOrder[] };
    for (const order of body.orders ?? []) {
      if (order.cancelled_at) continue;
      orderCount++;
      const day = order.created_at.slice(0, 10);
      for (const line of order.line_items ?? []) {
        const productId = matchLineItem(line, products);
        if (!productId) {
          const t = (line.title ?? "okänd").slice(0, 60);
          if (!/svenska guiden|leverans skydd|e-bok|tandvårdsguiden/i.test(t)) {
            unmatched.set(t, (unmatched.get(t) ?? 0) + line.quantity);
          }
          continue;
        }
        const key = `${productId}|${day}`;
        const slot = perDay.get(key) ?? { units: 0, orders: new Set<number>() };
        slot.units += line.quantity;
        slot.orders.add(order.id);
        perDay.set(key, slot);
      }
    }
    url = parseNextLink(res.headers.get("link"));
    page++;
  }

  for (const [key, slot] of perDay) {
    const [productId, soldOn] = key.split("|");
    const existing = await db
      .select({ id: schema.inventorySalesDaily.id })
      .from(schema.inventorySalesDaily)
      .where(and(eq(schema.inventorySalesDaily.productId, productId), eq(schema.inventorySalesDaily.soldOn, soldOn)))
      .limit(1);
    if (existing.length) {
      await db
        .update(schema.inventorySalesDaily)
        .set({ units: slot.units, orders: slot.orders.size, syncedAt: new Date() })
        .where(eq(schema.inventorySalesDaily.id, existing[0].id));
    } else {
      await db.insert(schema.inventorySalesDaily).values({ productId, soldOn, units: slot.units, orders: slot.orders.size });
    }
  }

  return {
    days,
    orders: orderCount,
    rows: perDay.size,
    unmatched: [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, q]) => `${t} (${q} st)`),
  };
}

/**
 * Read live stock from Shopify. Needs the read_inventory scope, which the current
 * custom app does not have (403 "requires merchant approval"). Until it is granted
 * this returns null and the page falls back to manual counts.
 */
export async function syncStockFromShopify(): Promise<{ ok: boolean; reason?: string; counted: number }> {
  try {
    const token = await getAccessToken();
    const store = getStore();
    const res = await fetch(`https://${store}/admin/api/${API_VERSION}/locations.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!res.ok) {
      return { ok: false, reason: res.status === 403 ? "read_inventory saknas i appens scopes" : `Shopify ${res.status}`, counted: 0 };
    }
    // Scope exists: wire real inventory_levels here. Kept deliberately small until then.
    return { ok: true, counted: 0 };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "okänt fel", counted: 0 };
  }
}

/** Units sold per product since (and including) a date, straight from the cache. */
export async function soldSince(productId: string, fromDate: string): Promise<number> {
  const rows = await db
    .select({ units: schema.inventorySalesDaily.units })
    .from(schema.inventorySalesDaily)
    .where(and(eq(schema.inventorySalesDaily.productId, productId), gte(schema.inventorySalesDaily.soldOn, fromDate)));
  return rows.reduce((n, r) => n + r.units, 0);
}
