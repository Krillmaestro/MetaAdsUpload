"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Free-text learning for an ad set — saved on blur or ⌘/Ctrl+Enter, so the
 * table never needs a "save" button per row. This text is the point of the
 * whole loop: it is what the next brief is written from.
 */
export function LearningsEditor({
  adsetId,
  adsetName,
  campaignId,
  adIds,
  value,
  onSaved,
  placeholder = "Vad lärde vi oss? Varför funkade / funkade det inte? Vad testar vi härnäst?",
  rows = 3,
  className,
}: {
  adsetId?: string;
  adsetName?: string | null;
  campaignId?: string | null;
  /** Creative target: every ad that is this creative. */
  adIds?: string[];
  value: string | null;
  onSaved: (v: string | null) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const [text, setText] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => setText(value ?? ""), [value]);

  const dirty = (text.trim() || null) !== (value?.trim() || null);

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const res = await fetch(adIds ? "/api/learning-loop/ad" : "/api/learning-loop/adset", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adIds ? { adIds, learnings: text } : { adsetId, adsetName, campaignId, learnings: text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara");
      onSaved(text.trim() || null);
      setSavedAt(Date.now());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara lärdomen");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn("space-y-1", className)} onClick={(e) => e.stopPropagation()}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } }}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 outline-none transition-colors focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30"
      />
      <div className="flex h-4 items-center justify-end gap-2 text-[10px] text-slate-600">
        {saving ? (
          <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> sparar…</span>
        ) : dirty ? (
          <span>osparat — spara med ⌘+Enter eller klicka utanför</span>
        ) : savedAt ? (
          <span className="flex items-center gap-1 text-emerald-500/80"><Check className="h-3 w-3" /> sparat</span>
        ) : null}
      </div>
    </div>
  );
}
