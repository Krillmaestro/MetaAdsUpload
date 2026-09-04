"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Link2, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "./format";

interface AssignmentLite {
  id: string;
  batchNumber: number;
  autoName: string | null;
  title: string;
  status: string;
  assignedTo?: { name: string } | null;
  product?: { name: string } | null;
  format?: { name: string } | null;
}

interface AdsetLite {
  adsetId: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  assignmentId: string | null;
}

interface Suggestion {
  adsetId: string;
  adsetName: string;
  score: number;
  confidence: "high" | "medium";
  reasons: string[];
  currentAssignmentName?: string | null;
}

type Props =
  | {
      mode: "adset";
      adsetId: string;
      adsetName: string;
      open: boolean;
      onOpenChange: (o: boolean) => void;
      onLinked: (assignmentId: string) => void;
    }
  | {
      mode: "creative";
      adIds: string[];
      creativeName: string;
      open: boolean;
      onOpenChange: (o: boolean) => void;
      onLinked: (assignmentId: string) => void;
    }
  | {
      /** Pick the ORIGIN ad set (where the creative was tested) for a creative. */
      mode: "origin";
      adIds: string[];
      creativeName: string;
      open: boolean;
      onOpenChange: (o: boolean) => void;
      onLinked: (adsetId: string) => void;
    }
  | {
      mode: "assignment";
      assignmentId: string;
      assignmentName: string;
      open: boolean;
      onOpenChange: (o: boolean) => void;
      onLinked: (adsetIds: string[]) => void;
    };

/**
 * Manual linking in every direction:
 *  - mode "adset":      pick the brief this ad set runs
 *  - mode "creative":   pick the brief this creative (its ads) is
 *  - mode "origin":     pick the ad set a creative was TESTED in (its origin)
 *  - mode "assignment": pick the ad set(s) this brief runs in (with the
 *    name-matcher's suggestions on top)
 */
export function LinkPicker(props: Props) {
  const { open, onOpenChange } = props;
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState<AssignmentLite[]>([]);
  const [adsets, setAdsets] = useState<AdsetLite[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSelected(new Set());
    setLoading(true);
    if (props.mode === "adset" || props.mode === "creative") {
      fetch("/api/assignments")
        .then((r) => r.json())
        .then((d: AssignmentLite[]) => setAssignments(Array.isArray(d) ? d.filter((a) => a.status !== "DRAFT") : []))
        .catch(() => setAssignments([]))
        .finally(() => setLoading(false));
    } else if (props.mode === "origin") {
      fetch("/api/learning-loop/adsets?q=")
        .then((r) => r.json())
        .then((d) => setAdsets((d.adsets ?? []) as AdsetLite[]))
        .catch(() => setAdsets([]))
        .finally(() => setLoading(false));
    } else {
      Promise.all([
        fetch(`/api/learning-loop/links?assignmentId=${props.assignmentId}`).then((r) => r.json()).catch(() => ({ proposals: [] })),
        fetch("/api/learning-loop/adsets?q=").then((r) => r.json()).catch(() => ({ adsets: [] })),
      ])
        .then(([links, list]) => {
          setSuggestions((links.proposals ?? []) as Suggestion[]);
          setAdsets((list.adsets ?? []) as AdsetLite[]);
        })
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Server-side ad set search as the query changes (assignment / origin mode).
  useEffect(() => {
    if (!open || (props.mode !== "assignment" && props.mode !== "origin")) return;
    const t = setTimeout(() => {
      fetch(`/api/learning-loop/adsets?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setAdsets((d.adsets ?? []) as AdsetLite[]))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open]);

  const filteredAssignments = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = assignments.slice().sort((a, b) => b.batchNumber - a.batchNumber);
    if (!s) return list.slice(0, 60);
    return list.filter((a) => `${a.batchNumber} ${a.autoName ?? ""} ${a.title} ${a.assignedTo?.name ?? ""} ${a.product?.name ?? ""}`.toLowerCase().includes(s)).slice(0, 60);
  }, [assignments, q]);

  const linkAdsetToAssignment = async (assignmentId: string) => {
    if (props.mode === "assignment" || props.mode === "origin") return;
    setSaving(true);
    try {
      const res = await fetch(props.mode === "creative" ? "/api/learning-loop/ad" : "/api/learning-loop/adset", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          props.mode === "creative"
            ? { adIds: props.adIds, assignmentId }
            : { adsetId: props.adsetId, adsetName: props.adsetName, assignmentId },
        ),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte koppla");
      toast.success(props.mode === "creative" ? "Creative kopplad till brief" : "Ad set kopplat till brief");
      props.onLinked(assignmentId);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte koppla");
    } finally {
      setSaving(false);
    }
  };

  const linkSelectedAdsets = async () => {
    if (props.mode !== "assignment" || selected.size === 0) return;
    setSaving(true);
    try {
      const pairs = [...selected].map((adsetId) => ({ assignmentId: props.assignmentId, adsetId }));
      const res = await fetch("/api/learning-loop/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte koppla");
      toast.success(`${pairs.length} ad set kopplade`);
      props.onLinked([...selected]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte koppla");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const pickOrigin = async (adsetId: string) => {
    if (props.mode !== "origin") return;
    setSaving(true);
    try {
      const res = await fetch("/api/learning-loop/ad", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adIds: props.adIds, originAdsetId: adsetId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Kunde inte spara ursprung");
      toast.success("Ursprungs-ad set satt");
      props.onLinked(adsetId);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara ursprung");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] sm:max-w-2xl bg-[#0d1117] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Link2 className="h-4 w-4 text-cyan-400" />
            {props.mode === "adset" ? "Koppla ad set till brief" : props.mode === "creative" ? "Koppla creative till brief" : props.mode === "origin" ? "Välj ursprungs-ad set" : "Koppla brief till ad set"}
          </DialogTitle>
          <p className="text-xs text-slate-500 truncate">
            {props.mode === "adset" ? props.adsetName : props.mode === "creative" || props.mode === "origin" ? props.creativeName : props.assignmentName}
          </p>
          {props.mode === "origin" && (
            <p className="text-xs text-slate-500">Det ad set där creativen TESTADES. Resultatet från scaling-kopior bokförs där.</p>
          )}
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={props.mode === "assignment" || props.mode === "origin" ? "Sök ad set-namn…" : "Sök batch, namn, editor, produkt…"}
            className="pl-9 bg-white/5 border-white/10 text-sm"
          />
        </div>

        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : props.mode === "origin" ? (
            adsets.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Inga ad sets hittades.</p>
            ) : (
              adsets.map((s) => (
                <button
                  key={s.adsetId}
                  type="button"
                  disabled={saving}
                  onClick={() => pickOrigin(s.adsetId)}
                  className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-left hover:border-cyan-500/30 hover:bg-cyan-500/5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">{s.name}</div>
                    <div className="truncate text-[11px] text-slate-500">{s.campaignName ?? s.campaignId ?? "—"}</div>
                  </div>
                </button>
              ))
            )
          ) : props.mode !== "assignment" ? (
            filteredAssignments.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Inga briefs hittades</p>
            ) : (
              filteredAssignments.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  disabled={saving}
                  onClick={() => linkAdsetToAssignment(a.id)}
                  className="flex w-full items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-left hover:border-cyan-500/30 hover:bg-cyan-500/5"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-200">
                      <span className="font-mono text-cyan-400">#{a.batchNumber}</span> {a.autoName || a.title}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {a.assignedTo?.name} · {a.product?.name ?? "—"} · {a.format?.name ?? "—"}
                    </div>
                  </div>
                  <span className="ml-3 shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                    {STATUS_LABEL[a.status.toLowerCase()] ?? a.status}
                  </span>
                </button>
              ))
            )
          ) : (
            <>
              {suggestions.length > 0 && !q && (
                <div className="mb-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                    <Sparkles className="h-3 w-3" /> Förslag från namnmatchning
                  </div>
                  {suggestions.map((s) => (
                    <label key={s.adsetId} className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 hover:bg-amber-500/10">
                      <input type="checkbox" className="mt-1" checked={selected.has(s.adsetId)} onChange={() => toggle(s.adsetId)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-200">{s.adsetName}</div>
                        <div className="text-[11px] text-slate-500">
                          <span className={cn("mr-2 font-medium", s.confidence === "high" ? "text-emerald-400" : "text-amber-400")}>{s.score}p {s.confidence === "high" ? "säker" : "osäker"}</span>
                          {s.reasons.join(" · ")}
                          {s.currentAssignmentName && <span className="text-red-400"> · kopplad till {s.currentAssignmentName}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {adsets.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">Inga ad sets hittades — prova &quot;Uppdatera från Meta&quot; på Learning Loop-sidan.</p>
              ) : (
                adsets.map((s) => (
                  <label key={s.adsetId} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 hover:bg-white/5", selected.has(s.adsetId) && "border-cyan-500/40 bg-cyan-500/5")}>
                    <input type="checkbox" className="mt-1" checked={selected.has(s.adsetId)} onChange={() => toggle(s.adsetId)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-200">{s.name}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {s.campaignName ?? s.campaignId ?? "—"}
                        {s.assignmentId && <span className="text-amber-400"> · redan kopplad</span>}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </>
          )}
        </div>

        {props.mode === "assignment" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-white/10">Avbryt</Button>
            <Button onClick={linkSelectedAdsets} disabled={saving || selected.size === 0} className="bg-cyan-600 hover:bg-cyan-500 text-white">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
              Koppla {selected.size > 0 ? `(${selected.size})` : ""}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
