import { db, schema } from "@/db";
import { desc, gte } from "drizzle-orm";
import { DEMAND_PLAN, addDays, cumulativeDemand, stockoutDay } from "./plan";

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

  velocity: number;      // normal units per day: the chosen basis, or the last week if faster
  v7: number;
  v14: number;
  v30: number;
  v60: number;
  trend: number | null;  // v7 vs v30, e.g. 0.18 = 18 % faster this week

  countUnits: number | null;
  countedOn: string | null;
  countedAt: string | null;
  countSource: string | null;
  soldSinceCount: number;   // shipped after an exact count, sold after a day-level one
  receivedSinceCount: number;
  stock: number | null;     // physically on the shelf
  openUnits: number;        // reserved by orders not shipped yet
  available: number | null; // stock minus reserved: what can still be sold
  trackingSyncedAt: string | null;

  incomingUnits: number;
  nextEta: string | null;

  /** cumDemand[n] = expected units over the next n days, campaigns included. */
  cumDemand: number[];
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
const stockholmDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** Units per day over the last `window` days, counting every day in the window. */
function velocityOver(sales: Map<string, number>, today: string, window: number): number {
  let units = 0;
  for (let i = 1; i <= window; i++) units += sales.get(addDays(today, -i)) ?? 0;
  return units / window;
}

type Count = typeof schema.inventoryCounts.$inferSelect;
/** When a count applies: its exact time, or the end of its day for day-level counts. */
const countMoment = (c: Count) => c.countedAt?.getTime() ?? Date.parse(`${c.countedOn}T23:59:59Z`);

export async function buildForecast() {
  const [products, counts, pos, sales, shipments] = await Promise.all([
    db.select().from(schema.inventoryProducts).orderBy(schema.inventoryProducts.sortOrder),
    db.select().from(schema.inventoryCounts).orderBy(desc(schema.inventoryCounts.createdAt)),
    db.select().from(schema.inventoryPurchaseOrders).orderBy(desc(schema.inventoryPurchaseOrders.orderedOn)),
    db
      .select()
      .from(schema.inventorySalesDaily)
      .where(gte(schema.inventorySalesDaily.soldOn, iso(new Date(Date.now() - 120 * DAY)))),
    db
      .select({
        productId: schema.inventoryShipments.productId,
        units: schema.inventoryShipments.units,
        shippedAt: schema.inventoryShipments.shippedAt,
      })
      .from(schema.inventoryShipments),
  ]);

  const todayStr = iso(new Date());
  const byProduct = new Map<string, Map<string, number>>();
  for (const row of sales) {
    const m = byProduct.get(row.productId) ?? new Map<string, number>();
    m.set(row.soldOn, (m.get(row.soldOn) ?? 0) + row.units);
    byProduct.set(row.productId, m);
  }

  const out: ProductForecast[] = products.map((p) => {
    const s = byProduct.get(p.id) ?? new Map<string, number>();
    const v7 = velocityOver(s, todayStr, 7);
    const v14 = velocityOver(s, todayStr, 14);
    const v30 = velocityOver(s, todayStr, 30);
    const v60 = velocityOver(s, todayStr, 60);
    const basis = p.velocityBasisDays;
    const basisRate = basis <= 7 ? v7 : basis <= 14 ? v14 : basis <= 30 ? v30 : v60;
    // Plan on the faster of the basis and the last week, so a growing or newly launched
    // product is not sized on a month that barely included it.
    const velocity = Math.max(basisRate, v7);

    const count = counts.filter((c) => c.productId === p.id).sort((a, b) => countMoment(b) - countMoment(a))[0] ?? null;
    let soldSinceCount = 0;
    let receivedSinceCount = 0;
    let stock: number | null = null;
    if (count) {
      const exact = count.countedAt;
      const anchorDay = exact ? stockholmDay(exact) : count.countedOn;
      if (exact) {
        for (const row of shipments) if (row.productId === p.id && row.shippedAt > exact) soldSinceCount += row.units;
      } else {
        for (const [day, units] of s) if (day > count.countedOn) soldSinceCount += units;
      }
      const anchorTime = exact ?? count.createdAt;
      for (const po of pos) {
        if (po.productId !== p.id || !po.receivedOn) continue;
        // Dates have day resolution, so a delivery booked on the anchor day is decided by the clock.
        if (po.receivedOn > anchorDay || (po.receivedOn === anchorDay && po.updatedAt > anchorTime)) receivedSinceCount += po.units;
      }
      stock = count.units - soldSinceCount + receivedSinceCount;
    }
    // Reserved units only apply to an exact, tracked stock figure.
    const openUnits = count?.countedAt ? p.openUnits : 0;
    const available = stock === null ? null : stock - openUnits;

    const open = pos.filter((po) => po.productId === p.id && po.status === "ordered" && !po.receivedOn);
    const incomingUnits = open.reduce((n, po) => n + po.units, 0);
    const etas = open.map((po) => po.etaOn).filter((d): d is string => !!d).sort();
    const nextEta = etas[0] ?? null;
    const arrivals = open.map((po) => ({
      day: Math.max(0, po.etaOn ? daysBetween(todayStr, po.etaOn) : p.leadTimeMaxDays),
      units: po.units,
    }));

    const cumDemand = cumulativeDemand(p.code, velocity, todayStr);
    const at = (n: number) => cumDemand[Math.min(n, cumDemand.length - 1)];
    const reorderPoint = Math.round(at(p.leadTimeMaxDays + p.safetyDays));

    const canPlan = available !== null && velocity > 0;
    const runout = canPlan ? stockoutDay(cumDemand, available, arrivals) : null;
    const daysCover = canPlan ? (runout ?? cumDemand.length - 1) : null;
    const stockoutOn = runout !== null ? addDays(todayStr, runout) : null;
    const orderInDays = runout !== null ? runout - p.leadTimeMaxDays - p.safetyDays : null;
    const orderByOn = orderInDays !== null ? addDays(todayStr, orderInDays) : null;

    // Cover the lead time plus the period you want on the shelf, minus what you have
    // and what is already on its way.
    const rawSuggested = at(p.targetCoverDays + p.leadTimeMaxDays) - (available ?? 0) - incomingUnits;
    let suggestedUnits = Math.max(0, Math.ceil(rawSuggested));
    if (p.moq > 0 && suggestedUnits > 0) suggestedUnits = Math.ceil(suggestedUnits / p.moq) * p.moq;

    const afterOrder = (available ?? 0) + incomingUnits + suggestedUnits;
    const coversDay = velocity > 0 && suggestedUnits > 0 ? (stockoutDay(cumDemand, afterOrder) ?? cumDemand.length - 1) : null;
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
      const day = addDays(todayStr, -i);
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
      countedAt: count?.countedAt?.toISOString() ?? null, countSource: count?.source ?? null,
      soldSinceCount, receivedSinceCount, stock, openUnits, available,
      trackingSyncedAt: p.trackingSyncedAt?.toISOString() ?? null,
      incomingUnits, nextEta,
      cumDemand: cumDemand.map((n) => Math.round(n)),
      daysCover, stockoutOn, reorderPoint, orderInDays, orderByOn,
      suggestedUnits,
      suggestedCost: p.unitCost ? Math.round(suggestedUnits * p.unitCost) : null,
      suggestedCoversDays: coversDay, suggestedUntil: coversDay !== null ? addDays(todayStr, coversDay) : null, pace,
      status, salesDays,
      shopifyVariantId: p.shopifyVariantId, shopifyInventoryItemId: p.shopifyInventoryItemId,
      shopifyLocationId: p.shopifyLocationId,
      shopifySyncedAt: p.shopifySyncedAt ? p.shopifySyncedAt.toISOString() : null,
      shopifyLastPushedUnits: p.shopifyLastPushedUnits,
    };
  });

  const allDays = sales.map((r) => r.soldOn).sort();
  return {
    products: out,
    generatedAt: todayStr,
    salesFrom: allDays[0] ?? null,
    demandPlan: DEMAND_PLAN.filter((w) => w.to >= todayStr && !w.codes),
  };
}
