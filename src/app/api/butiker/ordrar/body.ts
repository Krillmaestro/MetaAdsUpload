import { ORDER_KINDS, INVOICE_STATUSES, SELLERS, parseLines } from "@/lib/butiker/orders";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Fields a POST or PATCH may set. Only keys present in the body are returned, so a PATCH stays partial. */
export function orderFields(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  for (const k of ["leadId", "customerName", "orgNumber", "contactName", "contactEmail", "invoiceEmail", "city", "shopifyOrder", "fortnoxInvoice", "note"]) {
    if (has(k)) out[k] = str(b[k]);
  }
  if (has("seller")) out.seller = (SELLERS as readonly string[]).includes(String(b.seller)) ? b.seller : null;
  if (has("kind") && ORDER_KINDS.some((x) => x.key === b.kind)) out.kind = b.kind;
  if (has("invoiceStatus") && INVOICE_STATUSES.some((x) => x.key === b.invoiceStatus)) out.invoiceStatus = b.invoiceStatus;
  if (has("orderDate") && isoDate(b.orderDate)) out.orderDate = b.orderDate;
  if (has("paidAt")) out.paidAt = isoDate(b.paidAt);
  if (has("commissionPaidAt")) out.commissionPaidAt = isoDate(b.commissionPaidAt);
  if (has("shippingCost")) out.shippingCost = Math.max(0, Number(b.shippingCost) || 0);
  if (has("lines")) {
    const lines = parseLines(b.lines);
    if (lines) out.lines = lines;
  }
  return out;
}
