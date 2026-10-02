"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Store, RefreshCw, AlertTriangle, Plus, Phone, Mail, Globe, Download, Search, ChevronDown, ChevronRight, X, History } from "lucide-react";
import { toast } from "sonner";
import { LEAD_STATUSES, CALL_OUTCOMES, statusMeta } from "@/lib/butiker/status";

type Lead = {
  id: string; name: string; type: string | null; address: string | null; postalCode: string | null;
  city: string | null; county: string | null; phone: string | null; email: string | null; website: string | null;
  brands: string | null; companyForm: string | null; source: string | null; status: string; ownerName: string | null;
  nextActionOn: string | null; lastContactAt: string | null; callCount: number; lastNote: string | null;
  createdAt: string; updatedAt: string;
};
type LeadEvent = { id: string; leadId: string; kind: string; outcome: string | null; note: string | null; byName: string | null; createdAt: string };
type Payload = { leads: Lead[]; events: LeadEvent[]; me: string | null };

const todayIso = () => new Date().toISOString().slice(0, 10);
const dateSv = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T00:00:00" : s).toLocaleDateString("sv-SE", { day: "numeric", month: "short" }) : "–");
const timeSv = (s: string) => new Date(s).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, "")}`;
const webHref = (w: string) => (w.startsWith("http") ? w : `https://${w}`);
/** Enskild firma counts as a private person: no sales email without consent. */
const isEF = (l: Lead) => /enskild|^ef$/i.test(l.companyForm ?? "");
const outcomeLabel = (k: string | null) => CALL_OUTCOMES.find((o) => o.key === k)?.label ?? statusMeta(k ?? "ny").label;
const PAGE = 150;

export default function ButikerPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [county, setCounty] = useState("");
  const [status, setStatus] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [onlyPhone, setOnlyPhone] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, LeadEvent[]>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [nextDraft, setNextDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLead, setNewLead] = useState({ name: "", city: "", county: "", phone: "", email: "", website: "", type: "" });

  const fetchData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await fetch("/api/butiker", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte läsa butikerna");
      setData(json); setError(null);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "Kunde inte läsa butikerna");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  // Live: pick up what the others log, unless someone is typing in an open row.
  useEffect(() => {
    const t = setInterval(() => { if (!open && document.visibilityState === "visible") fetchData(true); }, 20000);
    return () => clearInterval(t);
  }, [fetchData, open]);

  const leads = useMemo(() => data?.leads ?? [], [data]);
  const counties = useMemo(() => [...new Set(leads.map((l) => l.county).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "sv")), [leads]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) c[l.status] = (c[l.status] ?? 0) + 1;
    return c;
  }, [leads]);
  const today = todayIso();
  const isDue = (l: Lead) => l.status === "ny" || (!!l.nextActionOn && l.nextActionOn <= today && !["kund", "nej", "fel_nummer"].includes(l.status));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (county && l.county !== county) return false;
      if (status && l.status !== status) return false;
      if (onlyPhone && !l.phone) return false;
      if (onlyDue && !isDue(l)) return false;
      if (needle) {
        const hay = [l.name, l.city, l.county, l.phone, l.email, l.brands, l.type, l.ownerName, l.lastNote].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, q, county, status, onlyPhone, onlyDue, today]);

  const callsToday = useMemo(() => {
    const by: Record<string, number> = {};
    for (const e of data?.events ?? []) {
      if (e.kind !== "call" || e.createdAt.slice(0, 10) !== today) continue;
      const k = e.byName ?? "Okänd";
      by[k] = (by[k] ?? 0) + 1;
    }
    return Object.entries(by).sort((a, b) => b[1] - a[1]);
  }, [data, today]);

  const leadName = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  async function loadHistory(id: string) {
    const res = await fetch(`/api/butiker/${id}`, { cache: "no-store" });
    const json = await res.json();
    if (res.ok) setHistory((h) => ({ ...h, [id]: json.events }));
  }

  function toggle(id: string) {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    loadHistory(id);
  }

  async function act(id: string, body: Record<string, unknown>, okMsg: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/butiker/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte spara");
      setData((d) => (d ? { ...d, leads: d.leads.map((l) => (l.id === id ? json.lead : l)) } : d));
      setNoteDraft((n) => ({ ...n, [id]: "" }));
      setNextDraft((n) => ({ ...n, [id]: "" }));
      toast.success(okMsg);
      loadHistory(id);
      fetchData(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setBusy(null);
    }
  }

  async function addLead() {
    if (!newLead.name.trim()) { toast.error("Ange butikens namn"); return; }
    const res = await fetch("/api/butiker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newLead) });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error ?? "Kunde inte spara"); return; }
    toast.success(`${json.lead.name} tillagd`);
    setNewLead({ name: "", city: "", county: "", phone: "", email: "", website: "", type: "" });
    setAdding(false);
    fetchData(true);
  }

  /** Excel-friendly CSV (semicolon + BOM) of exactly what the filters show. */
  function exportCsv() {
    const cols: [string, (l: Lead) => string | number | null][] = [
      ["Butik", (l) => l.name], ["Typ", (l) => l.type], ["Ort", (l) => l.city], ["Län", (l) => l.county],
      ["Adress", (l) => [l.address, l.postalCode].filter(Boolean).join(", ")], ["Telefon", (l) => l.phone],
      ["E-post", (l) => l.email], ["Webb", (l) => l.website], ["Märken idag", (l) => l.brands], ["Bolagsform", (l) => l.companyForm],
      ["Status", (l) => statusMeta(l.status).label], ["Samtal", (l) => l.callCount], ["Senast kontakt", (l) => (l.lastContactAt ? timeSv(l.lastContactAt) : "")],
      ["Nästa", (l) => l.nextActionOn], ["Ansvarig", (l) => l.ownerName], ["Senaste anteckning", (l) => l.lastNote],
    ];
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [cols.map((c) => esc(c[0])).join(";"), ...filtered.map((l) => cols.map((c) => esc(c[1](l))).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `butiker-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const contacted = leads.length - (counts.ny ?? 0);
  const input = "bg-[#0a0e1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Store className="h-6 w-6 text-cyan-400" /> Butiker (B2B)</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Ringlistan till fristående butiker. Allt som loggas syns direkt för alla. Listan uppdateras själv var 20:e sekund.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAdding((a) => !a)}
            className="px-3 py-2 rounded-lg text-sm text-slate-300 border border-white/10 hover:bg-white/[0.03] flex items-center gap-2">
            <Plus className="h-4 w-4" /> Lägg till butik
          </button>
          <button onClick={exportCsv} disabled={!filtered.length}
            className="px-3 py-2 rounded-lg text-sm text-slate-300 border border-white/10 hover:bg-white/[0.03] flex items-center gap-2 disabled:opacity-40">
            <Download className="h-4 w-4" /> Excel
          </button>
          <button onClick={() => fetchData()} disabled={loading}
            className="px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 flex items-center gap-2 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <span className="text-sm text-red-300">{error}</span>
          <button onClick={() => fetchData()} className="ml-auto text-xs text-cyan-400 hover:underline">Försök igen</button>
        </div>
      )}

      {adding && (
        <div className="rounded-xl border border-white/5 bg-[#111827] p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <input className={input} placeholder="Butikens namn *" value={newLead.name} onChange={(e) => setNewLead({ ...newLead, name: e.target.value })} />
            <input className={input} placeholder="Ort" value={newLead.city} onChange={(e) => setNewLead({ ...newLead, city: e.target.value })} />
            <input className={input} placeholder="Län" value={newLead.county} onChange={(e) => setNewLead({ ...newLead, county: e.target.value })} />
            <input className={input} placeholder="Typ (zoobutik, hundtrim …)" value={newLead.type} onChange={(e) => setNewLead({ ...newLead, type: e.target.value })} />
            <input className={input} placeholder="Telefon" value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} />
            <input className={input} placeholder="E-post" value={newLead.email} onChange={(e) => setNewLead({ ...newLead, email: e.target.value })} />
            <input className={input} placeholder="Webb" value={newLead.website} onChange={(e) => setNewLead({ ...newLead, website: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={addLead} className="flex-1 px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 text-sm">Spara</button>
              <button onClick={() => setAdding(false)} className="px-3 py-2 rounded-lg text-slate-400 border border-white/10 hover:bg-white/[0.03]"><X className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline: click a stage to filter on it */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-2">
        <button onClick={() => setStatus("")}
          className={`rounded-xl border p-3 text-left transition-all ${status === "" ? "border-cyan-500/30 bg-cyan-500/5" : "border-white/5 bg-[#111827] hover:bg-white/[0.03]"}`}>
          <div className="text-[11px] text-slate-500">Alla</div>
          <div className="text-xl font-semibold text-white">{leads.length}</div>
          <div className="text-[11px] text-slate-500">{contacted} kontaktade</div>
        </button>
        {LEAD_STATUSES.map((s) => (
          <button key={s.key} onClick={() => setStatus(status === s.key ? "" : s.key)}
            className={`rounded-xl border p-3 text-left transition-all ${status === s.key ? "border-cyan-500/30 bg-cyan-500/5" : "border-white/5 bg-[#111827] hover:bg-white/[0.03]"}`}>
            <div className="text-[11px] text-slate-500 truncate">{s.label}</div>
            <div className="text-xl font-semibold text-white">{counts[s.key] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
        <div className="space-y-3 min-w-0">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className={`${input} w-full pl-9`} placeholder="Sök butik, ort, märke, anteckning …" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
            </div>
            <select className={input} value={county} onChange={(e) => { setCounty(e.target.value); setLimit(PAGE); }}>
              <option value="">Alla län</option>
              {counties.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-400 px-2 cursor-pointer">
              <input type="checkbox" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Att ringa i dag
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-400 px-2 cursor-pointer">
              <input type="checkbox" checked={onlyPhone} onChange={(e) => setOnlyPhone(e.target.checked)} /> Har telefon
            </label>
            <span className="text-xs text-slate-500 ml-auto">{filtered.length} butiker</span>
          </div>

          <div className="rounded-xl border border-white/5 bg-[#111827] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-white/5">
                  <th className="text-left font-medium px-3 py-2 w-8"></th>
                  <th className="text-left font-medium px-3 py-2">Butik</th>
                  <th className="text-left font-medium px-3 py-2">Ort</th>
                  <th className="text-left font-medium px-3 py-2">Kontakt</th>
                  <th className="text-left font-medium px-3 py-2">Status</th>
                  <th className="text-left font-medium px-3 py-2">Senast</th>
                  <th className="text-left font-medium px-3 py-2">Nästa</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-500">Laddar …</td></tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-500">
                    {leads.length === 0 ? "Inga butiker inlästa än." : "Inga butiker matchar filtren."}
                  </td></tr>
                )}
                {filtered.slice(0, limit).map((l) => {
                  const s = statusMeta(l.status);
                  const isOpen = open === l.id;
                  const overdue = !!l.nextActionOn && l.nextActionOn < today && !["kund", "nej", "fel_nummer"].includes(l.status);
                  return (
                    <Fragment key={l.id}>
                      <tr className={`border-b border-white/5 hover:bg-white/[0.02] cursor-pointer ${isOpen ? "bg-white/[0.03]" : ""}`} onClick={() => toggle(l.id)}>
                        <td className="px-3 py-2 text-slate-500">{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        <td className="px-3 py-2">
                          <div className="text-white font-medium">{l.name}</div>
                          <div className="text-[11px] text-slate-500">
                            {[l.type, l.brands && `säljer ${l.brands}`].filter(Boolean).join(" · ")}
                            {isEF(l) && <span className="ml-1 text-amber-400">· EF – ring, mejla inte</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-300 whitespace-nowrap">
                          {l.city ?? "–"}<div className="text-[11px] text-slate-500">{l.county}</div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          {l.phone && <a href={telHref(l.phone)} className="flex items-center gap-1.5 text-cyan-400 hover:underline"><Phone className="h-3.5 w-3.5" />{l.phone}</a>}
                          {l.email && <a href={`mailto:${l.email}`} className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs"><Mail className="h-3 w-3" />{l.email}</a>}
                          {!l.phone && !l.email && l.website && <a href={webHref(l.website)} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-slate-400 hover:text-white text-xs"><Globe className="h-3 w-3" />webb</a>}
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <select value={l.status} disabled={busy === l.id}
                            onChange={(e) => act(l.id, { action: "status", status: e.target.value }, `${l.name}: ${statusMeta(e.target.value).label}`)}
                            className={`text-xs rounded-md border px-2 py-1 bg-transparent ${s.cls}`}>
                            {LEAD_STATUSES.map((x) => <option key={x.key} value={x.key} className="bg-[#111827] text-white">{x.label}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400 whitespace-nowrap">
                          {l.lastContactAt ? <>{dateSv(l.lastContactAt)} · {l.callCount} samtal<div className="text-slate-500">{l.ownerName}</div></> : "–"}
                        </td>
                        <td className={`px-3 py-2 text-xs whitespace-nowrap ${overdue ? "text-red-400" : "text-slate-400"}`}>{dateSv(l.nextActionOn)}</td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-white/5 bg-[#0d1322]">
                          <td colSpan={7} className="px-4 py-4">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                              <div className="space-y-3">
                                <div className="text-xs text-slate-500">Logga samtal{data?.me ? ` som ${data.me}` : ""}</div>
                                <textarea className={`${input} w-full`} rows={2} placeholder="Vad sa de? Vem pratade du med?"
                                  value={noteDraft[l.id] ?? ""} onChange={(e) => setNoteDraft({ ...noteDraft, [l.id]: e.target.value })} />
                                <div className="flex items-center gap-2 text-xs text-slate-400">
                                  Nästa kontakt
                                  <input type="date" className={input} value={nextDraft[l.id] ?? ""} onChange={(e) => setNextDraft({ ...nextDraft, [l.id]: e.target.value })} />
                                  <span className="text-slate-600">(tomt = sätts automatiskt)</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {CALL_OUTCOMES.map((o) => (
                                    <button key={o.key} disabled={busy === l.id}
                                      onClick={() => act(l.id, { action: "call", outcome: o.key, note: noteDraft[l.id], nextActionOn: nextDraft[l.id] }, `Samtal loggat: ${o.label}`)}
                                      className={`px-3 py-1.5 rounded-lg text-xs border transition-all disabled:opacity-50 ${statusMeta(o.status).cls} hover:brightness-125`}>
                                      {o.label}
                                    </button>
                                  ))}
                                  <button disabled={busy === l.id || !(noteDraft[l.id] ?? "").trim()}
                                    onClick={() => act(l.id, { action: "note", note: noteDraft[l.id] }, "Anteckning sparad")}
                                    className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-300 hover:bg-white/[0.03] disabled:opacity-40">
                                    Bara anteckning
                                  </button>
                                </div>
                                {isEF(l) && (
                                  <p className="text-[11px] text-amber-400/80">Enskild firma: mejla bara om de har sagt ja i telefon. Välj då ”Ja, mejla villkoren”, så sparas samtycket med datum.</p>
                                )}
                                <div className="text-[11px] text-slate-500 space-y-0.5 pt-2 border-t border-white/5">
                                  {(l.address || l.postalCode) && <div>{[l.address, l.postalCode, l.city].filter(Boolean).join(", ")}</div>}
                                  {l.website && <div><a href={webHref(l.website)} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">{l.website}</a></div>}
                                  <div>Bolagsform: {l.companyForm ?? "okänd (behandla som EF)"} · Källa: {l.source ?? "–"}</div>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-slate-500 mb-2 flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> Historik</div>
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                  {(history[l.id] ?? []).length === 0 && <div className="text-xs text-slate-600">Inget loggat än.</div>}
                                  {(history[l.id] ?? []).map((e) => (
                                    <div key={e.id} className="text-xs">
                                      <span className="text-slate-500">{timeSv(e.createdAt)}</span>{" "}
                                      <span className="text-slate-300">{e.byName ?? "Okänd"}</span>{" "}
                                      {e.kind === "call" && <span className="text-cyan-400">ringde – {outcomeLabel(e.outcome)}</span>}
                                      {e.kind === "status" && <span className="text-violet-300">status: {statusMeta(e.outcome ?? "ny").label}</span>}
                                      {e.note && <div className="text-slate-400 pl-2 border-l border-white/10 mt-0.5">{e.note}</div>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > limit && (
              <button onClick={() => setLimit(limit + PAGE)} className="w-full py-3 text-sm text-cyan-400 hover:bg-white/[0.02]">
                Visa fler ({filtered.length - limit} kvar)
              </button>
            )}
          </div>
        </div>

        {/* Shared activity: what everyone has done */}
        <div className="space-y-4">
          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <div className="text-xs text-slate-500 mb-2">Samtal i dag</div>
            {callsToday.length === 0 ? <div className="text-sm text-slate-600">Inga än.</div> : callsToday.map(([who, n]) => (
              <div key={who} className="flex justify-between text-sm"><span className="text-slate-300">{who}</span><span className="text-white font-medium">{n}</span></div>
            ))}
          </div>
          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
            <div className="text-xs text-slate-500 mb-2">Senaste aktivitet</div>
            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {(data?.events ?? []).slice(0, 60).map((e) => {
                const l = leadName.get(e.leadId);
                return (
                  <button key={e.id} onClick={() => l && toggle(l.id)} className="block text-left text-xs w-full hover:bg-white/[0.02] rounded">
                    <span className="text-slate-300">{e.byName ?? "Okänd"}</span>{" "}
                    <span className="text-slate-500">{e.kind === "call" ? "ringde" : e.kind === "status" ? "ändrade" : "skrev om"}</span>{" "}
                    <span className="text-white">{l?.name ?? "borttagen butik"}</span>
                    {e.kind === "call" && <span className="text-cyan-400"> – {outcomeLabel(e.outcome)}</span>}
                    {e.kind === "status" && <span className="text-violet-300"> → {statusMeta(e.outcome ?? "ny").label}</span>}
                    <div className="text-slate-600">{timeSv(e.createdAt)}</div>
                  </button>
                );
              })}
              {(data?.events ?? []).length === 0 && <div className="text-sm text-slate-600">Inget loggat än.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
