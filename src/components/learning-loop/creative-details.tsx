"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink, FlaskConical, Link2, Loader2, MapPin, ScrollText, Sparkles, Unlink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { CreativeRow } from "@/lib/learning-loop/rows";
import { CLASSIFICATION_CONFIG } from "@/lib/evolve/classifier";
import { fmtMoney, fmtNum, fmtPct, fmtX, fmtDate, AWARENESS_LEVELS, STATUS_LABEL, ROLE_CONFIG } from "./format";
import { VerdictSelect } from "./verdict-select";
import { LearningsEditor } from "./learnings-editor";
import { LinkPicker } from "./link-picker";

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cn("text-sm font-semibold", accent ?? "text-slate-200")}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

/** The creative's script: the brief's hook variant by default, or its own text. Saved on blur / ⌘+Enter. */
function ScriptEditor({ row, onSaved }: { row: CreativeRow; onSaved: (script: string | null) => void }) {
  const [text, setText] = useState(row.script ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => setText(row.script ?? ""), [row.script, row.key]);
  const dirty = (text.trim() || null) !== (row.script?.trim() || null);

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      // Empty + brief present = go back to the brief's script (own script cleared).
      const own = text.trim() && text.trim() !== (row.scriptFromAssignment ?? "").trim() ? text.trim() : null;
      const res = await fetch("/api/learning-loop/ad", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adIds: row.adIds, script: own }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara scriptet");
      onSaved(own ?? row.scriptFromAssignment ?? null);
      setSavedAt(Date.now());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara scriptet");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><ScrollText className="h-3.5 w-3.5" /> Script</h4>
        <span className="text-[10px] text-slate-600">
          {row.scriptSource === "assignment" ? `från briefen${row.hookLabel ? ` · ${row.hookLabel}` : ""}` : row.scriptSource === "own" ? "eget script" : "inget script än"}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } }}
        rows={6}
        placeholder={row.assignment ? "Briefen har inget script — skriv in creativens hook + body här." : "Hook + body för den här creativen. Koppla till en brief så hämtas scriptet därifrån."}
        className="w-full resize-y rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
      />
      <div className="flex h-4 items-center justify-end gap-2 text-[10px] text-slate-600">
        {saving ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> sparar…</span>
          : dirty ? <span>osparat — ⌘+Enter eller klicka utanför</span>
          : savedAt ? <span className="flex items-center gap-1 text-emerald-500/80"><Check className="h-3 w-3" /> sparat</span> : null}
      </div>
    </div>
  );
}

export function CreativeDetails({
  row,
  currency,
  accountNumber,
  targetRoas,
  periodLabel,
  onPatch,
  onRefresh,
}: {
  row: CreativeRow;
  currency: string;
  accountNumber: string | null;
  targetRoas: number;
  periodLabel: string;
  onPatch: (patch: Partial<CreativeRow>) => void;
  onRefresh: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const [originPicker, setOriginPicker] = useState(false);
  const [busy, setBusy] = useState<"unlink" | "suggest" | "origin" | null>(null);
  const cls = CLASSIFICATION_CONFIG[row.classification];
  const a = row.assignment;
  const ORIGIN_SOURCE_LABEL: Record<string, string> = {
    manual: "satt manuellt",
    testing: "ABO-setet den testades i",
    name: "matchat på namn",
    earliest: "äldsta ad setet",
    only: "enda ad setet",
  };

  const resetOrigin = async () => {
    setBusy("origin");
    try {
      const res = await fetch("/api/learning-loop/ad", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adIds: row.adIds, originAdsetId: null }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte återställa");
      toast.success("Ursprung återställt till automatiskt");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte återställa");
    } finally {
      setBusy(null);
    }
  };

  const link = async (assignmentId: string | null, kind: "unlink" | "suggest") => {
    setBusy(kind);
    try {
      const res = await fetch("/api/learning-loop/ad", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adIds: row.adIds, assignmentId }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara");
      toast.success(assignmentId ? "Creative kopplad till brief" : "Kopplingen borttagen");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-4 border-t border-white/5 bg-[#0b0f1c] px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1.1fr)]" onClick={(e) => e.stopPropagation()}>
      {/* ── Brief + script ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><FlaskConical className="h-3.5 w-3.5" /> Brief / hypotes</h4>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPicker(true)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5">
              <Link2 className="h-3 w-3" /> {a ? "Byt brief" : "Koppla brief"}
            </button>
            {a && row.linkSource === "ad" && (
              <button type="button" onClick={() => link(null, "unlink")} disabled={busy === "unlink"} title="Koppla loss" className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-500 hover:text-red-400 hover:bg-white/5">
                {busy === "unlink" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
              </button>
            )}
          </div>
        </div>
        {a ? (
          <div className="space-y-2 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] p-3">
            <div className="text-sm text-slate-200"><span className="font-mono text-cyan-400">#{a.batchNumber}</span> {a.autoName}</div>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400">{STATUS_LABEL[a.status] ?? a.status}</span>
              {a.adType && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{a.adType === "iteration" ? "Iteration" : "Ideation"}</span>}
              {a.awarenessLevel && <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400">{AWARENESS_LEVELS.find((l) => l.value === a.awarenessLevel)?.label ?? a.awarenessLevel}</span>}
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-600">{row.linkSource === "adset" ? "ärvd från ad setet" : "kopplad på creativen"}</span>
            </div>
            {a.hypothesis ? <p className="whitespace-pre-wrap text-xs text-slate-300">{a.hypothesis}</p> : <p className="text-xs italic text-slate-600">Ingen hypotes skriven i briefen.</p>}
            {a.variableTested && <p className="text-xs text-slate-400"><span className="text-slate-500">Variabel:</span> {a.variableTested}</p>}
            <Link href="/assignments" className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline">Öppna assignments <ExternalLink className="h-3 w-3" /></Link>
          </div>
        ) : row.suggestion ? (
          <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80"><Sparkles className="h-3 w-3" /> Förslag från namnet</div>
            <div className="text-sm text-slate-200"><span className="font-mono text-cyan-400">#{row.suggestion.assignmentBatch}</span> {row.suggestion.assignmentName}</div>
            <div className="text-[11px] text-slate-500">
              <span className={cn("mr-2 font-medium", row.suggestion.confidence === "high" ? "text-emerald-400" : "text-amber-400")}>{row.suggestion.score}p {row.suggestion.confidence === "high" ? "säker" : "osäker"}</span>
              {row.suggestion.reasons.join(" · ")}
            </div>
            <button type="button" onClick={() => link(row.suggestion!.assignmentId, "suggest")} disabled={busy === "suggest"} className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20">
              {busy === "suggest" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Koppla
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-500">Inget brief kopplat. Koppla den så att hypotes, script och resultat hamnar på samma rad.</div>
        )}
        {/* ── Origin: where the creative was TESTED — its learning lives there ── */}
        <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><MapPin className="h-3 w-3" /> Ursprungs-ad set</div>
              {row.originAdsetId ? (
                <div className="truncate text-xs text-slate-200" title={row.originAdsetName ?? row.originAdsetId}>{row.originAdsetName ?? row.originAdsetId}</div>
              ) : (
                <div className="text-xs italic text-slate-500">Bara i behållare — inget testset hittat</div>
              )}
              <div className="text-[10px] text-slate-600">
                {row.originSource ? ORIGIN_SOURCE_LABEL[row.originSource] ?? row.originSource : "välj det ABO-set den testades i"}
                {row.ads.some((x) => x.isContainer) && " · ligger i scaling-behållare"}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => setOriginPicker(true)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5">
                <MapPin className="h-3 w-3" /> {row.originSource === "manual" ? "Byt" : "Välj"}
              </button>
              {row.originSource === "manual" && (
                <button type="button" onClick={resetOrigin} disabled={busy === "origin"} title="Tillbaka till automatisk" className="rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-500 hover:bg-white/5">
                  {busy === "origin" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Auto"}
                </button>
              )}
            </div>
          </div>
        </div>
        <ScriptEditor row={row} onSaved={(script) => onPatch({ script, scriptSource: script ? (script === row.scriptFromAssignment ? "assignment" : "own") : null })} />
        <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-500">
          <div>Editor: <span className="text-slate-300">{row.editorName ?? "—"}</span></div>
          <div>Strateg: <span className="text-slate-300">{row.strategistName ?? "—"}</span></div>
          <div>Format: <span className="text-slate-300">{row.format ?? "—"}</span></div>
          <div>Landing: <span className="text-slate-300">{row.landing ?? "—"}</span></div>
          <div>Problem: <span className="text-slate-300">{row.problem ?? "—"}</span></div>
          <div>Hook: <span className="text-slate-300">{row.hookLabel ?? "—"}</span></div>
        </div>
      </div>

      {/* ── Numbers + where it runs ── */}
      <div className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Resultat · {periodLabel} · summa över {row.ads.length} annons{row.ads.length === 1 ? "" : "er"}</h4>
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="Spend" value={fmtMoney(row.window.spend, currency)} sub={`lifetime ${fmtMoney(row.lifetime.spend, currency)}`} />
          <Stat label="ROAS" value={fmtX(row.window.roas)} sub={`lifetime ${fmtX(row.lifetime.roas)}`} accent={row.window.roas >= targetRoas ? "text-emerald-400" : row.window.roas > 0 ? "text-amber-300" : undefined} />
          <Stat label="CPA" value={row.window.cpa > 0 ? fmtMoney(row.window.cpa, currency) : "–"} sub={`${fmtNum(row.window.purchases)} köp`} />
          <Stat label="Hook rate" value={fmtPct(row.window.hookRate)} sub="3s / impressions" />
          <Stat label="Hold rate" value={fmtPct(row.window.holdRate)} sub="thruplay / 3s" />
          <Stat label="CTR" value={fmtPct(row.window.ctr, 2)} sub={`CPM ${fmtMoney(row.window.cpm, currency)}`} />
          <Stat label="Dagar live" value={String(row.ageDays)} sub={row.lifetime.firstDate ? `${fmtDate(row.lifetime.firstDate)} → ${fmtDate(row.lifetime.lastDate)}` : "ingen spend ännu"} />
          <Stat label="Ad sets" value={String(row.adsetIds.length)} sub={row.roleLabel} />
          <Stat label="Video-id" value={row.videoIds.length ? `${row.videoIds.length}` : "–"} sub={row.videoIds.length > 1 ? "flera uppladdningar" : "samma fil"} />
        </div>
        <div className={cn("rounded-lg border px-3 py-2 text-xs", cls.bg, cls.border)}>
          <span className={cn("font-semibold", cls.color)}>{cls.label}</span>
          <span className="ml-2 text-slate-300">{row.recommendation}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-white/5">
          <table className="w-full text-[11px]">
            <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Ad set</th>
                <th className="px-2 py-1.5 text-right font-medium">Spend</th>
                <th className="px-2 py-1.5 text-right font-medium">Köp</th>
                <th className="px-2 py-1.5 text-right font-medium">ROAS</th>
                <th className="px-2 py-1.5 text-right font-medium">Hook</th>
              </tr>
            </thead>
            <tbody>
              {row.ads.map((ad) => {
                const role = ROLE_CONFIG[ad.role];
                return (
                  <tr key={ad.adId} className="border-t border-white/[0.04]">
                    <td className="max-w-[280px] px-2 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", ad.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-600")} />
                        <span className={cn("shrink-0 rounded px-1 py-px text-[9px]", role.bg, role.color)}>{ad.roleLabel}</span>
                        {ad.isOrigin && <span className="shrink-0 rounded bg-cyan-500/10 px-1 py-px text-[9px] text-cyan-300" title="Ursprung — här testades creativen">ursprung</span>}
                        {ad.isContainer && <span className="shrink-0 rounded bg-white/5 px-1 py-px text-[9px] text-slate-500" title="Scaling-behållare med creatives från flera briefs">behållare</span>}
                        <span className="truncate text-slate-300" title={`${ad.name} · ${ad.adsetName}`}>{ad.adsetName}</span>
                      </div>
                      {ad.name !== row.name && <div className="truncate pl-3 text-[10px] text-slate-600" title={ad.name}>{ad.name}</div>}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-300">{fmtMoney(ad.window.spend, currency)}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{fmtNum(ad.window.purchases)}</td>
                    <td className={cn("px-2 py-1 text-right", ad.window.roas >= targetRoas ? "text-emerald-400" : ad.window.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(ad.window.roas)}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{ad.window.hookRate > 0 ? fmtPct(ad.window.hookRate, 0) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {accountNumber && (
          <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountNumber}&selected_ad_ids=${row.adIds.join(",")}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-400">
            Öppna i Ads Manager <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* ── Verdict + learning ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Verdict &amp; lärdom</h4>
          <VerdictSelect adIds={row.adIds} value={row.verdict} size="md" onChange={(v) => onPatch({ verdict: v as CreativeRow["verdict"], verdictAt: v ? new Date().toISOString() : null })} />
        </div>
        <LearningsEditor adIds={row.adIds} value={row.learnings} rows={9} onSaved={(v) => onPatch({ learnings: v, learningsAt: v ? new Date().toISOString() : null })} />
        {row.learningsAt && <div className="text-[10px] text-slate-600">Senast uppdaterad {fmtDate(row.learningsAt)}</div>}
      </div>

      {picker && (
        <LinkPicker mode="creative" adIds={row.adIds} creativeName={row.name} open={picker} onOpenChange={setPicker} onLinked={() => { setPicker(false); onRefresh(); }} />
      )}
      {originPicker && (
        <LinkPicker mode="origin" adIds={row.adIds} creativeName={row.name} open={originPicker} onOpenChange={setOriginPicker} onLinked={() => { setOriginPicker(false); onRefresh(); }} />
      )}
    </div>
  );
}
