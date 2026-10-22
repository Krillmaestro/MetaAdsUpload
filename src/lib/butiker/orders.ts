// B2B orders: what each shop bought, what we earn on it and Noah's commission.
// Shared by the API (validation) and the page (forms and totals).

/** Cost of goods per jar, ex VAT: the Fluffy invoices incl. freight in (same figures as TrueProfit). */
export const B2B_PRODUCTS = [
  { key: "probiotika", name: "3-i-1 Probiotika", sku: "1", ean: "73222309", cost: 64.9 },
  { key: "quercetin", name: "Quercetin+ (Klåda & Allergi)", sku: "5", ean: "73222354", cost: 84.96 },
  { key: "rorelse", name: "Rörelse+", sku: "4", ean: "73222316", cost: 72.61 },
  { key: "relax", name: "Relax+ (Calming Tuggor)", sku: "7", ean: "73222323", cost: 57.54 },
  { key: "munhalsa", name: "Munhälsa+", sku: "2", ean: "73222330", cost: 76.24 },
  { key: "skincoat", name: "Skin & Coat", sku: "6", ean: "73222347", cost: 56.97 },
] as const;
export type B2BProductKey = (typeof B2B_PRODUCTS)[number]["key"];
export const productMeta = (key: string) => B2B_PRODUCTS.find((p) => p.key === key);

/** Wholesale price per jar ex VAT. Noah sells on his own price list. */
export const PRICE_LISTS: Record<string, { label: string; prices: Record<B2BProductKey, number> }> = {
  standard: { label: "Standard (175/158 kr)", prices: { probiotika: 175, quercetin: 175, rorelse: 175, relax: 175, munhalsa: 175, skincoat: 158 } },
  noah: { label: "Noah (189/179 kr)", prices: { probiotika: 189, quercetin: 189, rorelse: 189, relax: 189, munhalsa: 189, skincoat: 179 } },
};

export const SELLERS = ["Noah", "Erica", "Kristoffer"] as const;
/** Noah earns this per sold jar, ex VAT. Display jars and credited jars do not count. */
export const NOAH_COMMISSION_PER_JAR = 45;
export const COMMISSION_SELLER = "Noah";

export const ORDER_KINDS = [
  { key: "order", label: "Order" },
  { key: "visning", label: "Visningsburkar (gratis)" },
  { key: "kredit", label: "Kredit" },
] as const;

export const INVOICE_STATUSES = [
  { key: "ej_fakturerad", label: "Ej fakturerad", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  { key: "skickad", label: "Faktura skickad", cls: "bg-sky-500/10 text-sky-300 border-sky-500/20" },
  { key: "betald", label: "Betald", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  { key: "ingen", label: "Ingen faktura", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
] as const;
export const invoiceStatusMeta = (key: string) => INVOICE_STATUSES.find((s) => s.key === key) ?? INVOICE_STATUSES[0];

/** One line: qty is negative on a credit. price and cost are frozen when the order is saved. */
export type B2BOrderLine = { product: string; qty: number; price: number; cost: number };

export type B2BOrderTotals = {
  jars: number; // jars that leave the warehouse (display jars included, credits excluded)
  soldJars: number; // jars we are paid for (net of credits)
  revenue: number; // ex VAT
  cogs: number;
  commission: number;
  shipping: number;
  profit: number; // revenue − cogs − shipping − commission
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function orderTotals(o: { kind: string; seller: string | null; lines: B2BOrderLine[]; shippingCost?: number | null }): B2BOrderTotals {
  let jars = 0, soldJars = 0, revenue = 0, cogs = 0;
  for (const l of o.lines ?? []) {
    const qty = Number(l.qty) || 0;
    revenue += qty * (Number(l.price) || 0);
    cogs += Math.max(qty, 0) * (Number(l.cost) || 0);
    if (qty > 0) jars += qty;
    if (o.kind !== "visning" && (Number(l.price) || 0) > 0) soldJars += qty;
  }
  const commission = o.seller === COMMISSION_SELLER ? soldJars * NOAH_COMMISSION_PER_JAR : 0;
  const shipping = Number(o.shippingCost) || 0;
  return {
    jars, soldJars, revenue: round2(revenue), cogs: round2(cogs), commission: round2(commission), shipping: round2(shipping),
    profit: round2(revenue - cogs - shipping - commission),
  };
}

/** Clean lines from a request: known products, whole quantities, numbers only. */
export function parseLines(raw: unknown): B2BOrderLine[] | null {
  if (!Array.isArray(raw)) return null;
  const out: B2BOrderLine[] = [];
  for (const r of raw) {
    const p = productMeta(String((r as B2BOrderLine)?.product ?? ""));
    const qty = Math.trunc(Number((r as B2BOrderLine)?.qty));
    const price = Number((r as B2BOrderLine)?.price);
    const cost = Number((r as B2BOrderLine)?.cost ?? p?.cost);
    if (!p || !Number.isFinite(qty) || qty === 0 || !Number.isFinite(price) || !Number.isFinite(cost)) continue;
    out.push({ product: p.key, qty, price: round2(price), cost: round2(cost) });
  }
  return out;
}
