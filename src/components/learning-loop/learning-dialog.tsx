"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FlaskConical, GitBranch, Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LearningNote, LoopAssignmentRef, LoopMetrics, Verdict } from "@/lib/learning-loop/rows";
import { LEARNING_DRIVERS, emptyLearning } from "@/lib/learning-loop/rows";
import { CLASSIFICATION_CONFIG } from "@/lib/evolve/classifier";
import { fmtMoney, fmtNum, fmtPct, fmtX, VERDICT_CONFIG } from "./format";
import { MediaPreview } from "./media-preview";

export type LearningTarget =
  | { kind: "adset"; adsetId: string; adsetName: string; campaignId: string | null }
  | { kind: "creative"; adIds: string[] };

export interface LearningContext {
  name: string;
  hookLabel?: string | null;
  assignment: LoopAssignmentRef | null;
  window: LoopMetrics;
  lifetime: LoopMetrics;
  classification: keyof typeof CLASSIFICATION_CONFIG;
  recommendation: string;
  /** Own vs scaling split, when the row has copies elsewhere. */
  ownSpend?: number;
  scaledSpend?: number;
  copies?: number;
  editorId?: string | null;
  productLine?: string | null;
  format?: string | null;
  problem?: string | null;
  landing?: string | null;
  /** Where to fetch the creative(s) from: the ad set's ads, or these ads. */
  mediaAdsetId?: string | null;
  mediaAdIds?: string[];
  highlightAdIds?: string[];
}

/** First draft of "what happened", written from the numbers so the human starts from facts. */
function draftWhatHappened(c: LearningContext, currency: string, targetRoas: number): string {
  const w = c.window;
  const bits = [
    `${fmtMoney(w.spend, currency)} spend`,
    `ROAS ${fmtX(w.roas)} (mål ${targetRoas}x)`,
    `${fmtNum(w.purchases)} köp${w.cpa > 0 ? ` à ${fmtMoney(w.cpa, currency)}` : ""}`,
  ];
  if (w.hookRate > 0) bits.push(`hook rate ${fmtPct(w.hookRate, 0)}`);
  if (w.holdRate > 0) bits.push(`hold ${fmtPct(w.holdRate, 0)}`);
  if (c.copies && c.scaledSpend) bits.push(`varav ${fmtMoney(c.scaledSpend, currency)} i scaling-kopior`);
  return `${bits.join(" · ")}. ${CLASSIFICATION_CONFIG[c.classification].label}: ${c.recommendation}`;
}

const FIELDS: Array<{ key: keyof Omit<LearningNote, "drivers">; label: string; hint: string; rows: number }> = [
  { key: "whatHappened", label: "Vad hände?", hint: "Resultatet i ord. Förifylls från siffrorna — skriv om det du ser i annonsen.", rows: 3 },
  { key: "why", label: "Varför?", hint: "Varför funkade det / funkade det inte? Hooken, problemet, erbjudandet, LP:n, målgruppen?", rows: 4 },
  { key: "learning", label: "Lärdom", hint: "Den överförbara insikten — det som gäller nästa gång, inte bara den här annonsen.", rows: 3 },
  { key: "next", label: "Nästa test", hint: "Vad testar vi härnäst? Detta kan bli nästa brief med ett klick.", rows: 3 },
];

/**
 * The Growth Guide's Results + Learnings columns as a working surface:
 * hypothesis at the top, the numbers beside it, then what happened → why →
 * learning → next test, tagged with what drove it. "Nästa test" can become a
 * brief directly, which is the loop closing.
 */
export function LearningDialog({
  open,
  onOpenChange,
  target,
  context,
  currency,
  targetRoas,
  value,
  verdict,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  target: LearningTarget;
  context: LearningContext;
  currency: string;
  targetRoas: number;
  value: LearningNote | null;
  verdict: Verdict | null;
  onSaved: (note: LearningNote | null, verdict: Verdict | null) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState<LearningNote>(value ?? emptyLearning());
  const [v, setV] = useState<Verdict | null>(verdict);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = value ?? emptyLearning();
    setNote(base.whatHappened ? base : { ...base, whatHappened: draftWhatHappened(context, currency, targetRoas) });
    setV(verdict);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const body = target.kind === "adset"
    ? { adsetId: target.adsetId, adsetName: target.adsetName, campaignId: target.campaignId }
    : { adIds: target.adIds };
  const url = target.kind === "adset" ? "/api/learning-loop/adset" : "/api/learning-loop/ad";

  const save = async (): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, learning: note, verdict: v }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara");
      onSaved(note, v);
      toast.success("Lärdom sparad");
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** "Nästa test" → a new brief, prefilled as an iteration of this one. */
  const createIteration = async () => {
    if (!note.next.trim()) { toast.info("Skriv vad nästa test är först."); return; }
    setCreating(true);
    try {
      if (!(await save())) return;
      const draftRes = await fetch("/api/assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isDraft: true }) });
      if (!draftRes.ok) throw new Error("Kunde inte skapa brief");
      const draft = await draftRes.json();
      const a = context.assignment;
      const hypothesis = [
        `Iteration av ${a ? `#${a.batchNumber} ${a.autoName}` : context.name}.`,
        note.learning.trim() ? `Lärdom: ${note.learning.trim()}` : null,
        `Test: ${note.next.trim()}`,
      ].filter(Boolean).join("\n");
      const put = await fetch(`/api/assignments/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hypothesis,
          variableTested: note.next.trim().slice(0, 200),
          adType: "iteration",
          iterationOfId: a?.id ?? null,
          description: note.why.trim() ? `Varför förra funkade/inte: ${note.why.trim()}` : undefined,
          ...(context.editorId ? { assignedToId: context.editorId } : {}),
        }),
      });
      if (!put.ok) throw new Error("Kunde inte förifylla briefen");
      toast.success("Utkast skapat under Assignments → Draft");
      onOpenChange(false);
      router.push("/assignments");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte skapa brief");
    } finally {
      setCreating(false);
    }
  };

  const cls = CLASSIFICATION_CONFIG[context.classification];
  const a = context.assignment;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] sm:max-w-5xl bg-[#0d1117] border-white/10 p-0">
        <DialogHeader className="border-b border-white/5 px-6 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2 text-white">
            <FlaskConical className="h-4 w-4 text-cyan-400" />
            Lärdom · {context.hookLabel ? `${context.hookLabel} ` : ""}{context.name}
          </DialogTitle>
          <p className="text-xs text-slate-500">Hypotes → vad hände → varför → lärdom → nästa test. Detta är raden i Growth Guide-arket, men med siffrorna bredvid.</p>
        </DialogHeader>

        <div className="grid max-h-[75vh] gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          {/* ── Context ── */}
          <div className="space-y-4 border-b border-white/5 px-6 py-4 lg:border-b-0 lg:border-r">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Hypotes (från briefen)</div>
              {a ? (
                <div className="mt-1 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] p-3">
                  <div className="text-xs text-slate-300"><span className="font-mono text-cyan-400">#{a.batchNumber}</span> {a.autoName}</div>
                  {a.hypothesis ? <p className="mt-1 whitespace-pre-wrap text-xs text-slate-200">{a.hypothesis}</p> : <p className="mt-1 text-xs italic text-slate-600">Ingen hypotes skriven i briefen.</p>}
                  {a.variableTested && <p className="mt-1 text-[11px] text-slate-400"><span className="text-slate-500">Variabel:</span> {a.variableTested}</p>}
                </div>
              ) : (
                <p className="mt-1 text-xs italic text-slate-600">Ingen brief kopplad — koppla en så syns hypotesen här.</p>
              )}
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Siffror</div>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {[
                  { l: "Spend", v: fmtMoney(context.window.spend, currency), s: context.copies ? `eget ${fmtMoney(context.ownSpend ?? 0, currency)} · scaling ${fmtMoney(context.scaledSpend ?? 0, currency)}` : `lifetime ${fmtMoney(context.lifetime.spend, currency)}` },
                  { l: "ROAS", v: fmtX(context.window.roas), s: `lifetime ${fmtX(context.lifetime.roas)} · mål ${targetRoas}x`, accent: context.window.roas >= targetRoas ? "text-emerald-400" : context.window.roas > 0 ? "text-amber-300" : undefined },
                  { l: "Köp / CPA", v: `${fmtNum(context.window.purchases)} / ${context.window.cpa > 0 ? fmtMoney(context.window.cpa, currency) : "–"}`, s: `${fmtNum(context.window.impressions)} visningar` },
                  { l: "Hook / hold", v: `${fmtPct(context.window.hookRate, 0)} / ${fmtPct(context.window.holdRate, 0)}`, s: `CTR ${fmtPct(context.window.ctr, 2)}` },
                ].map((k) => (
                  <div key={k.l} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-500">{k.l}</div>
                    <div className={cn("text-sm font-semibold", k.accent ?? "text-slate-200")}>{k.v}</div>
                    <div className="text-[10px] text-slate-500">{k.s}</div>
                  </div>
                ))}
              </div>
              <div className={cn("mt-1.5 rounded-lg border px-3 py-2 text-xs", cls.bg, cls.border)}>
                <span className={cn("font-semibold", cls.color)}>{cls.label}</span>
                <span className="ml-2 text-slate-300">{context.recommendation}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-500">
              <div>Produkt: <span className="text-slate-300">{context.productLine ?? "—"}</span></div>
              <div>Format: <span className="text-slate-300">{context.format ?? "—"}</span></div>
              <div>Problem: <span className="text-slate-300">{context.problem ?? "—"}</span></div>
              <div>Landing: <span className="text-slate-300">{context.landing ?? "—"}</span></div>
            </div>
            {(context.mediaAdsetId || context.mediaAdIds?.length) && (
              <MediaPreview adsetId={context.mediaAdsetId} adIds={context.mediaAdIds} highlightAdIds={context.highlightAdIds} currency={currency} />
            )}
          </div>

          {/* ── The note ── */}
          <div className="space-y-4 px-6 py-4">
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Verdict</div>
              <div className="flex flex-wrap gap-1.5">
                {(["confirmed_winner", "loser", "iterate", "inconclusive"] as Verdict[]).map((k) => {
                  const c = VERDICT_CONFIG[k];
                  return (
                    <button key={k} type="button" onClick={() => setV(v === k ? null : k)} className={cn("rounded-md border px-3 py-1.5 text-xs font-medium transition-colors", v === k ? cn(c.bg, c.color, c.border) : "border-white/10 text-slate-400 hover:text-white")}>
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <div className="mb-1 flex items-baseline justify-between">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{f.label}</label>
                  {f.key === "whatHappened" && (
                    <button type="button" onClick={() => setNote({ ...note, whatHappened: draftWhatHappened(context, currency, targetRoas) })} className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-300">
                      <Sparkles className="h-3 w-3" /> fyll från siffrorna
                    </button>
                  )}
                </div>
                <textarea
                  value={note[f.key]}
                  onChange={(e) => setNote({ ...note, [f.key]: e.target.value })}
                  rows={f.rows}
                  placeholder={f.hint}
                  className="w-full resize-y rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
                />
              </div>
            ))}
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Vad drev resultatet?</div>
              <div className="flex flex-wrap gap-1.5">
                {LEARNING_DRIVERS.map((d) => {
                  const on = note.drivers.includes(d.key);
                  return (
                    <button key={d.key} type="button" onClick={() => setNote({ ...note, drivers: on ? note.drivers.filter((x) => x !== d.key) : [...note.drivers, d.key] })}
                      className={cn("rounded-md border px-2.5 py-1 text-xs transition-colors", on ? "border-violet-500/40 bg-violet-500/15 text-violet-200" : "border-white/10 text-slate-400 hover:text-white")}>
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-slate-600">Syns som &quot;Drivkraft&quot; under Vad funkar — hit rate per drivkraft över alla lärdomar.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-6 py-3">
          <button type="button" onClick={createIteration} disabled={creating || saving} className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />} Gör &quot;Nästa test&quot; till en brief
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-white/10">Avbryt</Button>
            <Button onClick={async () => { if (await save()) onOpenChange(false); }} disabled={saving} className="bg-cyan-600 hover:bg-cyan-500 text-white">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Spara lärdom
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Compact read view of a note, for the expanded row. */
export function LearningSummary({ note, learningsAt, onEdit }: { note: LearningNote | null; learningsAt: string | null; onEdit: () => void }) {
  const has = note && (note.whatHappened || note.why || note.learning || note.next || note.drivers.length);
  return (
    <div className="space-y-2">
      {has ? (
        <div className="space-y-1.5 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-xs">
          {note!.whatHappened && <p><span className="text-slate-500">Vad hände: </span><span className="text-slate-300">{note!.whatHappened}</span></p>}
          {note!.why && <p><span className="text-slate-500">Varför: </span><span className="text-slate-300">{note!.why}</span></p>}
          {note!.learning && <p><span className="text-slate-500">Lärdom: </span><span className="text-emerald-200">{note!.learning}</span></p>}
          {note!.next && <p><span className="text-slate-500">Nästa: </span><span className="text-violet-200">{note!.next}</span></p>}
          {note!.drivers.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {note!.drivers.map((d) => <span key={d} className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">{LEARNING_DRIVERS.find((x) => x.key === d)?.label ?? d}</span>)}
            </div>
          )}
          {learningsAt && <div className="text-[10px] text-slate-600">uppdaterad {new Date(learningsAt).toLocaleDateString("sv-SE")}</div>}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-500">Ingen lärdom skriven än.</div>
      )}
      <button type="button" onClick={onEdit} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20">
        <FlaskConical className="h-3.5 w-3.5" /> {has ? "Öppna lärdomen" : "Skriv lärdom"}
      </button>
    </div>
  );
}
