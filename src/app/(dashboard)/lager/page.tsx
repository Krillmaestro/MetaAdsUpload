"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PackageSearch, RefreshCw, AlertTriangle, Plus, Check, Truck, Settings2, Link2, Upload, Download } from "lucide-react";
import { toast } from "sonner";

type Forecast = {
  id: string; code: string; name: string; unitLabel: string;
  leadTimeMinDays: number; leadTimeMaxDays: number; safetyDays: number;
  targetCoverDays: number; velocityBasisDays: number; moq: number; unitCost: number | null; isActive: boolean;
  velocity: number; v7: number; v14: number; v30: number; v60: number; trend: number | null;
  countUnits: number | null; countedOn: string | null; soldSinceCount: number; receivedSinceCount: number; stock: number | null;
  incomingUnits: number; nextEta: string | null;
  daysCover: number | null; stockoutOn: string | null; reorderPoint: number;
  orderInDays: number | null; orderByOn: string | null; suggestedUnits: number; suggestedCost: number | null;
  suggestedCoversDays: number | null; suggestedUntil: string | null; pace: "rising" | "falling" | "steady";
  status: "order_now" | "soon" | "ok" | "needs_count" | "no_sales";
  salesDays: { date: string; units: number }[];
  shopifyVariantId: string | null; shopifyInventoryItemId: string | null; shopifyLocationId: string | null;
  shopifySyncedAt: string | null; shopifyLastPushedUnits: number | null;
};
type PurchaseOrder = {
  id: string; productId: string; units: number; orderedOn: string;
  etaOn: string | null; receivedOn: string | null; status: string; note: string | null;
};
type Payload = { products: Forecast[]; generatedAt: string; salesFrom: string | null; purchaseOrders: PurchaseOrder[] };
type ScopeState = { scopes: string[]; canRead: boolean; canWrite: boolean; missing: string[] };
type Variant = {
  productTitle: string; variantTitle: string | null; sku: string | null;
  variantId: string; inventoryItemId: string; tracked: boolean; available: number | null; status: string;
};

const nf = (n: number, d = 0) => n.toLocaleString("sv-SE", { minimumFractionDigits: d, maximumFractionDigits: d });
const dateSv = (s: string | null) =>
  s ? new Date(s + "T00:00:00").toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "–";
/** Move an ISO date forward by n days without touching the clock. */
const shiftDays = (isoDate: string, n: number) => {
  const d = new Date(isoDate + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A pallet holds 1 536 jars and only splits in three, so 512 is the smallest step.
 * Show the order both as steps and as pallets, which is how the factory ships it.
 */
const PALLET = 1536;
function packLabel(units: number, step: number) {
  const steps = Math.round(units / step);
  if (step !== 512) return `${steps} × ${nf(step)}`;
  const pallets = units / PALLET;
  const whole = Math.floor(pallets);
  const thirds = Math.round((pallets - whole) * 3);
  const pal = whole === 0 ? `${thirds}/3 pall` : thirds === 0 ? `${whole} ${whole === 1 ? "pall" : "pallar"}` : `${whole} ${whole === 1 ? "pall" : "pallar"} + ${thirds}/3`;
  return `${steps} × 512 · ${pal}`;
}

/** Whole days from today to an ISO date (negative if it has passed). */
const daysUntil = (isoDate: string) =>
  Math.round((new Date(isoDate + "T00:00:00").getTime() - new Date(new Date().toISOString().slice(0, 10) + "T00:00:00").getTime()) / 86400000);

/**
 * Recompute the suggestion for a different coverage period without a round trip,
 * using the same formula as the server: cover the lead time plus the chosen period,
 * minus what is on the shelf and what is already on its way.
 */
function suggestFor(p: Forecast, coverDays: number) {
  const raw = p.velocity * (coverDays + p.leadTimeMaxDays) - (p.stock ?? 0) - p.incomingUnits;
  let units = Math.max(0, Math.ceil(raw));
  if (p.moq > 0 && units > 0) units = Math.ceil(units / p.moq) * p.moq;
  const after = (p.stock ?? 0) + p.incomingUnits + units;
  const days = p.velocity > 0 && units > 0 ? after / p.velocity : null;
  const until = days !== null ? shiftDays(new Date().toISOString().slice(0, 10), Math.floor(days)) : null;
  return { units, days, until, cost: p.unitCost ? Math.round(units * p.unitCost) : null };
}

const STATUS: Record<Forecast["status"], { label: string; cls: string; dot: string }> = {
  order_now: { label: "Beställ nu", cls: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-400" },
  soon: { label: "Beställ snart", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-400" },
  ok: { label: "OK", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  needs_count: { label: "Saknar saldo", cls: "bg-slate-500/10 text-slate-400 border-slate-500/20", dot: "bg-slate-400" },
  no_sales: { label: "Ingen försäljning", cls: "bg-slate-500/10 text-slate-400 border-slate-500/20", dot: "bg-slate-500" },
};

export default function LagerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"count" | "po" | "settings">("count");

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/lager");
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || "Kunde inte hämta lagerdata"); }
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Okänt fel");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/lager/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ days: 60 }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Synk misslyckades");
      toast.success(`Synkat ${nf(j.orders)} ordrar · ${nf(j.rows)} produktdagar`);
      if (j.unmatched?.length) toast.warning(`Omatchade rader: ${j.unmatched.slice(0, 3).join(", ")}`);
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Synk misslyckades");
    } finally { setSyncing(false); }
  };

  const save = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/lager/entry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await res.json();
    if (!res.ok) { toast.error(j.error || "Kunde inte spara"); return false; }
    toast.success("Sparat");
    await fetchData();
    return true;
  };

  const receivePo = async (id: string) => {
    const res = await fetch("/api/lager/entry", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status: "received" }) });
    if (!res.ok) { const j = await res.json(); toast.error(j.error || "Kunde inte uppdatera"); return; }
    toast.success("Order bokad som mottagen");
    await fetchData();
  };

  const [scopes, setScopes] = useState<ScopeState | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  /** Coverage period the user is trying out per product, before saving it. */
  const [coverDraft, setCoverDraft] = useState<Record<string, number>>({});
  /** Extra 512-steps added per product to make the whole order land on full pallets. */
  const [extraSteps, setExtraSteps] = useState<Record<string, number>>({});
  /** Products the user has taken out of this order. */
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const loadShopify = useCallback(async () => {
    try {
      const res = await fetch("/api/lager/shopify?variants=1");
      const j = await res.json();
      if (!res.ok) { setShopifyError(j.error || `Shopify svarade ${res.status}`); return; }
      setShopifyError(null);
      setScopes(j.scopes ?? null);
      if (j.variants) { setVariants(j.variants); setLocationId(j.locationId ?? null); setLocationName(j.locationName ?? null); }
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : "Kunde inte nå Shopify");
    }
  }, []);
  useEffect(() => { loadShopify(); }, [loadShopify]);

  const shopifyAction = async (payload: Record<string, unknown>, okMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch("/api/lager/shopify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json();
      if (!res.ok) { toast.error(j.error || "Misslyckades"); return; }
      toast.success(okMsg);
      await fetchData(); await loadShopify();
    } finally { setBusy(false); }
  };

  const products = useMemo(() => (data?.products ?? []).filter((p) => p.isActive), [data]);
  const alerts = products.filter((p) => p.status === "order_now" || p.status === "soon");
  const openPos = (data?.purchaseOrders ?? []).filter((po) => po.status === "ordered" && !po.receivedOn);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><PackageSearch className="h-6 w-6 text-cyan-400" /> Lager</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Förbrukning från Shopify, saldo du räknar själv, och datumet du senast kan lägga ordern med 4–6 veckors leveranstid.
            {data?.salesFrom && <> Försäljning från {dateSv(data.salesFrom)}.</>}
          </p>
        </div>
        <button onClick={sync} disabled={syncing}
          className="px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Synkar…" : "Synka försäljning"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
          <button onClick={fetchData} className="ml-auto text-xs text-cyan-400 hover:underline">Försök igen</button>
        </div>
      )}

      {(alerts.length > 0 || products.some((p) => p.moq > 0 && p.suggestedUnits > 0)) && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-400" /> Att beställa</h3>
          </div>
          <div className="divide-y divide-white/5">
            {alerts.map((p) => (
              <div key={p.id} className="p-4 flex items-center gap-4 flex-wrap">
                <span className={`h-2 w-2 rounded-full ${STATUS[p.status].dot}`} />
                <div className="min-w-[200px]">
                  <div className="text-sm font-medium text-white">{p.name}</div>
                  <div className="text-xs text-slate-500">
                    {p.stock !== null ? `${nf(p.stock)} ${p.unitLabel} kvar` : "saldo saknas"} · {nf(p.velocity, 1)} {p.unitLabel}/dag
                  </div>
                </div>
                <div className="text-sm text-slate-300">
                  Lägg order senast <b className={p.status === "order_now" ? "text-red-400" : "text-amber-400"}>{dateSv(p.orderByOn)}</b>
                  {p.stockoutOn && <span className="text-slate-500"> · slut {dateSv(p.stockoutOn)}</span>}
                </div>
                {(() => {
                  const cover = coverDraft[p.id] ?? p.targetCoverDays;
                  const base = suggestFor(p, cover);
                  const step = p.moq > 0 ? p.moq : 0;
                  const extra = (extraSteps[p.id] ?? 0) * step;
                  const units = Math.max(0, base.units + extra);
                  const after = (p.stock ?? 0) + p.incomingUnits + units;
                  const sug = {
                    units,
                    days: p.velocity > 0 && units > 0 ? after / p.velocity : null,
                    until: p.velocity > 0 && units > 0 ? shiftDays(new Date().toISOString().slice(0, 10), Math.floor(after / p.velocity)) : null,
                    cost: p.unitCost ? Math.round(units * p.unitCost) : null,
                  };
                  const dirty = cover !== p.targetCoverDays;
                  return (
                    <div className="ml-auto flex items-center gap-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-slate-500">Ska räcka</span>
                        {[45, 60, 90, 120].map((d) => (
                          <button key={d} onClick={() => setCoverDraft({ ...coverDraft, [p.id]: d })}
                            className={`px-2 py-1 rounded text-[11px] border transition-all ${cover === d
                              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                              : "text-slate-400 border-white/5 hover:bg-white/[0.03]"}`}>
                            {d} d
                          </button>
                        ))}
                        <input type="number" min="7" max="365" value={cover}
                          onChange={(e) => setCoverDraft({ ...coverDraft, [p.id]: Math.max(7, Number(e.target.value) || 0) })}
                          className="w-16 px-2 py-1 rounded bg-[#0a0e1a] border border-white/10 text-[11px] text-white focus:border-cyan-500/40 focus:outline-none" />
                        <span className="text-[11px] text-slate-600">el. till</span>
                        <input type="date" value={sug.until ?? ""} min={new Date().toISOString().slice(0, 10)}
                          onChange={(e) => {
                            const d = e.target.value;
                            if (!d) return;
                            // The coverage window starts when the order lands, so subtract the lead time.
                            setCoverDraft({ ...coverDraft, [p.id]: Math.max(0, daysUntil(d) - p.leadTimeMaxDays) });
                          }}
                          className="px-2 py-1 rounded bg-[#0a0e1a] border border-white/10 text-[11px] text-white focus:border-cyan-500/40 focus:outline-none" />
                        {dirty && (
                          <button
                            onClick={async () => {
                              await save({ type: "settings", productId: p.id, targetCoverDays: cover });
                              setCoverDraft({ ...coverDraft, [p.id]: cover });
                            }}
                            className="px-2 py-1 rounded text-[11px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20">
                            Spara
                          </button>
                        )}
                      </div>
                      <div className="text-sm text-slate-300 text-right min-w-[150px]">
                        Beställ <b className="text-white tabular-nums">{nf(sug.units)}</b> {p.unitLabel}
                        {sug.cost !== null && <span className="text-slate-500"> · {nf(sug.cost)} kr</span>}
                        {p.moq > 0 && sug.units > 0 && (
                          <div className="text-xs text-slate-500 flex items-center justify-end gap-1.5">
                            <button onClick={() => setExtraSteps({ ...extraSteps, [p.id]: (extraSteps[p.id] ?? 0) - 1 })}
                              className="px-1.5 rounded border border-white/10 text-slate-400 hover:bg-white/[0.05]" title="ett steg mindre">−</button>
                            {packLabel(sug.units, p.moq)}
                            <button onClick={() => setExtraSteps({ ...extraSteps, [p.id]: (extraSteps[p.id] ?? 0) + 1 })}
                              className="px-1.5 rounded border border-white/10 text-slate-400 hover:bg-white/[0.05]" title="ett steg till">+</button>
                          </div>
                        )}
                        {sug.until && (
                          <div className="text-xs text-slate-500">
                            räcker till {dateSv(sug.until)} · {nf((sug.days ?? 0) / 30, 1)} mån
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <button onClick={() => { setCoverDraft({ ...coverDraft, [p.id]: coverDraft[p.id] ?? p.targetCoverDays }); setOpenId(p.id); setTab("po"); }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 text-xs flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> Registrera order
                </button>
              </div>
            ))}
          </div>
          {(() => {
            // Everything with a suggestion can go in the order, not just what is flagged —
            // filling the pallets with a product you need soon is cheaper than a second shipment.
            const lines = products
              .filter((p) => p.moq > 0 && !excluded[p.id])
              .map((p) => {
                const cover = coverDraft[p.id] ?? p.targetCoverDays;
                const units = Math.max(0, suggestFor(p, cover).units + (extraSteps[p.id] ?? 0) * p.moq);
                return { p, units, steps: units / p.moq };
              })
              .filter((l) => l.units > 0);
            if (!lines.length) return null;
            const totalUnits = lines.reduce((n, l) => n + l.units, 0);
            const totalSteps = Math.round(totalUnits / 512);
            const missing = (3 - (totalSteps % 3)) % 3;
            // Put the extra steps where the stock runs out first.
            const tightest = lines.slice().sort((a, b) => (a.p.daysCover ?? 1e9) - (b.p.daysCover ?? 1e9))[0];
            return (
              <div className="p-4 border-t border-white/5 flex items-center gap-4 flex-wrap bg-white/[0.015]">
                <span className="text-xs text-slate-500 uppercase tracking-wider">Hela ordern</span>
                <span className="text-sm text-white tabular-nums">{nf(totalUnits)} st</span>
                <span className="text-sm text-slate-400">{totalSteps} × 512 · {nf(totalUnits / 1536, 2)} pallar</span>
                <span className="flex items-center gap-1 flex-wrap">
                  {lines.map((l) => (
                    <button key={l.p.id} onClick={() => setExcluded({ ...excluded, [l.p.id]: true })}
                      title="ta bort ur ordern"
                      className="px-2 py-0.5 rounded border border-white/10 text-[11px] text-slate-400 hover:text-red-400 hover:border-red-500/30">
                      {l.p.code} {nf(l.units)} ×
                    </button>
                  ))}
                  {products.filter((p) => p.moq > 0 && excluded[p.id]).map((p) => (
                    <button key={p.id} onClick={() => setExcluded({ ...excluded, [p.id]: false })}
                      title="lägg till i ordern"
                      className="px-2 py-0.5 rounded border border-dashed border-white/10 text-[11px] text-slate-600 hover:text-cyan-400">
                      + {p.code}
                    </button>
                  ))}
                </span>
                {missing === 0 ? (
                  <span className="px-2 py-1 rounded border text-[11px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    hela pallar ✓
                  </span>
                ) : (
                  <>
                    <span className="px-2 py-1 rounded border text-[11px] bg-amber-500/10 text-amber-400 border-amber-500/20">
                      {missing} × 512 kvar till hel pall
                    </span>
                    <button
                      onClick={() => setExtraSteps({ ...extraSteps, [tightest.p.id]: (extraSteps[tightest.p.id] ?? 0) + missing })}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 text-xs">
                      Lägg {missing} × 512 på {tightest.p.name.split(" ").slice(0, 2).join(" ")}
                    </button>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Produkter</h3>
          <span className="text-[11px] text-slate-500">Ledtid {products[0]?.leadTimeMinDays ?? 28}–{products[0]?.leadTimeMaxDays ?? 42} dagar · säkerhetsmarginal {products[0]?.safetyDays ?? 14} dagar</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Produkt</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Saldo</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Per dag</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">7d / 30d</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Räcker</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Slut</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Beställ senast</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">På väg</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Förslag</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Räcker till</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <div className="text-sm text-white">{p.name}</div>
                    <div className="text-[11px] text-slate-600">
                      {p.countedOn ? `räknat ${dateSv(p.countedOn)}: ${nf(p.countUnits ?? 0)} − ${nf(p.soldSinceCount)} sålda${p.receivedSinceCount ? ` + ${nf(p.receivedSinceCount)} mottagna` : ""}` : "inget saldo registrerat"}
                    </div>
                    {p.pace === "rising" && (
                      <div className="text-[10px] text-amber-400 mt-0.5">
                        går {nf((p.v7 / p.v30 - 1) * 100)} % snabbare senaste veckan än snittet — ordern räcker kortare än datumet säger
                      </div>
                    )}
                    {p.pace === "falling" && (
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        nästan stillastående senaste veckan — siffran bygger på en period då annonserna låg nere
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white">{p.stock !== null ? nf(p.stock) : "–"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{nf(p.velocity, 1)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 text-xs">
                    {nf(p.v7, 1)} / {nf(p.v30, 1)}
                    {p.trend !== null && Math.abs(p.trend) >= 0.15 && (
                      <span className={p.trend > 0 ? " text-emerald-400" : " text-amber-400"}> {p.trend > 0 ? "▲" : "▼"}{nf(Math.abs(p.trend) * 100)}%</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{p.daysCover !== null ? `${nf(p.daysCover)} d` : "–"}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{dateSv(p.stockoutOn)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <span className={p.status === "order_now" ? "text-red-400 font-medium" : p.status === "soon" ? "text-amber-400 font-medium" : "text-slate-400"}>
                      {dateSv(p.orderByOn)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">
                    {p.incomingUnits ? <>{nf(p.incomingUnits)}<div className="text-[10px] text-slate-600">ETA {dateSv(p.nextEta)}</div></> : "–"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white">{p.suggestedUnits ? nf(p.suggestedUnits) : "–"}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">
                    {p.suggestedUntil ? <>{dateSv(p.suggestedUntil)}<div className="text-[10px] text-slate-600">{nf((p.suggestedCoversDays ?? 0) / 30, 1)} mån efter {p.targetCoverDays} d täckning</div></> : "–"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block px-2 py-0.5 rounded border text-[11px] ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => { setOpenId(openId === p.id ? null : p.id); setTab("count"); }}
                      className="text-xs text-cyan-400 hover:underline">{openId === p.id ? "Stäng" : "Uppdatera"}</button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-slate-500">Inga produkter ännu. Kör &quot;Synka försäljning&quot; för att fylla listan.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Link2 className="h-4 w-4 text-cyan-400" /> Shopify-koppling{locationName && <span className="text-[11px] font-normal text-slate-500">· lagerplats {locationName}</span>}</h3>
          {scopes?.canWrite && (
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => shopifyAction({ action: "pull" }, "Saldon hämtade från Shopify")}
                className="px-3 py-1.5 rounded-lg border border-white/5 text-slate-300 hover:bg-white/[0.02] text-xs flex items-center gap-1.5 disabled:opacity-50">
                <Download className="h-3.5 w-3.5" /> Hämta från Shopify
              </button>
              <button disabled={busy} onClick={() => shopifyAction({ action: "push" }, "Saldon skickade till Shopify")}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 text-xs flex items-center gap-1.5 disabled:opacity-50">
                <Upload className="h-3.5 w-3.5" /> Skicka alla saldon
              </button>
            </div>
          )}
        </div>

        {shopifyError && (
          <div className="p-4 border-b border-white/5 bg-red-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div className="text-xs text-slate-300">
                <b className="text-red-400">Kommer inte åt Shopify.</b> {shopifyError}
              </div>
            </div>
          </div>
        )}

        {scopes && !scopes.canWrite && (
          <div className="p-4 border-b border-white/5 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="text-xs text-slate-300 space-y-1.5">
                <p><b className="text-amber-400">Shopify saknar behörighet.</b> Appen har i dag {scopes.scopes.join(", ") || "inga scopes"}. För att lagret ska kunna styras härifrån behövs: <code className="text-cyan-400">{scopes.missing.join(", ")}</code>.</p>
                <p className="text-slate-500">Shopify-admin → Inställningar → Appar och försäljningskanaler → Utveckla appar → välj appen → Konfiguration → Admin API-åtkomstomfång → bocka i scopen → Spara och installera om. Sidan plockar upp det automatiskt.</p>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Produkt</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Kopplad Shopify-variant</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Vårt saldo</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Senast skickat</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const linked = variants.find((v) => v.variantId === p.shopifyVariantId);
                return (
                  <tr key={p.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-sm text-white">{p.name}</td>
                    <td className="px-4 py-2.5">
                      {scopes?.canRead ? (
                        <select
                          className="w-full max-w-[420px] px-2 py-1.5 rounded-lg bg-[#0a0e1a] border border-white/10 text-xs text-white focus:border-cyan-500/40 focus:outline-none"
                          value={p.shopifyVariantId ?? ""}
                          onChange={(e) => {
                            const v = variants.find((x) => x.variantId === e.target.value);
                            shopifyAction(
                              { action: "map", productId: p.id, variantId: v?.variantId ?? null, inventoryItemId: v?.inventoryItemId ?? null, locationId },
                              v ? `${p.name} kopplad` : "Koppling borttagen"
                            );
                          }}>
                          <option value="">— inte kopplad —</option>
                          {variants.map((v) => (
                            <option key={v.variantId} value={v.variantId}>
                              {v.productTitle}{v.variantTitle ? ` · ${v.variantTitle}` : ""}{v.sku ? ` · sku ${v.sku}` : ""}
                              {v.tracked ? ` · lager ${v.available ?? "?"}` : " · spårar ej lager"}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-600">{p.shopifyVariantId ? `variant ${p.shopifyVariantId}` : "kan inte läsas utan scopes"}</span>
                      )}
                      {linked && !linked.tracked && (
                        <div className="text-[10px] text-amber-400 mt-1">Varianten spårar inte lager i Shopify — slå på &quot;Spåra kvantitet&quot; på produkten.</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-white">{p.stock !== null ? nf(p.stock) : "–"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-400 text-xs">
                      {p.shopifyLastPushedUnits !== null ? nf(p.shopifyLastPushedUnits) : "–"}
                      {p.shopifySyncedAt && <div className="text-[10px] text-slate-600">{new Date(p.shopifySyncedAt).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {scopes?.canWrite && p.shopifyVariantId && p.stock !== null && (
                        <button disabled={busy} onClick={() => shopifyAction({ action: "push", productId: p.id }, `${p.name}: saldo skickat`)}
                          className="text-xs text-cyan-400 hover:underline disabled:opacity-50">Skicka</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-white/5 text-[11px] text-slate-600">
          Förslaget täcker leveranstiden plus den period du valt per produkt, minus det du har och det som är på väg, och rundas upp till närmaste
          hela steg — en pall rymmer 1 536 burkar och delas bara i tre, så 512 är minsta beställningsbara mängd.
          Kolumnen &quot;Räcker till&quot; är datumet lagret tar slut om du lägger ordern i dag och förbrukningen står still.
        </div>
        <div className="p-3 border-t border-white/5 text-[11px] text-slate-600">
          Flera Shopify-listningar kan sälja mot samma fysiska lager — koppla bara den variant som faktiskt spårar kvantitet.
          Försäljning på dubbletterna räknas ändå av, eftersom förbrukningen matchas på produktnamn och sku.
        </div>
      </div>

      {openId && (() => {
        const p = products.find((x) => x.id === openId);
        if (!p) return null;
        return (
          <div className="rounded-xl border border-cyan-500/20 bg-[#111827] overflow-hidden">
            <div className="p-4 border-b border-white/5 flex items-center gap-4">
              <h3 className="text-sm font-semibold text-white">{p.name}</h3>
              <div className="flex gap-1 ml-auto">
                {([["count", "Räkna saldo"], ["po", "Lägg order"], ["settings", "Inställningar"]] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${tab === k ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" : "text-slate-400 border-white/5 hover:bg-white/[0.02]"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4">
              {tab === "count" && <CountForm product={p} onSave={save} />}
              {tab === "po" && (
                <PoForm product={p} onSave={save}
                  presetUnits={Math.max(0, suggestFor(p, coverDraft[p.id] ?? p.targetCoverDays).units + (extraSteps[p.id] ?? 0) * (p.moq || 0))} />
              )}
              {tab === "settings" && <SettingsForm product={p} onSave={save} />}
            </div>
          </div>
        );
      })()}

      {openPos.length > 0 && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Truck className="h-4 w-4 text-cyan-400" /> Lagda ordrar</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Produkt</th>
                <th className="text-right text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Antal</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">Lagd</th>
                <th className="text-left text-[10px] text-slate-500 uppercase tracking-wider px-4 py-2">ETA</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {openPos.map((po) => (
                <tr key={po.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 text-sm text-slate-300">{products.find((p) => p.id === po.productId)?.name ?? po.productId}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-white">{nf(po.units)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{dateSv(po.orderedOn)}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-400">{dateSv(po.etaOn)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => receivePo(po.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 text-xs flex items-center gap-1.5 ml-auto">
                      <Check className="h-3.5 w-3.5" /> Mottagen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full px-3 py-2 rounded-lg bg-[#0a0e1a] border border-white/10 text-sm text-white focus:border-cyan-500/40 focus:outline-none";
const labelCls = "text-[11px] font-medium text-slate-400 block mb-1";
const btnCls = "px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all text-sm";

function CountForm({ product, onSave }: { product: Forecast; onSave: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [units, setUnits] = useState("");
  const [countedOn, setCountedOn] = useState(new Date().toISOString().slice(0, 10));
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Ange saldot som det är när du räknar. Försäljning efter det datumet dras av automatiskt, och mottagna ordrar läggs till.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div><label className={labelCls}>Antal {product.unitLabel}</label>
          <input className={inputCls} type="number" min="0" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="t.ex. 1200" /></div>
        <div><label className={labelCls}>Räknat datum</label>
          <input className={inputCls} type="date" value={countedOn} onChange={(e) => setCountedOn(e.target.value)} /></div>
        <div className="flex items-end">
          <button className={btnCls} onClick={async () => { if (await onSave({ type: "count", productId: product.id, units, countedOn })) setUnits(""); }}>Spara saldo</button>
        </div>
      </div>
    </div>
  );
}

function PoForm({ product, onSave, presetUnits }: { product: Forecast; onSave: (p: Record<string, unknown>) => Promise<boolean>; presetUnits?: number }) {
  const [units, setUnits] = useState(String(presetUnits || product.suggestedUnits || ""));
  const [orderedOn, setOrderedOn] = useState(new Date().toISOString().slice(0, 10));
  const [etaOn, setEtaOn] = useState(() => shiftDays(new Date().toISOString().slice(0, 10), product.leadTimeMaxDays));
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Förslaget täcker {product.targetCoverDays} dagars försäljning plus leveranstiden, minus det du har och det som redan är på väg.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div><label className={labelCls}>Antal {product.unitLabel}</label>
          <input className={inputCls} type="number" min="1" value={units} onChange={(e) => setUnits(e.target.value)} /></div>
        <div><label className={labelCls}>Orderdatum</label>
          <input className={inputCls} type="date" value={orderedOn} onChange={(e) => setOrderedOn(e.target.value)} /></div>
        <div><label className={labelCls}>Beräknad ankomst</label>
          <input className={inputCls} type="date" value={etaOn} onChange={(e) => setEtaOn(e.target.value)} /></div>
        <div className="flex items-end">
          <button className={btnCls} onClick={() => onSave({ type: "po", productId: product.id, units, orderedOn, etaOn })}>Spara order</button>
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ product, onSave }: { product: Forecast; onSave: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [f, setF] = useState({
    leadTimeMinDays: String(product.leadTimeMinDays), leadTimeMaxDays: String(product.leadTimeMaxDays),
    safetyDays: String(product.safetyDays), targetCoverDays: String(product.targetCoverDays),
    velocityBasisDays: String(product.velocityBasisDays), moq: String(product.moq),
    unitCost: product.unitCost === null ? "" : String(product.unitCost),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div><label className={labelCls}>Ledtid min (d)</label><input className={inputCls} type="number" value={f.leadTimeMinDays} onChange={set("leadTimeMinDays")} /></div>
        <div><label className={labelCls}>Ledtid max (d)</label><input className={inputCls} type="number" value={f.leadTimeMaxDays} onChange={set("leadTimeMaxDays")} /></div>
        <div><label className={labelCls}>Säkerhet (d)</label><input className={inputCls} type="number" value={f.safetyDays} onChange={set("safetyDays")} /></div>
        <div><label className={labelCls}>Täcka (d)</label><input className={inputCls} type="number" value={f.targetCoverDays} onChange={set("targetCoverDays")} /></div>
        <div><label className={labelCls}>Snitt på</label>
          <select className={inputCls} value={f.velocityBasisDays} onChange={set("velocityBasisDays")}>
            <option value="7">7 dagar</option><option value="14">14 dagar</option><option value="30">30 dagar</option><option value="60">60 dagar</option>
          </select></div>
        <div><label className={labelCls}>Steg (st)</label><input className={inputCls} type="number" value={f.moq} onChange={set("moq")} placeholder="512" /></div>
        <div><label className={labelCls}>Inköpspris</label><input className={inputCls} type="number" step="0.01" value={f.unitCost} onChange={set("unitCost")} /></div>
      </div>
      <button className={btnCls} onClick={() => onSave({ type: "settings", productId: product.id, ...f })}>
        <Settings2 className="h-3.5 w-3.5 inline mr-1.5" />Spara inställningar
      </button>
    </div>
  );
}
