"use client";

import { useState } from "react";
import { ChevronDown, Link2, Loader2, Search, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { PipelineAssignment } from "@/lib/learning-loop/rows";
import { LinkPicker } from "./link-picker";
import { STATUS_LABEL, fmtDate } from "./format";

/**
 * Briefs that have no ad set yet: still in production, or posted through a
 * script and waiting to be linked. Suggestions come from the name matcher;
 * "Koppla säkra" applies every high-confidence one in a single click.
 */
export function Pipeline({ pipeline, onChanged }: { pipeline: PipelineAssignment[]; onChanged: () => void }) {
  const [open, setOpen] = useState(pipeline.some((p) => p.status === "posted"));
  const [autoLinking, setAutoLinking] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [picker, setPicker] = useState<PipelineAssignment | null>(null);

  const safeCount = pipeline.reduce((n, p) => n + p.suggestions.filter((s) => s.confidence === "high" && !s.currentAssignmentId).length, 0);

  const autoLink = async () => {
    setAutoLinking(true);
    try {
      const res = await fetch("/api/learning-loop/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auto: true }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Kunde inte koppla");
      toast.success(`${d.applied} ad set kopplade automatiskt`);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte koppla");
    } finally {
      setAutoLinking(false);
    }
  };

  const linkOne = async (assignmentId: string, adsetId: string) => {
    setLinking(adsetId);
    try {
      const res = await fetch("/api/learning-loop/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs: [{ assignmentId, adsetId }] }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte koppla");
      toast.success("Kopplat");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte koppla");
    } finally {
      setLinking(null);
    }
  };

  return (
    <div className="rounded-xl border border-white/5 bg-[#111827]">
      <div className="flex items-center justify-between px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-3 text-left">
          <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform", open && "rotate-180")} />
          <span className="text-sm font-semibold text-white">Pipeline</span>
          <span className="text-xs text-slate-500">{pipeline.length} briefs utan ad set</span>
          {pipeline.some((p) => p.status === "posted") && (
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
              {pipeline.filter((p) => p.status === "posted").length} postade men okopplade
            </span>
          )}
        </button>
        {safeCount > 0 && (
          <button
            type="button"
            onClick={autoLink}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            {autoLinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Koppla {safeCount} säkra
          </button>
        )}
      </div>

      {open && (
        <div className="divide-y divide-white/[0.04] border-t border-white/5">
          {pipeline.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-600">Alla briefs är kopplade till ad sets.</p>}
          {pipeline.map((p) => (
            <div key={p.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-slate-200">
                    <span className="font-mono text-cyan-400">#{p.batchNumber}</span> {p.autoName}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    <span className={cn("mr-2 rounded px-1.5 py-0.5", p.status === "posted" ? "bg-amber-500/10 text-amber-300" : "bg-white/5 text-slate-400")}>{STATUS_LABEL[p.status] ?? p.status}</span>
                    {p.editorName ?? "—"} · {p.productName ?? "—"} · {p.formatName ?? "—"} · {p.landingPage ?? "—"} · skapad {fmtDate(p.createdAt)}
                    {p.hypothesis && <span className="ml-2 italic text-slate-500">”{p.hypothesis.slice(0, 80)}{p.hypothesis.length > 80 ? "…" : ""}”</span>}
                  </div>
                </div>
                <button type="button" onClick={() => setPicker(p)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5">
                  <Search className="h-3.5 w-3.5" /> Sök ad set
                </button>
              </div>
              {p.suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {p.suggestions.map((s) => (
                    <button
                      key={s.adsetId}
                      type="button"
                      disabled={linking === s.adsetId}
                      onClick={() => linkOne(p.id, s.adsetId)}
                      title={s.reasons.join(" · ")}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] hover:bg-white/5",
                        s.confidence === "high" ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300",
                      )}
                    >
                      {linking === s.adsetId ? <Loader2 className="h-3 w-3 animate-spin" /> : s.confidence === "high" ? <Sparkles className="h-3 w-3" /> : <Link2 className="h-3 w-3" />}
                      <span className="truncate">{s.adsetName}</span>
                      <span className="opacity-60">{s.score}p</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {picker && (
        <LinkPicker
          mode="assignment"
          assignmentId={picker.id}
          assignmentName={`#${picker.batchNumber} ${picker.autoName}`}
          open={!!picker}
          onOpenChange={(o) => { if (!o) setPicker(null); }}
          onLinked={() => { setPicker(null); onChanged(); }}
        />
      )}
    </div>
  );
}
