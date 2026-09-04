"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { VERDICT_CONFIG } from "./format";

const ORDER = ["confirmed_winner", "loser", "iterate", "inconclusive"] as const;

/**
 * The human verdict on an ad set. Auto-classification says what the numbers
 * look like; this is what the TEAM decided — it overrides the classification
 * in hit-rate maths and it is what gets reported back to the brief.
 */
export function VerdictSelect({
  adsetId,
  adsetName,
  campaignId,
  adIds,
  value,
  onChange,
  size = "sm",
}: {
  /** Ad set target … */
  adsetId?: string;
  adsetName?: string | null;
  campaignId?: string | null;
  /** … or creative target: every ad that is this creative. */
  adIds?: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const cfg = value ? VERDICT_CONFIG[value] : null;

  const save = async (v: string | null) => {
    setSaving(true);
    try {
      const res = await fetch(adIds ? "/api/learning-loop/ad" : "/api/learning-loop/adset", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adIds ? { adIds, verdict: v } : { adsetId, adsetName, campaignId, verdict: v }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara");
      onChange(v);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border font-medium transition-colors",
          size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-3 py-1.5 text-xs",
          cfg ? cn(cfg.bg, cfg.color, cfg.border) : "border-dashed border-white/15 text-slate-500 hover:text-slate-300 hover:border-white/30",
        )}
      >
        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {cfg ? cfg.label : "Verdict"}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 w-40 rounded-lg border border-white/10 bg-[#111827] p-1 shadow-xl">
            {ORDER.map((v) => {
              const c = VERDICT_CONFIG[v];
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => save(v)}
                  className={cn("flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-white/5", c.color)}
                >
                  {c.label}
                  {value === v && <Check className="h-3 w-3" />}
                </button>
              );
            })}
            {value && (
              <button type="button" onClick={() => save(null)} className="mt-1 w-full rounded-md border-t border-white/5 px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-white/5">
                Rensa
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
