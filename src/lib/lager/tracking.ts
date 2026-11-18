import { db, schema } from "@/db";
import { eq, inArray, sql } from "drizzle-orm";
import { ensureCatalog, matchLineItem } from "./catalog";
import { getAccessToken, getStore } from "./sync";

const API_VERSION = "2025-01";
const STALE_MS = 15 * 60_000;
/** Older unshipped orders are stuck or abandoned; they do not reserve stock. */
const OPEN_ORDER_DAYS = 14;
const DEAD_FULFILLMENT = new Set(["cancelled", "error", "failure"]);

type Line = { id: number; title?: string | null; sku?: string | null; fulfillable_quantity?: number; requires_shipping?: boolean };
type Fulfillment = { id: number; status: string; created_at: string; line_items: { id: number; title?: string | null; sku?: string | null; quantity: number }[] };
type Order = { id: number; line_items: Line[]; fulfillments?: Fulfillment[] };

function nextLink(link: string | null): string | null {
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

async function fetchOrders(first: string, token: string): Promise<Order[]> {
  const out: Order[] = [];
  let url: string | null = first;
  for (let page = 0; url && page < 80; ) {
    const res: Response = await fetch(url, { headers: { "X-Shopify-Access-Token": token }, cache: "no-store" });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify orders ${res.status}: ${(await res.text()).slice(0, 200)}`);
    out.push(...((await res.json()) as { orders: Order[] }).orders);
    url = nextLink(res.headers.get("link"));
    page++;
  }
  return out;
}

/**
 * Keep our own ledger of what has physically left the warehouse: every Shopify
 * fulfillment after the oldest report anchor, plus what open orders have reserved.
 * Incremental and idempotent, so it is safe to run on every page view that is stale.
 */
export async function syncTracking(opts: { since?: Date; ifStale?: boolean } = {}) {
  const catalog = await ensureCatalog();
  const products = await db.select().from(schema.inventoryProducts);
  const counts = await db
    .select({ countedAt: schema.inventoryCounts.countedAt })
    .from(schema.inventoryCounts)
    .where(sql`${schema.inventoryCounts.countedAt} is not null`);
  if (!counts.length) return { skipped: "ingen tidsstämplad rapport än" as string | undefined, shipments: 0, openUnits: 0 };

  const lastSync = products.map((p) => p.trackingSyncedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  if (opts.ifStale && Date.now() - lastSync < STALE_MS) return { skipped: "färskt", shipments: 0, openUnits: 0 };

  const anchor = new Date(Math.min(...counts.map((c) => c.countedAt!.getTime())));
  const since = opts.since ?? (lastSync ? new Date(lastSync - 2 * 3600_000) : anchor);
  const store = getStore();
  const token = await getAccessToken();
  const base = `https://${store}/admin/api/${API_VERSION}/orders.json?limit=250`;

  const updated = await fetchOrders(
    `${base}&status=any&updated_at_min=${encodeURIComponent(since.toISOString())}&fields=id,line_items,fulfillments`,
    token
  );

  const rows = new Map<string, typeof schema.inventoryShipments.$inferInsert>();
  const dead: string[] = [];
  for (const order of updated) {
    const lines = new Map(order.line_items.map((l) => [l.id, l]));
    for (const f of order.fulfillments ?? []) {
      if (DEAD_FULFILLMENT.has(f.status)) {
        dead.push(String(f.id));
        continue;
      }
      const shippedAt = new Date(f.created_at);
      if (shippedAt < anchor) continue;
      for (const item of f.line_items) {
        const productId = matchLineItem(lines.get(item.id) ?? item, catalog);
        if (!productId) continue;
        const key = `${f.id}|${item.id}|${productId}`;
        rows.set(key, {
          productId, shopifyOrderId: String(order.id), fulfillmentId: String(f.id),
          lineItemId: String(item.id), units: item.quantity, shippedAt, syncedAt: new Date(),
        });
      }
    }
  }

  const list = [...rows.values()];
  for (let i = 0; i < list.length; i += 200) {
    await db
      .insert(schema.inventoryShipments)
      .values(list.slice(i, i + 200))
      .onConflictDoUpdate({
        target: [schema.inventoryShipments.fulfillmentId, schema.inventoryShipments.lineItemId, schema.inventoryShipments.productId],
        set: { units: sql`excluded.units`, shippedAt: sql`excluded.shipped_at`, syncedAt: sql`excluded.synced_at` },
      });
  }
  for (let i = 0; i < dead.length; i += 200) {
    await db.delete(schema.inventoryShipments).where(inArray(schema.inventoryShipments.fulfillmentId, dead.slice(i, i + 200)));
  }

  const openSince = new Date(Date.now() - OPEN_ORDER_DAYS * 86400_000).toISOString();
  const open = await fetchOrders(
    `${base}&status=open&fulfillment_status=unfulfilled&created_at_min=${encodeURIComponent(openSince)}&fields=id,line_items`,
    token
  );
  const reserved = new Map<string, number>();
  for (const order of open) {
    for (const line of order.line_items) {
      const qty = line.fulfillable_quantity ?? 0;
      if (qty <= 0 || line.requires_shipping === false) continue;
      const productId = matchLineItem(line, catalog);
      if (productId) reserved.set(productId, (reserved.get(productId) ?? 0) + qty);
    }
  }

  const now = new Date();
  for (const p of products) {
    await db
      .update(schema.inventoryProducts)
      .set({ openUnits: reserved.get(p.id) ?? 0, trackingSyncedAt: now })
      .where(eq(schema.inventoryProducts.id, p.id));
  }
  return { skipped: undefined, shipments: list.length, openUnits: [...reserved.values()].reduce((a, b) => a + b, 0) };
}
