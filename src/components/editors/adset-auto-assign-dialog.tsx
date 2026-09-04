"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Wand2, AlertTriangle, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Review before write. The parser is good but not authoritative — a wrong
 * editor assignment silently pays the wrong person, so nothing is applied
 * until a human has seen it, and conflicts need a second, explicit opt-in.
 */

type Change = { from: string | null; to: string | null };

type Proposal = {
  adsetId: string;
  adsetName: string;
  kind: "fill" | "conflict";
  changes: Record<string, Change>;
  editorFrom: string | null;
  editorTo: string | null;
};

type Preview = {
  total: number;
  counts: { fill: number; conflict: number; unchanged: number; unparsed: number };
  proposals: Proposal[];
};

const FIELD_LABEL: Record<string, string> = {
  videoEditorId: "Editor",
  format: "Videotyp",
  landing: "Landingpage",
  problem: "Problem",
  country: "Land",
  batch: "Batch",
};

export function AdsetAutoAssignDialog({
  open,
  onClose,
  account,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  account: string;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeConflicts, setIncludeConflicts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (account) params.set("account", account);
      const res = await fetch(`/api/adsets/auto-assign?${params}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Kunde inte läsa förslag");
      setPreview(j as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Okänt fel");
    } finally {
      setLoading(false);
    }
  }, [account]);

  useEffect(() => {
    if (open) {
      setIncludeConflicts(false);
      load();
    }
  }, [open, load]);

  async function apply() {
    setApplying(true);
    try {
      const res = await fetch("/api/adsets/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: account || undefined, includeConflicts }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error ?? "Kunde inte spara");
      toast.success(`${j.applied} ad sets kopplade`);
      onApplied();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setApplying(false);
    }
  }

  const fills = preview?.proposals.filter((p) => p.kind === "fill") ?? [];
  const conflicts = preview?.proposals.filter((p) => p.kind === "conflict") ?? [];
  const willApply = fills.length + (includeConflicts ? conflicts.length : 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[96vw] sm:max-w-3xl border-white/10 bg-[#111827] text-slate-200">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Wand2 className="h-4 w-4 text-cyan-400" />
            Koppla ad sets automatiskt
          </DialogTitle>
        </DialogHeader>

        <p className="text-[11px] leading-relaxed text-slate-400">
          Läser editor, videotyp, problem och landingpage ur ad set-namnet. Fält som en människa har satt rörs
          aldrig — de dyker upp som konflikter nedan. Kan namnet inte tolkas lämnas fältet tomt i stället för att
          gissa.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Läser ad sets…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-300">{error}</div>
        )}

        {preview && !loading && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Fylls i", value: preview.counts.fill, tone: "text-cyan-300" },
                { label: "Konflikter", value: preview.counts.conflict, tone: "text-amber-400" },
                { label: "Oförändrat", value: preview.counts.unchanged, tone: "text-slate-400" },
                { label: "Otolkbara", value: preview.counts.unparsed, tone: "text-slate-500" },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{s.label}</div>
                  <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", s.tone)}>{s.value}</div>
                </div>
              ))}
            </div>

            {conflicts.length > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  Namnet säger emot en manuell tilldelning
                </div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {conflicts.map((p) => (
                    <li key={p.adsetId} className="text-[11px] leading-relaxed">
                      <span className="font-mono text-slate-300">{p.adsetName}</span>
                      <br />
                      <span className="text-slate-500">
                        tilldelad <strong className="text-slate-300">{p.editorFrom ?? "—"}</strong>, namnet säger{" "}
                        <strong className="text-amber-300">{p.editorTo ?? "—"}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeConflicts}
                    onChange={(e) => setIncludeConflicts(e.target.checked)}
                    className="h-3.5 w-3.5 accent-amber-500"
                  />
                  Låt namnet vinna även här
                </label>
              </div>
            )}

            {fills.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-white/5">
                <table className="w-full border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-[#111827]">
                    <tr className="text-left text-[10px] uppercase tracking-widest text-slate-500">
                      <th className="px-2 py-1.5 font-semibold">Ad set</th>
                      <th className="px-2 py-1.5 font-semibold">Fylls i</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.slice(0, 120).map((p) => (
                      <tr key={p.adsetId} className="border-t border-white/5">
                        <td className="max-w-[380px] truncate px-2 py-1.5 font-mono text-slate-300" title={p.adsetName}>
                          {p.adsetName}
                        </td>
                        <td className="px-2 py-1.5 text-slate-400">
                          {Object.entries(p.changes)
                            .map(([f, c]) => `${FIELD_LABEL[f] ?? f}: ${f === "videoEditorId" ? p.editorTo : c.to}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {fills.length > 120 && (
                  <div className="border-t border-white/5 px-2 py-1.5 text-[10px] text-slate-600">
                    visar 120 av {fills.length} — alla appliceras
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={applying || loading || willApply === 0}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-[#04202a] transition-colors hover:bg-cyan-400 disabled:opacity-40"
          >
            {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Koppla {willApply} ad sets
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
