"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronDown, Loader2, Plus, Trash2, CalendarDays, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LearningLoopData } from "@/lib/learning-loop/rows";
import { fmtMoney, fmtNum, fmtPct, fmtX } from "./format";

interface Entry {
  id: string;
  adAccountId: string | null;
  entryDate: string;
  kind: "note" | "weekly_recap";
  title: string | null;
  body: string;
  authorName: string | null;
  createdAt: string;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Week label like "v.36 · 1–7 sep" for the recap title. */
function weekLabel(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `Weekly recap v.${week}`;
}

/** The recap draft: the week's numbers, winners, losers and written learnings — a starting point, not the recap itself. */
function draftRecap(data: LearningLoopData, currency: string): string {
  const s = data.summary;
  const tests = data.rows.filter((r) => !r.isContainer);
  const winners = tests.filter((r) => r.outcome === "winner").sort((a, b) => b.window.spend - a.window.spend).slice(0, 5);
  const losers = tests.filter((r) => r.outcome === "loser").sort((a, b) => b.window.spend - a.window.spend).slice(0, 5);
  const learned = tests.filter((r) => r.learning?.learning?.trim()).slice(0, 6);
  const lines = [
    `Period: ${data.since ?? "lifetime"} → ${data.until}`,
    `Spend ${fmtMoney(s.spend, currency)} · ROAS ${fmtX(s.roas)} (mål ${data.settings.targetRoas}x) · ${fmtNum(s.purchases)} köp · CPA ${s.cpa > 0 ? fmtMoney(s.cpa, currency) : "–"}`,
    `Tester: ${s.tests} (${s.live} live) · bedömda ${s.judged} · vinnare ${s.winners} · losers ${s.losers} · hit rate ${s.judged > 0 ? fmtPct(s.hitRate, 0) : "–"}`,
    "",
    "VINNARE",
    ...(winners.length ? winners.map((r) => `- ${r.name} — ${fmtMoney(r.window.spend, currency)} @ ${fmtX(r.window.roas)}${r.learning?.learning ? ` — ${r.learning.learning}` : ""}`) : ["- (inga)"]),
    "",
    "LOSERS",
    ...(losers.length ? losers.map((r) => `- ${r.name} — ${fmtMoney(r.window.spend, currency)} @ ${fmtX(r.window.roas)}${r.learning?.why ? ` — ${r.learning.why}` : ""}`) : ["- (inga)"]),
    "",
    "LÄRDOMAR",
    ...(learned.length ? learned.map((r) => `- ${r.learning!.learning}`) : ["- (skriv lärdomar på raderna så hamnar de här)"]),
    "",
    "NÄSTA VECKA",
    ...tests.filter((r) => r.learning?.next?.trim()).slice(0, 6).map((r) => `- ${r.learning!.next}`),
    "- ",
  ];
  return lines.join("\n");
}

/**
 * The Growth Guide's "Meta Ads Log", inside the app: dated notes and a weekly
 * recap whose first draft is written from the week's numbers.
 */
export function Journal({ account, data, currency }: { account: string; data: LearningLoopData; currency: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState<null | { kind: "note" | "weekly_recap"; date: string; title: string; body: string }>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/learning-loop/journal?account=${encodeURIComponent(account || "all")}&limit=60`);
      if (res.ok) setEntries(((await res.json()).entries ?? []) as Entry[]);
    } catch { /* keep old */ } finally { setLoading(false); }
  }, [account]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!composing || !composing.body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/learning-loop/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: account || null, date: composing.date, kind: composing.kind, title: composing.title || null, body: composing.body }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara");
      setComposing(null);
      toast.success(composing.kind === "weekly_recap" ? "Weekly recap sparad" : "Anteckning sparad");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Ta bort anteckningen?")) return;
    const res = await fetch("/api/learning-loop/journal", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (res.ok) load(); else toast.error("Kunde inte ta bort");
  };

  const latestRecap = entries.find((e) => e.kind === "weekly_recap");

  return (
    <div className="rounded-xl border border-white/5 bg-[#111827]">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-3 text-left">
          <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform", open && "rotate-180")} />
          <BookOpen className="h-4 w-4 text-amber-300" />
          <span className="text-sm font-semibold text-white">Meta Ads Log</span>
          <span className="text-xs text-slate-500">{entries.length} anteckningar{latestRecap ? ` · senaste recap ${latestRecap.entryDate.slice(0, 10)}` : " · ingen weekly recap än"}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => { setOpen(true); setComposing({ kind: "note", date: isoToday(), title: "", body: "" }); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5">
            <Plus className="h-3.5 w-3.5" /> Anteckning
          </button>
          <button type="button" onClick={() => { setOpen(true); setComposing({ kind: "weekly_recap", date: isoToday(), title: weekLabel(), body: draftRecap(data, currency) }); }} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20">
            <Sparkles className="h-3.5 w-3.5" /> Weekly recap
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/5">
          {composing && (
            <div className="space-y-2 border-b border-white/5 bg-white/[0.02] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded px-2 py-0.5 text-[11px]", composing.kind === "weekly_recap" ? "bg-amber-500/10 text-amber-200" : "bg-white/5 text-slate-300")}>{composing.kind === "weekly_recap" ? "Weekly recap" : "Anteckning"}</span>
                <input type="date" value={composing.date} onChange={(e) => setComposing({ ...composing, date: e.target.value })} className="h-8 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white outline-none" />
                <input value={composing.title} onChange={(e) => setComposing({ ...composing, title: e.target.value })} placeholder="Rubrik (valfri)" className="h-8 min-w-[200px] flex-1 rounded-md border border-white/10 bg-white/5 px-2 text-xs text-white placeholder:text-slate-600 outline-none" />
              </div>
              <textarea value={composing.body} onChange={(e) => setComposing({ ...composing, body: e.target.value })} rows={composing.kind === "weekly_recap" ? 14 : 4}
                placeholder="Vad gjorde vi idag, vad såg vi, vad bestämde vi?"
                className="w-full resize-y rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50" />
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setComposing(null)} className="rounded-lg px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5">Avbryt</button>
                <button type="button" onClick={save} disabled={saving || !composing.body.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Spara
                </button>
              </div>
            </div>
          )}
          <div className="max-h-[420px] divide-y divide-white/[0.04] overflow-y-auto">
            {loading && entries.length === 0 && <div className="px-4 py-6 text-center text-sm text-slate-500"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
            {!loading && entries.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-600">Tomt. Skriv dagens anteckning eller generera veckans recap.</p>}
            {entries.map((e) => (
              <div key={e.id} className="group px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <span className="text-slate-300">{e.entryDate.slice(0, 10)}</span>
                    <span className={cn("rounded px-1.5 py-px text-[10px]", e.kind === "weekly_recap" ? "bg-amber-500/10 text-amber-200" : "bg-white/5 text-slate-400")}>{e.kind === "weekly_recap" ? "Weekly recap" : "Anteckning"}</span>
                    {e.title && <span className="font-medium text-slate-200">{e.title}</span>}
                    {e.authorName && <span>· {e.authorName}</span>}
                  </div>
                  <button type="button" onClick={() => remove(e.id)} className="text-slate-700 opacity-0 hover:text-red-400 group-hover:opacity-100" title="Ta bort"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-300">{e.body}</pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
