"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Save, X, Pencil, Trash2, ChevronDown, ChevronRight, Wallet, Receipt, Users } from "lucide-react";
import { toast } from "sonner";
import {
  B2B_PRODUCTS, PRICE_LISTS, SELLERS, ORDER_KINDS, INVOICE_STATUSES, NOAH_COMMISSION_PER_JAR, COMMISSION_SELLER,
  invoiceStatusMeta, orderTotals, productMeta, type B2BOrderLine, type B2BProductKey,
} from "@/lib/butiker/orders";

export type B2BOrder = {
  id: string; leadId: string | null; customerName: string; orgNumber: string | null; contactName: string | null;
  contactEmail: string | null; invoiceEmail: string | null; city: string | null; seller: string | null; kind: string;
  orderDate: string; shopifyOrder: string | null; fortnoxInvoice: string | null; invoiceStatus: string; paidAt: string | null;
  lines: B2BOrderLine[]; shippingCost: number; commissionPaidAt: string | null; note: string | null;
  createdBy: string | null; createdAt: string; updatedAt: string;
};
type LeadLite = { id: string; name: string; city: string | null; email: string | null; status: string };

const kr = (n: number) => `${Math.round(n).toLocaleString("sv-SE")} kr`;
const kr2 = (n: number) => `${n.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`;
const dateSv = (s: string | null) => (s ? new Date(s + "T00:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" }) : "–");
const monthSv = (ym: string) => new Date(ym + "-01T00:00:00").toLocaleDateString("sv-SE", { month: "long", year: "numeric" });
const todayIso = () => new Date().toISOString().slice(0, 10);
const input = "bg-[#0a0e1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40";
const kindLabel = (k: string) => ORDER_KINDS.find((x) => x.key === k)?.label ?? k;

type Draft = {
  leadId: string; customerName: string; orgNumber: string; contactName: string; contactEmail: string; invoiceEmail: string;
  city: string; seller: string; kind: string; orderDate: string; shopifyOrder: string; fortnoxInvoice: string;
  invoiceStatus: string; paidAt: string; shippingCost: string; note: string; priceList: string;
  lines: { product: B2BProductKey; qty: string; price: string; cost: string }[];
};
const emptyDraft = (): Draft => ({
  leadId: "", customerName: "", orgNumber: "", contactName: "", contactEmail: "", invoiceEmail: "", city: "",
  seller: "Erica", kind: "order", orderDate: todayIso(), shopifyOrder: "", fortnoxInvoice: "", invoiceStatus: "ej_fakturerad",
  paidAt: "", shippingCost: "0", note: "", priceList: "standard", lines: [],
});
const draftFrom = (o: B2BOrder): Draft => ({
  leadId: o.leadId ?? "", customerName: o.customerName, orgNumber: o.orgNumber ?? "", contactName: o.contactName ?? "",
  contactEmail: o.contactEmail ?? "", invoiceEmail: o.invoiceEmail ?? "", city: o.city ?? "", seller: o.seller ?? "",
  kind: o.kind, orderDate: o.orderDate, shopifyOrder: o.shopifyOrder ?? "", fortnoxInvoice: o.fortnoxInvoice ?? "",
  invoiceStatus: o.invoiceStatus, paidAt: o.paidAt ?? "", shippingCost: String(o.shippingCost ?? 0), note: o.note ?? "",
  priceList: o.seller === COMMISSION_SELLER ? "noah" : "standard",
  lines: o.lines.map((l) => ({ product: l.product as B2BProductKey, qty: String(l.qty), price: String(l.price), cost: String(l.cost) })),
});
const draftLines = (d: Draft): B2BOrderLine[] =>
  d.lines.map((l) => ({ product: l.product, qty: Math.trunc(Number(l.qty) || 0), price: Number(l.price) || 0, cost: Number(l.cost) || 0 })).filter((l) => l.qty !== 0);

/** Customers, every order, what we earn and Noah's commission. */
export function OrdrarView({ leads }: { leads: LeadLite[] }) {
  const [orders, setOrders] = useState<B2BOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"ordrar" | "kunder" | "provision">("ordrar");
  const [editing, setEditing] = useState<string | null>(null); // order id or "new"
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [openCustomer, setOpenCustomer] = useState<string | null>(null);
  const [missingTable, setMissingTable] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/butiker/ordrar", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        if (/b2b_orders/.test(json.error ?? "")) { setMissingTable(true); return; }
        throw new Error(json.error ?? "Kunde inte läsa ordrarna");
      }
      setOrders(json.orders); setMissingTable(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte läsa ordrarna");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => orders.map((o) => ({ o, t: orderTotals(o) })), [orders]);

  const kpi = useMemo(() => {
    const sum = { revenue: 0, cogs: 0, commission: 0, shipping: 0, profit: 0, jars: 0, soldJars: 0, outstanding: 0, commissionDue: 0, commissionPaid: 0 };
    for (const { o, t } of rows) {
      sum.revenue += t.revenue; sum.cogs += t.cogs; sum.commission += t.commission; sum.shipping += t.shipping;
      sum.profit += t.profit; sum.jars += t.jars; sum.soldJars += t.soldJars;
      if (o.invoiceStatus === "skickad" || o.invoiceStatus === "ej_fakturerad") sum.outstanding += t.revenue * 1.25;
      if (t.commission && o.commissionPaidAt) sum.commissionPaid += t.commission;
      else if (t.commission) sum.commissionDue += t.commission;
    }
    const customers = new Set(orders.filter((o) => o.kind === "order").map((o) => o.customerName.toLowerCase())).size;
    return { ...sum, customers, margin: sum.revenue ? sum.profit / sum.revenue : 0 };
  }, [rows, orders]);

  const customers = useMemo(() => {
    const m = new Map<string, { name: string; city: string | null; seller: string | null; orders: typeof rows; revenue: number; profit: number; jars: number; outstanding: number; last: string }>();
    for (const r of rows) {
      const key = r.o.customerName.toLowerCase();
      const c = m.get(key) ?? { name: r.o.customerName, city: r.o.city, seller: r.o.seller, orders: [], revenue: 0, profit: 0, jars: 0, outstanding: 0, last: r.o.orderDate };
      c.orders.push(r); c.revenue += r.t.revenue; c.profit += r.t.profit; c.jars += r.t.jars;
      if (r.o.invoiceStatus === "skickad" || r.o.invoiceStatus === "ej_fakturerad") c.outstanding += r.t.revenue * 1.25;
      if (r.o.orderDate > c.last) c.last = r.o.orderDate;
      c.city ??= r.o.city;
      m.set(key, c);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const commissionByMonth = useMemo(() => {
    const m = new Map<string, { month: string; rows: typeof rows; jars: number; amount: number; paid: number }>();
    for (const r of rows) {
      if (!r.t.commission) continue;
      const month = r.o.orderDate.slice(0, 7);
      const g = m.get(month) ?? { month, rows: [], jars: 0, amount: 0, paid: 0 };
      g.rows.push(r); g.jars += r.t.soldJars; g.amount += r.t.commission;
      if (r.o.commissionPaidAt) g.paid += r.t.commission;
      m.set(month, g);
    }
    return [...m.values()].sort((a, b) => b.month.localeCompare(a.month));
  }, [rows]);

  function startNew() { setEditing("new"); setDraft(emptyDraft()); }
  function startEdit(o: B2BOrder) { setEditing(o.id); setDraft(draftFrom(o)); }
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  function pickLead(id: string) {
    const l = leads.find((x) => x.id === id);
    set({ leadId: id, ...(l ? { customerName: draft.customerName || l.name, city: draft.city || (l.city ?? ""), contactEmail: draft.contactEmail || (l.email ?? "") } : {}) });
  }
  function setSeller(seller: string) {
    const priceList = seller === COMMISSION_SELLER ? "noah" : "standard";
    const prices = PRICE_LISTS[priceList].prices;
    setDraft((d) => ({ ...d, seller, priceList, lines: d.lines.map((l) => ({ ...l, price: String(d.kind === "visning" ? 0 : prices[l.product]) })) }));
  }
  function setKind(kind: string) {
    const prices = PRICE_LISTS[draft.priceList].prices;
    setDraft((d) => ({
      ...d, kind,
      invoiceStatus: kind === "visning" ? "ingen" : d.invoiceStatus === "ingen" ? "ej_fakturerad" : d.invoiceStatus,
      lines: d.lines.map((l) => ({
        ...l,
        price: String(kind === "visning" ? 0 : prices[l.product]),
        qty: String(kind === "kredit" ? -Math.abs(Number(l.qty) || 1) : Math.abs(Number(l.qty) || 1)),
        cost: String(kind === "kredit" ? 0 : productMeta(l.product)?.cost ?? 0),
      })),
    }));
  }
  function addLine(product: B2BProductKey) {
    const p = productMeta(product)!;
    const price = draft.kind === "visning" ? 0 : PRICE_LISTS[draft.priceList].prices[product];
    setDraft((d) => ({ ...d, lines: [...d.lines, { product, qty: d.kind === "kredit" ? "-1" : "1", price: String(price), cost: String(d.kind === "kredit" ? 0 : p.cost) }] }));
  }
  const setLine = (i: number, patch: Partial<Draft["lines"][number]>) =>
    setDraft((d) => ({ ...d, lines: d.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));

  const draftTotals = orderTotals({ kind: draft.kind, seller: draft.seller, lines: draftLines(draft), shippingCost: Number(draft.shippingCost) || 0 });

  async function save() {
    if (!draft.customerName.trim()) { toast.error("Ange kundens namn"); return; }
    const lines = draftLines(draft);
    if (!lines.length) { toast.error("Lägg till minst en rad"); return; }
    setSaving(true);
    try {
      const body = {
        leadId: draft.leadId || null, customerName: draft.customerName, orgNumber: draft.orgNumber, contactName: draft.contactName,
        contactEmail: draft.contactEmail, invoiceEmail: draft.invoiceEmail, city: draft.city, seller: draft.seller || null,
        kind: draft.kind, orderDate: draft.orderDate, shopifyOrder: draft.shopifyOrder, fortnoxInvoice: draft.fortnoxInvoice,
        invoiceStatus: draft.invoiceStatus, paidAt: draft.paidAt || null, shippingCost: Number(draft.shippingCost) || 0,
        note: draft.note, lines,
      };
      const res = await fetch(editing === "new" ? "/api/butiker/ordrar" : `/api/butiker/ordrar/${editing}`, {
        method: editing === "new" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte spara");
      toast.success(editing === "new" ? "Ordern är sparad" : "Ändringen är sparad");
      setEditing(null); load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>, msg: string) {
    const res = await fetch(`/api/butiker/ordrar/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Kunde inte spara"); return; }
    toast.success(msg);
    setOrders((os) => os.map((o) => (o.id === id ? json.order : o)));
  }
  async function remove(o: B2BOrder) {
    if (!window.confirm(`Ta bort ordern till ${o.customerName} (${dateSv(o.orderDate)})?`)) return;
    const res = await fetch(`/api/butiker/ordrar/${o.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Kunde inte ta bort"); return; }
    toast.success("Ordern är borttagen");
    setOrders((os) => os.filter((x) => x.id !== o.id));
  }
  async function payCommissionMonth(month: string) {
    const unpaid = rows.filter((r) => r.t.commission && !r.o.commissionPaidAt && r.o.orderDate.startsWith(month));
    for (const r of unpaid) await patch(r.o.id, { commissionPaidAt: todayIso() }, "Provisionen är markerad som utbetald");
  }

  if (missingTable) {
    return (
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 text-sm text-amber-200">
        Tabellen för ordrar finns inte i databasen än. En superadmin kör migreringen <code className="text-amber-100">0037_b2b_orders</code> via
        <code className="text-amber-100"> POST /api/admin/migrate</code>, sedan laddar du om sidan.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {[
          ["Kunder", String(kpi.customers), `${orders.length} ordrar`],
          ["Burkar ut", kpi.jars.toLocaleString("sv-SE"), `${kpi.soldJars} sålda`],
          ["Intäkt ex moms", kr(kpi.revenue), "efter krediter"],
          ["Varukostnad", kr(kpi.cogs), `frakt ${kr(kpi.shipping)}`],
          ["Vi tjänar", kr(kpi.profit), `${Math.round(kpi.margin * 100)} % av intäkten`],
          ["Obetalt inkl moms", kr(kpi.outstanding), "skickade + ej fakturerade"],
          ["Noah att betala ut", kr(kpi.commissionDue), `utbetalt ${kr(kpi.commissionPaid)}`],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
            <div className={`text-xl font-semibold mt-1 tabular-nums ${label === "Vi tjänar" ? "text-emerald-300" : label === "Noah att betala ut" && kpi.commissionDue > 0 ? "text-amber-300" : "text-white"}`}>{value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 -mt-3">
        &bdquo;Vi tjänar&ldquo; = intäkt ex moms − varukostnad − frakt − Noahs provision ({NOAH_COMMISSION_PER_JAR} kr per såld burk ex moms). Visningsburkar kostar varukostnaden men ger ingen provision. Annonskostnad ingår inte.
      </p>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1">
          {([["ordrar", "Ordrar", Receipt], ["kunder", "Kunder", Users], ["provision", "Noahs provision", Wallet]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 ${tab === k ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20" : "text-slate-400 border border-transparent hover:text-slate-200"}`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <button onClick={startNew} className="px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 text-sm flex items-center gap-2">
          <Plus className="h-4 w-4" /> Ny order
        </button>
      </div>

      {/* Form */}
      {editing && (
        <div className="rounded-xl border border-cyan-500/20 bg-[#111827] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold">{editing === "new" ? "Ny order" : "Ändra order"}</h3>
            <button onClick={() => setEditing(null)} className="text-slate-500 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-slate-400 space-y-1">Butik i kontaktlistan (valfritt)
              <select className={`${input} w-full`} value={draft.leadId} onChange={(e) => pickLead(e.target.value)}>
                <option value="">– ingen koppling –</option>
                {leads.filter((l) => ["kund", "intresserad", "prov_skickat", "avvakta"].includes(l.status) || l.id === draft.leadId)
                  .sort((a, b) => a.name.localeCompare(b.name, "sv"))
                  .map((l) => <option key={l.id} value={l.id}>{l.name}{l.city ? ` · ${l.city}` : ""}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">Kund (företagsnamn)
              <input className={`${input} w-full`} value={draft.customerName} onChange={(e) => set({ customerName: e.target.value })} placeholder="Meg's Djurbruk i Svedala AB" />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Org.nr
              <input className={`${input} w-full`} value={draft.orgNumber} onChange={(e) => set({ orgNumber: e.target.value })} placeholder="556720-6361" />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Ort
              <input className={`${input} w-full`} value={draft.city} onChange={(e) => set({ city: e.target.value })} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Kontaktperson
              <input className={`${input} w-full`} value={draft.contactName} onChange={(e) => set({ contactName: e.target.value })} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Kontaktmejl
              <input className={`${input} w-full`} value={draft.contactEmail} onChange={(e) => set({ contactEmail: e.target.value })} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Fakturamejl
              <input className={`${input} w-full`} value={draft.invoiceEmail} onChange={(e) => set({ invoiceEmail: e.target.value })} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Säljare
              <select className={`${input} w-full`} value={draft.seller} onChange={(e) => setSeller(e.target.value)}>
                <option value="">–</option>
                {SELLERS.map((s) => <option key={s} value={s}>{s}{s === COMMISSION_SELLER ? ` (provision ${NOAH_COMMISSION_PER_JAR} kr/burk)` : ""}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">Typ
              <select className={`${input} w-full`} value={draft.kind} onChange={(e) => setKind(e.target.value)}>
                {ORDER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">Orderdatum
              <input type="date" className={`${input} w-full`} value={draft.orderDate} onChange={(e) => set({ orderDate: e.target.value })} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Shopify-order
              <input className={`${input} w-full`} value={draft.shopifyOrder} onChange={(e) => set({ shopifyOrder: e.target.value })} placeholder="#49287" />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Fortnox-faktura
              <input className={`${input} w-full`} value={draft.fortnoxInvoice} onChange={(e) => set({ fortnoxInvoice: e.target.value })} placeholder="20" />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Fakturastatus
              <select className={`${input} w-full`} value={draft.invoiceStatus} onChange={(e) => set({ invoiceStatus: e.target.value, paidAt: e.target.value === "betald" ? draft.paidAt || todayIso() : draft.paidAt })}>
                {INVOICE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 space-y-1">Betald datum
              <input type="date" className={`${input} w-full`} value={draft.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
            </label>
            <label className="text-xs text-slate-400 space-y-1">Vår fraktkostnad (kr)
              <input type="number" className={`${input} w-full`} value={draft.shippingCost} onChange={(e) => set({ shippingCost: e.target.value })} />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-slate-400">Rader · prislista: <span className="text-slate-200">{PRICE_LISTS[draft.priceList].label}</span>{draft.kind === "kredit" && " · kredit = negativt antal"}</div>
              <div className="flex gap-1 flex-wrap">
                {B2B_PRODUCTS.map((p) => (
                  <button key={p.key} onClick={() => addLine(p.key)} className="text-xs px-2 py-1 rounded-md border border-white/10 text-slate-300 hover:bg-white/[0.04]">+ {p.name.split(" (")[0]}</button>
                ))}
              </div>
            </div>
            {draft.lines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
                    <th className="py-1.5 pr-2">Produkt</th><th className="py-1.5 pr-2 w-24">Antal</th><th className="py-1.5 pr-2 w-28">Pris ex moms</th>
                    <th className="py-1.5 pr-2 w-28">Varukostnad</th><th className="py-1.5 pr-2 text-right">Summa</th><th className="w-8" />
                  </tr></thead>
                  <tbody>
                    {draft.lines.map((l, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-1.5 pr-2 text-slate-200">{productMeta(l.product)?.name}</td>
                        <td className="py-1.5 pr-2"><input type="number" className={`${input} w-20 py-1`} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                        <td className="py-1.5 pr-2"><input type="number" className={`${input} w-24 py-1`} value={l.price} onChange={(e) => setLine(i, { price: e.target.value })} /></td>
                        <td className="py-1.5 pr-2"><input type="number" className={`${input} w-24 py-1`} value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} /></td>
                        <td className="py-1.5 pr-2 text-right tabular-nums text-slate-200">{kr2((Number(l.qty) || 0) * (Number(l.price) || 0))}</td>
                        <td><button onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, j) => j !== i) }))} className="text-slate-500 hover:text-red-400"><X className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <label className="text-xs text-slate-400 space-y-1 block">Anteckning
            <textarea className={`${input} w-full min-h-[60px]`} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </label>

          <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg bg-[#0a0e1a] border border-white/5 px-4 py-3 text-sm">
            <div className="flex gap-5 flex-wrap text-slate-400 tabular-nums">
              <span>{draftTotals.jars} burkar</span>
              <span>Intäkt <b className="text-white">{kr2(draftTotals.revenue)}</b> ex moms ({kr2(draftTotals.revenue * 1.25)} inkl)</span>
              <span>Varukostnad {kr2(draftTotals.cogs)}</span>
              {draftTotals.commission > 0 && <span>Provision {kr2(draftTotals.commission)}</span>}
              <span>Vi tjänar <b className="text-emerald-300">{kr2(draftTotals.profit)}</b></span>
            </div>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-cyan-500 text-[#0a0e1a] font-medium text-sm flex items-center gap-2 disabled:opacity-50">
              <Save className="h-4 w-4" /> {saving ? "Sparar…" : "Spara"}
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-sm text-slate-500">Läser ordrar…</div>}
      {!loading && !orders.length && !editing && (
        <div className="rounded-xl border border-white/5 bg-[#111827] p-6 text-sm text-slate-400">Inga ordrar ännu. Klicka på &bdquo;Ny order&ldquo; för att lägga in den första.</div>
      )}

      {/* Orders */}
      {tab === "ordrar" && orders.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left border-b border-white/5">
              <th className="px-4 py-2.5">Datum</th><th className="px-2 py-2.5">Kund</th><th className="px-2 py-2.5">Säljare</th>
              <th className="px-2 py-2.5">Shopify / Fortnox</th><th className="px-2 py-2.5 text-right">Burkar</th><th className="px-2 py-2.5 text-right">Intäkt ex moms</th>
              <th className="px-2 py-2.5 text-right">Varukostn.</th><th className="px-2 py-2.5 text-right">Provision</th><th className="px-2 py-2.5 text-right">Vi tjänar</th>
              <th className="px-2 py-2.5">Faktura</th><th className="px-2 py-2.5" />
            </tr></thead>
            <tbody>
              {rows.map(({ o, t }) => {
                const st = invoiceStatusMeta(o.invoiceStatus);
                return (
                  <tr key={o.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">{dateSv(o.orderDate)}</td>
                    <td className="px-2 py-2.5">
                      <div className="text-white">{o.customerName}</div>
                      <div className="text-xs text-slate-500">{[o.city, o.kind !== "order" ? kindLabel(o.kind) : null].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td className="px-2 py-2.5 text-slate-300">{o.seller ?? "–"}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-400 whitespace-nowrap">{o.shopifyOrder ?? "–"} · {o.fortnoxInvoice ? `F${o.fortnoxInvoice}` : "–"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{t.jars || (t.soldJars < 0 ? t.soldJars : 0)}</td>
                    <td className={`px-2 py-2.5 text-right tabular-nums ${t.revenue < 0 ? "text-red-300" : "text-white"}`}>{kr2(t.revenue)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{kr2(t.cogs)}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-400">{t.commission ? kr2(t.commission) : "–"}</td>
                    <td className={`px-2 py-2.5 text-right tabular-nums font-medium ${t.profit < 0 ? "text-red-300" : "text-emerald-300"}`}>{kr2(t.profit)}</td>
                    <td className="px-2 py-2.5">
                      <select value={o.invoiceStatus} onChange={(e) => patch(o.id, { invoiceStatus: e.target.value, ...(e.target.value === "betald" && !o.paidAt ? { paidAt: todayIso() } : {}) }, "Fakturastatus uppdaterad")}
                        className={`text-xs rounded-full border px-2 py-0.5 bg-transparent ${st.cls}`}>
                        {INVOICE_STATUSES.map((s) => <option key={s.key} value={s.key} className="bg-[#111827] text-white">{s.label}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2.5 whitespace-nowrap text-right">
                      <button onClick={() => startEdit(o)} className="text-slate-500 hover:text-cyan-300 p-1"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove(o)} className="text-slate-500 hover:text-red-400 p-1"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Customers */}
      {tab === "kunder" && customers.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left border-b border-white/5">
              <th className="px-4 py-2.5">Kund</th><th className="px-2 py-2.5">Säljare</th><th className="px-2 py-2.5 text-right">Ordrar</th>
              <th className="px-2 py-2.5 text-right">Burkar</th><th className="px-2 py-2.5 text-right">Intäkt ex moms</th><th className="px-2 py-2.5 text-right">Vi tjänar</th>
              <th className="px-2 py-2.5 text-right">Obetalt inkl moms</th><th className="px-2 py-2.5">Senaste order</th>
            </tr></thead>
            <tbody>
              {customers.map((c) => (
                <Fragment key={c.name}>
                  <tr className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer" onClick={() => setOpenCustomer(openCustomer === c.name ? null : c.name)}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 text-white">{openCustomer === c.name ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}{c.name}</div>
                      {c.city && <div className="text-xs text-slate-500 pl-5">{c.city}</div>}
                    </td>
                    <td className="px-2 py-2.5 text-slate-300">{c.seller ?? "–"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{c.orders.length}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{c.jars}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white">{kr2(c.revenue)}</td>
                    <td className={`px-2 py-2.5 text-right tabular-nums font-medium ${c.profit < 0 ? "text-red-300" : "text-emerald-300"}`}>{kr2(c.profit)}</td>
                    <td className={`px-2 py-2.5 text-right tabular-nums ${c.outstanding > 0 ? "text-amber-300" : "text-slate-500"}`}>{c.outstanding > 0 ? kr2(c.outstanding) : "–"}</td>
                    <td className="px-2 py-2.5 text-slate-400">{dateSv(c.last)}</td>
                  </tr>
                  {openCustomer === c.name && c.orders.map(({ o, t }) => (
                    <tr key={o.id} className="border-b border-white/5 bg-[#0a0e1a]/60 text-xs">
                      <td className="px-4 py-2 pl-10 text-slate-400" colSpan={2}>{dateSv(o.orderDate)} · {kindLabel(o.kind)} · {o.shopifyOrder ?? "–"} · {o.fortnoxInvoice ? `F${o.fortnoxInvoice}` : "ingen faktura"}</td>
                      <td className="px-2 py-2 text-slate-400" colSpan={2}>{o.lines.map((l) => `${l.qty} ${productMeta(l.product)?.name.split(" (")[0]}`).join(", ")}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-300">{kr2(t.revenue)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-emerald-300/80">{kr2(t.profit)}</td>
                      <td className="px-2 py-2 text-slate-400" colSpan={2}>{invoiceStatusMeta(o.invoiceStatus).label}{o.paidAt ? ` ${dateSv(o.paidAt)}` : ""}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Noah's commission */}
      {tab === "provision" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-white/5 bg-[#111827] p-4 text-sm text-slate-400">
            Noah får <b className="text-white">{NOAH_COMMISSION_PER_JAR} kr ex moms per såld burk</b> på ordrar där han är säljare. Visningsburkar ger ingen provision, och krediterade burkar dras av.
            Totalt intjänat <b className="text-white">{kr2(kpi.commission)}</b>, varav <b className="text-amber-300">{kr2(kpi.commissionDue)}</b> kvar att betala ut.
          </div>
          {!commissionByMonth.length && <div className="text-sm text-slate-500">Inga provisionsgrundande ordrar ännu.</div>}
          {commissionByMonth.map((g) => (
            <div key={g.month} className="rounded-xl border border-white/5 bg-[#111827] overflow-x-auto">
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/5 flex-wrap">
                <div className="text-white font-medium capitalize">{monthSv(g.month)}</div>
                <div className="flex items-center gap-4 text-sm tabular-nums">
                  <span className="text-slate-400">{g.jars} burkar</span>
                  <span className="text-white">{kr2(g.amount)}</span>
                  {g.amount - g.paid > 0
                    ? <button onClick={() => payCommissionMonth(g.month)} className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20">Markera {kr2(g.amount - g.paid)} som utbetalt</button>
                    : <span className="text-xs text-emerald-300">Utbetalt</span>}
                </div>
              </div>
              <table className="w-full text-sm min-w-[620px]">
                <tbody>
                  {g.rows.map(({ o, t }) => (
                    <tr key={o.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-2 text-slate-400 whitespace-nowrap">{dateSv(o.orderDate)}</td>
                      <td className="px-2 py-2 text-white">{o.customerName}</td>
                      <td className="px-2 py-2 text-slate-400">{invoiceStatusMeta(o.invoiceStatus).label}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-300">{t.soldJars} × {NOAH_COMMISSION_PER_JAR} kr</td>
                      <td className="px-2 py-2 text-right tabular-nums text-white">{kr2(t.commission)}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => patch(o.id, { commissionPaidAt: o.commissionPaidAt ? null : todayIso() }, o.commissionPaidAt ? "Markerad som ej utbetald" : "Markerad som utbetald")}
                          className={`text-xs px-2 py-0.5 rounded-full border ${o.commissionPaidAt ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" : "bg-amber-500/10 text-amber-300 border-amber-500/20"}`}>
                          {o.commissionPaidAt ? `Utbetald ${dateSv(o.commissionPaidAt)}` : "Ej utbetald"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
