import { db, schema } from "@/db";
import { desc, gte } from "drizzle-orm";

export type ProductForecast = {
  id: string;
  code: string;
  name: string;
  unitLabel: string;
  leadTimeMinDays: number;
  leadTimeMaxDays: number;
  safetyDays: number;
  targetCoverDays: number;
  velocityBasisDays: number;
  moq: number;
  unitCost: number | null;
  isActive: boolean;

  velocity: number;      // units per day on the chosen basis
  v7: number;
  v14: number;
  v30: number;
  v60: number;
  trend: number | null;  // v7 vs v30, e.g. 0.18 = 18 % faster this week

  countUnits: number | null;
  countedOn: string | null;
  soldSinceCount: number;
  receivedSinceCount: number;
  stock: number | null;

  incomingUnits: number;
  nextEta: string | null;

  daysCover: number | null;
  stockoutOn: string | null;
  reorderPoint: number;
  orderInDays: number | null;
  orderByOn: string | null;
  suggestedUnits: number;
  suggestedCost: number | null;
  /** How long the suggested order lasts, counted from today, and the date it runs out. */
  suggestedCoversDays: number | null;
  suggestedUntil: string | null;
  /** "rising" when the last week runs well above the basis — then the order is undersized. */
  pace: "rising" | "falling" | "steady";
  status: "order_now" | "soon" | "ok" | "needs_count" | "no_sales";
  salesDays: { date: string; units: number }[];
  shopifyVariantId: string | null;
  shopifyInventoryItemId: string | null;
  shopifyLocationId: string | null;
  shopifySyncedAt: string | null;
  shopifyLastPushedUnits: number | null;
};

const DAY = 86400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (from: Date, n: number) => iso(new Date(from.getTime() + n * DAY));

/** Units per day over the last `window` days, counting every day in the window. */
function velocityOver(sales: Map<string, number>, today: Date, window: number): number {
  let units = 0;
  for (let i = 1; i <= window; i++) {
    const day = addDays(today, -i);
    units += sales.get(day) ?? 0;
  }
  return units / window;
}

export async function buildForecast(): Promise<{ products: ProductForecast[]; generatedAt: string; salesFrom: string | null }> {
  const [products, counts, pos, sales] = await Promise.all([
    db.select().from(schema.inventoryProducts).orderBy(schema.inventoryProducts.sortOrder),
    db.select().from(schema.inventoryCounts).orderBy(desc(schema.inventoryCounts.countedOn)),
    db.select().from(schema.inventoryPurchaseOrders).orderBy(desc(schema.inventoryPurchaseOrders.orderedOn)),
    db
      .select()
      .from(schema.inventorySalesDaily)
      .where(gte(schema.inventorySalesDaily.soldOn, iso(new Date(Date.now() - 120 * DAY)))),
  ]);

  const today = new Date();
  const todayStr = iso(today);
  const byProduct = new Map<string, Map<string, number>>();
  for (const row of sales) {
    const m = byProduct.get(row.productId) ?? new Map<string, number>();
    m.set(row.soldOn, (m.get(row.soldOn) ?? 0) + row.units);
    byProduct.set(row.productId, m);
  }

  const out: ProductForecast[] = products.map((p) => {
    const s = byProduct.get(p.id) ?? new Map<string, number>();
    const v7 = velocityOver(s, today, 7);
    const v14 = velocityOver(s, today, 14);
    const v30 = velocityOver(s, today, 30);
    const v60 = velocityOver(s, today, 60);
    const basis = p.velocityBasisDays;
    const velocity = basis <= 7 ? v7 : basis <= 14 ? v14 : basis <= 30 ? v30 : v60;

    // Newest count is the anchor; sales strictly after that day are subtracted.
    const count = counts.find((c) => c.productId === p.id) ?? null;
    let soldSinceCount = 0;
    let receivedSinceCount = 0;
    let stock: number | null = null;
    if (count) {
      for (const [day, units] of s) if (day > count.countedOn) soldSinceCount += units;
      for (const po of pos) {
        if (po.productId !== p.id || !po.receivedOn) continue;
        // Dates have day resolution, so a delivery booked in on the same day as the
        // count is decided by the clock: it only adds if it was booked after the count.
        const after =
          po.receivedOn > count.countedOn ||
          (po.receivedOn === count.countedOn && po.updatedAt > count.createdAt);
        if (after) receivedSinceCount += po.units;
      }
      stock = count.units - soldSinceCount + receivedSinceCount;
    }

    const open = pos.filter((po) => po.productId === p.id && po.status === "ordered" && !po.receivedOn);
    const incomingUnits = open.reduce((n, po) => n + po.units, 0);
    const etas = open.map((po) => po.etaOn).filter((d): d is string => !!d).sort();
    const nextEta = etas[0] ?? null;

    const reorderPoint = Math.round(velocity * (p.leadTimeMaxDays + p.safetyDays));
    const daysCover = stock !== null && velocity > 0 ? stock / velocity : null;
    const stockoutOn = daysCover !== null ? addDays(today, Math.floor(daysCover)) : null;
    const orderInDays = stock !== null && velocity > 0 ? (stock - reorderPoint) / velocity : null;
    const orderByOn = orderInDays !== null ? addDays(today, Math.floor(orderInDays)) : null;

    // Cover the lead time plus the period you want on the shelf, minus what you have
    // and what is already on its way.
    const rawSuggested = velocity * (p.targetCoverDays + p.leadTimeMaxDays) - (stock ?? 0) - incomingUnits;
    let suggestedUnits = Math.max(0, Math.ceil(rawSuggested));
    if (p.moq > 0 && suggestedUnits > 0) suggestedUnits = Math.ceil(suggestedUnits / p.moq) * p.moq;

    const afterOrder = (stock ?? 0) + incomingUnits + suggestedUnits;
    const suggestedCoversDays = velocity > 0 && suggestedUnits > 0 ? afterOrder / velocity : null;
    const suggestedUntil = suggestedCoversDays !== null ? addDays(today, Math.floor(suggestedCoversDays)) : null;
    const pace: ProductForecast["pace"] =
      v30 <= 0 ? "steady" : v7 > v30 * 1.15 ? "rising" : v7 < v30 * 0.6 ? "falling" : "steady";

    let status: ProductForecast["status"];
    if (velocity <= 0) status = "no_sales";
    else if (stock === null) status = "needs_count";
    else if (orderInDays !== null && orderInDays <= 0) status = "order_now";
    else if (orderInDays !== null && orderInDays <= 7) status = "soon";
    else status = "ok";

    const salesDays: { date: string; units: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = addDays(today, -i);
      salesDays.push({ date: day, units: s.get(day) ?? 0 });
    }

    return {
      id: p.id, code: p.code, name: p.name, unitLabel: p.unitLabel,
      leadTimeMinDays: p.leadTimeMinDays, leadTimeMaxDays: p.leadTimeMaxDays,
      safetyDays: p.safetyDays, targetCoverDays: p.targetCoverDays,
      velocityBasisDays: p.velocityBasisDays, moq: p.moq, unitCost: p.unitCost, isActive: p.isActive,
      velocity, v7, v14, v30, v60,
      trend: v30 > 0 ? v7 / v30 - 1 : null,
      countUnits: count?.units ?? null, countedOn: count?.countedOn ?? null,
      soldSinceCount, receivedSinceCount, stock,
      incomingUnits, nextEta,
      daysCover, stockoutOn, reorderPoint, orderInDays, orderByOn,
      suggestedUnits,
      suggestedCost: p.unitCost ? Math.round(suggestedUnits * p.unitCost) : null,
      suggestedCoversDays, suggestedUntil, pace,
      status, salesDays,
      shopifyVariantId: p.shopifyVariantId, shopifyInventoryItemId: p.shopifyInventoryItemId,
      shopifyLocationId: p.shopifyLocationId,
      shopifySyncedAt: p.shopifySyncedAt ? p.shopifySyncedAt.toISOString() : null,
      shopifyLastPushedUnits: p.shopifyLastPushedUnits,
    };
  });

  const allDays = sales.map((r) => r.soldOn).sort();
  return { products: out, generatedAt: todayStr, salesFrom: allDays[0] ?? null };
}
