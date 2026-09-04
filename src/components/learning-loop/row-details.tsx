"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, FlaskConical, Link2, Unlink, Loader2, Layers, MapPin } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { LearningLoopRow } from "@/lib/learning-loop/rows";
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

/**
 * Expanded ad set row: the brief it runs (hypothesis in), the numbers, the
 * verdict + learning (learning out), and the ads inside it.
 */
export function RowDetails({
  row,
  currency,
  accountNumber,
  targetRoas,
  periodLabel,
  onPatch,
  onRefresh,
}: {
  row: LearningLoopRow;
  currency: string;
  accountNumber: string | null;
  targetRoas: number;
  periodLabel: string;
  onPatch: (patch: Partial<LearningLoopRow>) => void;
  /** Re-fetch after a link change (the brief reference comes from the server). */
  onRefresh: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const cls = CLASSIFICATION_CONFIG[row.classification];
  const a = row.assignment;

  const unlink = async () => {
    setUnlinking(true);
    try {
      const res = await fetch("/api/learning-loop/adset", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adsetId: row.adsetId, assignmentId: null }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte koppla loss");
      onPatch({ assignment: null, linkSource: null });
      toast.success("Kopplingen borttagen");
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte koppla loss");
    } finally {
      setUnlinking(false);
    }
  };

  const metaUrl = accountNumber
    ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountNumber}&selected_adset_ids=${row.adsetId}`
    : null;

  return (
    <div className="grid gap-4 border-t border-white/5 bg-[#0b0f1c] px-4 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)]" onClick={(e) => e.stopPropagation()}>
      {/* ── Brief (hypothesis in) ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><FlaskConical className="h-3.5 w-3.5" /> Brief / hypotes</h4>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPicker(true)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/5">
              <Link2 className="h-3 w-3" /> {a ? "Byt brief" : "Koppla brief"}
            </button>
            {a && (
              <button type="button" onClick={unlink} disabled={unlinking} title="Koppla loss" className="inline-flex items-center rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-500 hover:text-red-400 hover:bg-white/5">
                {unlinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
              </button>
            )}
          </div>
        </div>
        {a ? (
          <div className="space-y-2 rounded-lg border border-cyan-500/15 bg-cyan-500/[0.04] p-3">
            <div className="text-sm text-slate-200">
              <span className="font-mono text-cyan-400">#{a.batchNumber}</span> {a.autoName}
            </div>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400">{STATUS_LABEL[a.status] ?? a.status}</span>
              {a.adType && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{a.adType === "iteration" ? "Iteration" : "Ideation"}</span>}
              {a.awarenessLevel && <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-400">{AWARENESS_LEVELS.find((l) => l.value === a.awarenessLevel)?.label ?? a.awarenessLevel}</span>}
              {row.linkSource && <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-600">koppling: {row.linkSource}</span>}
            </div>
            {a.hypothesis ? (
              <p className="whitespace-pre-wrap text-xs text-slate-300">{a.hypothesis}</p>
            ) : (
              <p className="text-xs italic text-slate-600">Ingen hypotes skriven i briefen.</p>
            )}
            {a.variableTested && (
              <p className="text-xs text-slate-400"><span className="text-slate-500">Variabel:</span> {a.variableTested}</p>
            )}
            <Link href="/assignments" className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline">Öppna assignments <ExternalLink className="h-3 w-3" /></Link>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-slate-500">
            Inget brief kopplat. Koppla den så att hypotesen och resultatet hamnar på samma rad.
          </div>
        )}
        <div className="grid grid-cols-2 gap-1 text-[11px] text-slate-500">
          <div>Editor: <span className="text-slate-300">{row.editorName ?? "—"}</span></div>
          <div>Strateg: <span className="text-slate-300">{row.strategistName ?? "—"}</span></div>
          <div>Format: <span className="text-slate-300">{row.format ?? "—"}</span></div>
          <div>Landing: <span className="text-slate-300">{row.landing ?? "—"}</span></div>
          <div>Problem: <span className="text-slate-300">{row.problem ?? "—"}</span></div>
          <div>Angle: <span className="text-slate-300">{row.angle ?? "—"}</span></div>
          <div>Kampanj: <span className="text-slate-300">{row.campaignName ?? "—"}</span></div>
          <div>Status: <span className="text-slate-300">{row.status ?? "—"}</span></div>
        </div>
        {metaUrl && (
          <a href={metaUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-400">
            Öppna i Ads Manager <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* ── Numbers ── */}
      <div className="space-y-2">
        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Resultat · {periodLabel}</h4>
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="Spend" value={fmtMoney(row.window.spend, currency)} sub={`lifetime ${fmtMoney(row.lifetime.spend, currency)}`} />
          <Stat label="ROAS" value={fmtX(row.window.roas)} sub={`lifetime ${fmtX(row.lifetime.roas)}`} accent={row.window.roas >= targetRoas ? "text-emerald-400" : row.window.roas > 0 ? "text-amber-300" : undefined} />
          <Stat label="CPA" value={row.window.cpa > 0 ? fmtMoney(row.window.cpa, currency) : "–"} sub={`${fmtNum(row.window.purchases)} köp`} />
          <Stat label="Hook rate" value={fmtPct(row.window.hookRate)} sub="3s / impressions" />
          <Stat label="Hold rate" value={fmtPct(row.window.holdRate)} sub="thruplay / 3s" />
          <Stat label="CTR" value={fmtPct(row.window.ctr, 2)} sub={`CPM ${fmtMoney(row.window.cpm, currency)}`} />
          <Stat label="Dagar live" value={String(row.ageDays)} sub={row.lifetime.firstDate ? `${fmtDate(row.lifetime.firstDate)} → ${fmtDate(row.lifetime.lastDate)}` : "ingen spend ännu"} />
          <Stat label="Aktiva dagar" value={String(row.window.activeDays)} sub="i perioden" />
          <Stat label="ncROAS" value={row.ncRoas ? fmtX(row.ncRoas) : "–"} sub="nya kunder (Shopify)" />
        </div>
        <div className={cn("rounded-lg border px-3 py-2 text-xs", row.isContainer ? "border-white/10 bg-white/[0.03]" : cn(cls.bg, cls.border))}>
          {row.isContainer ? (
            <span className="font-semibold text-slate-300"><Layers className="mr-1 inline h-3.5 w-3.5" />Behållare</span>
          ) : (
            <span className={cn("font-semibold", cls.color)}>{cls.label}</span>
          )}
          <span className="ml-2 text-slate-300">{row.recommendation}</span>
          {row.isTopSpender && !row.isContainer && <span className="ml-2 text-slate-500">· top spender i kampanjen ({fmtPct(row.spendShare * 100, 0)})</span>}
        </div>

        {/* ── Scaling copies credited to this (origin) ad set ── */}
        {row.scaled.copies.length > 0 && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300/90"><Layers className="h-3.5 w-3.5" /> Scaling-kopior · {row.scaled.copies.length} annons{row.scaled.copies.length === 1 ? "" : "er"} i andra ad sets</h4>
              <span className="text-[10px] text-slate-500">bokförs på det här ad setet</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Scaling-spend" value={fmtMoney(row.scaled.window.spend, currency)} sub={`lifetime ${fmtMoney(row.scaled.lifetime.spend, currency)}`} />
              <Stat label="Scaling-ROAS" value={fmtX(row.scaled.window.roas)} sub={`lifetime ${fmtX(row.scaled.lifetime.roas)}`} accent={row.scaled.window.roas >= targetRoas ? "text-emerald-400" : row.scaled.window.roas > 0 ? "text-amber-300" : undefined} />
              <Stat label="Totalt inkl. scaling" value={fmtMoney(row.total.window.spend, currency)} sub={`ROAS ${fmtX(row.total.window.roas)} · lifetime ${fmtMoney(row.total.lifetime.spend, currency)} @ ${fmtX(row.total.lifetime.roas)}`} accent={row.total.window.roas >= targetRoas ? "text-emerald-400" : undefined} />
            </div>
            <table className="w-full text-[11px]">
              <tbody>
                {row.scaled.copies.slice(0, 10).map((c) => {
                  const role = ROLE_CONFIG[c.role];
                  return (
                    <tr key={c.adId} className="border-t border-white/[0.04]">
                      <td className="max-w-[300px] px-1 py-1">
                        <div className="flex items-center gap-1.5">
                          <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", c.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-600")} />
                          <span className={cn("shrink-0 rounded px-1 py-px text-[9px]", role.bg, role.color)}>{c.roleLabel}</span>
                          <span className="truncate text-slate-300" title={`${c.name} · ${c.adsetName}`}>{c.adsetName}</span>
                        </div>
                        <div className="truncate pl-3 text-[10px] text-slate-600" title={c.name}>{c.name}</div>
                      </td>
                      <td className="px-1 py-1 text-right text-slate-300">{fmtMoney(c.window.spend, currency)}</td>
                      <td className="px-1 py-1 text-right text-slate-400">{fmtNum(c.window.purchases)}</td>
                      <td className={cn("px-1 py-1 text-right", c.window.roas >= targetRoas ? "text-emerald-400" : c.window.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(c.window.roas)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {row.scaled.copies.length > 10 && <div className="text-[10px] text-slate-600">+{row.scaled.copies.length - 10} kopior till</div>}
          </div>
        )}

        {/* ── Container: what is inside and where each creative belongs ── */}
        {row.isContainer && row.containerCreatives.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <h4 className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400"><MapPin className="h-3.5 w-3.5" /> {row.containerCreatives.length} creatives i behållaren · ursprung per creative</h4>
            <table className="w-full text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-1 py-1 text-left font-medium">Creative</th>
                  <th className="px-1 py-1 text-left font-medium">Ursprung (bokförs där)</th>
                  <th className="px-1 py-1 text-right font-medium">Spend</th>
                  <th className="px-1 py-1 text-right font-medium">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {row.containerCreatives.map((c) => (
                  <tr key={c.key} className="border-t border-white/[0.04]">
                    <td className="max-w-[260px] truncate px-1 py-1 text-slate-300" title={c.name}>
                      {c.hookLabel && <span className="mr-1 rounded bg-white/5 px-1 font-mono text-[10px] text-slate-400">{c.hookLabel}</span>}
                      {c.name}
                    </td>
                    <td className="max-w-[260px] truncate px-1 py-1" title={c.originAdsetName ?? ""}>
                      {c.originAdsetName ? (
                        <span className={cn(c.originSource === "manual" ? "text-cyan-300" : "text-slate-300")}>↳ {c.originAdsetName}</span>
                      ) : (
                        <span className="text-amber-500/80">saknas — välj i Creatives-vyn</span>
                      )}
                    </td>
                    <td className="px-1 py-1 text-right text-slate-300">{fmtMoney(c.window.spend, currency)}</td>
                    <td className={cn("px-1 py-1 text-right", c.window.roas >= targetRoas ? "text-emerald-400" : c.window.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(c.window.roas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {row.ads.length > 0 && !row.isContainer && (
          <div className="overflow-hidden rounded-lg border border-white/5">
            <table className="w-full text-[11px]">
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Annons</th>
                  <th className="px-2 py-1.5 text-right font-medium">Spend</th>
                  <th className="px-2 py-1.5 text-right font-medium">Köp</th>
                  <th className="px-2 py-1.5 text-right font-medium">ROAS</th>
                  <th className="px-2 py-1.5 text-right font-medium">CPA</th>
                  <th className="px-2 py-1.5 text-right font-medium">Hook</th>
                </tr>
              </thead>
              <tbody>
                {row.ads.slice(0, 12).map((ad) => (
                  <tr key={ad.id} className="border-t border-white/[0.04]">
                    <td className="max-w-[240px] truncate px-2 py-1 text-slate-300" title={ad.name}>
                      <span className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", ad.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-600")} />
                      {ad.name}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-300">{fmtMoney(ad.spend, currency)}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{fmtNum(ad.purchases)}</td>
                    <td className={cn("px-2 py-1 text-right", ad.roas >= targetRoas ? "text-emerald-400" : ad.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(ad.roas)}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{ad.cpa > 0 ? fmtMoney(ad.cpa, currency) : "–"}</td>
                    <td className="px-2 py-1 text-right text-slate-400">{ad.hookRate > 0 ? fmtPct(ad.hookRate, 0) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {row.ads.length > 12 && <div className="px-2 py-1 text-[10px] text-slate-600">+{row.ads.length - 12} annonser till</div>}
          </div>
        )}
      </div>

      {/* ── Verdict + learning (learning out) ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Verdict &amp; lärdom</h4>
          <VerdictSelect adsetId={row.adsetId} adsetName={row.name} campaignId={row.campaignId} value={row.verdict} size="md" onChange={(v) => onPatch({ verdict: v as LearningLoopRow["verdict"], verdictAt: v ? new Date().toISOString() : null })} />
        </div>
        <LearningsEditor adsetId={row.adsetId} adsetName={row.name} campaignId={row.campaignId} value={row.learnings} rows={7} onSaved={(v) => onPatch({ learnings: v, learningsAt: v ? new Date().toISOString() : null })} />
        {row.learningsAt && <div className="text-[10px] text-slate-600">Senast uppdaterad {fmtDate(row.learningsAt)}</div>}
        {row.graveyardOutcome && <div className="text-[11px] text-slate-500">Graveyard-utfall: <span className="text-slate-300">{row.graveyardOutcome}</span></div>}
      </div>

      {picker && (
        <LinkPicker
          mode="adset"
          adsetId={row.adsetId}
          adsetName={row.name}
          open={picker}
          onOpenChange={setPicker}
          onLinked={() => { setPicker(false); onRefresh(); }}
        />
      )}
    </div>
  );
}
