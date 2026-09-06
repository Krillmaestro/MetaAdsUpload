"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle, Loader2, AlertTriangle, RotateCcw, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface JobSummary {
  id: string; assignmentId: string; status: string; step: string; stepLabel: string; attempts: number; lastError: string | null;
  totalAds: number | null; nextRunAt: string | null; createdAt: string; updatedAt: string; finishedAt: string | null;
  progress: { step: string; stepIndex: number; steps: number; files: number; mediaReady: number; adsDone: number; adsTotal: number; campaignId?: string; adsetId?: string; adsetName?: string; ads: Array<{ adId: string; adName: string }>; log: Array<{ at: string; msg: string }> };
}

const STEPS: Array<{ key: string; label: string }> = [
  { key: "preflight", label: "Checks" },
  { key: "campaign", label: "Campaign" },
  { key: "adset", label: "Ad set" },
  { key: "media", label: "Media to Meta" },
  { key: "ads", label: "Ads" },
  { key: "finalize", label: "Saving" },
];
const ACTIVE = new Set(["queued", "running", "waiting"]);

/**
 * Shows an Upload-to-Meta job and keeps it moving: while the job is active
 * this polls the run endpoint, which advances the job a little each time.
 * Closing the page is fine — the server and the worker continue.
 */
export function PublishProgress({ jobId, initial, compact, onDone }: { jobId: string; initial?: JobSummary | null; compact?: boolean; onDone?: (job: JobSummary) => void }) {
  const [job, setJob] = useState<JobSummary | null>(initial ?? null);
  const [retrying, setRetrying] = useState(false);
  const doneFired = useRef(false);

  const tick = useCallback(async () => {
    try {
      const res = await fetch(`/api/publish-jobs/${jobId}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.job) setJob(data.job);
    } catch { /* next tick */ }
  }, [jobId]);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      if (stop) return;
      await tick();
      if (!stop) timer = setTimeout(loop, 3000);
    };
    loop();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [tick]);

  useEffect(() => {
    if (job && !ACTIVE.has(job.status) && !doneFired.current) { doneFired.current = true; if (job.status === "done") onDone?.(job); }
  }, [job, onDone]);

  const retry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/publish-jobs/${jobId}/retry`, { method: "POST" });
      const data = await res.json();
      if (data.job) { doneFired.current = false; setJob(data.job); }
    } finally {
      setRetrying(false);
    }
  };

  if (!job) return <div className="flex items-center gap-2 text-sm text-slate-400 py-4"><Loader2 className="h-4 w-4 animate-spin" /> Starting…</div>;
  const p = job.progress;
  const active = ACTIVE.has(job.status);
  const failed = job.status === "failed";
  const done = job.status === "done";
  const idx = STEPS.findIndex((s) => s.key === job.step);

  return (
    <div className={cn("space-y-3", compact ? "text-xs" : "text-sm")}>
      <div className="flex items-center gap-2">
        {done ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : failed ? <AlertTriangle className="h-5 w-5 text-red-400" /> : <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />}
        <div className="min-w-0">
          <div className="font-semibold text-white">
            {done ? `Uploaded: ${p.adsDone} ads in ${p.adsetName ?? "the ad set"} (paused)` : failed ? "Upload stopped" : job.status === "waiting" && job.step === "media" ? "Meta is processing the videos…" : job.stepLabel}
          </div>
          {!done && <div className="text-slate-500">{active ? "Runs on the server — you can close this window." : "Fix the cause and press Retry; it continues from where it stopped."}</div>}
        </div>
      </div>

      <ol className="flex flex-wrap gap-x-3 gap-y-1">
        {STEPS.map((s, i) => {
          const state = done || i < idx ? "done" : i === idx ? (failed ? "failed" : "current") : "todo";
          return (
            <li key={s.key} className={cn("flex items-center gap-1", state === "done" ? "text-emerald-400" : state === "current" ? "text-cyan-300" : state === "failed" ? "text-red-400" : "text-slate-600")}>
              {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : state === "current" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "failed" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
              {s.label}
              {s.key === "media" && p.files > 0 && <span className="text-slate-500">{p.mediaReady}/{p.files}</span>}
              {s.key === "ads" && p.adsTotal > 0 && <span className="text-slate-500">{p.adsDone}/{p.adsTotal}</span>}
            </li>
          );
        })}
      </ol>

      {failed && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 space-y-2">
          <div className="text-red-200 break-words">{job.lastError}</div>
          <Button size="sm" onClick={retry} disabled={retrying} className="bg-red-500/20 hover:bg-red-500/30 text-red-100 border border-red-500/30">
            {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry</>}
          </Button>
        </div>
      )}
      {active && job.attempts > 0 && job.lastError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-amber-200">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Retry {job.attempts} scheduled{job.nextRunAt ? ` (${new Date(job.nextRunAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })})` : ""}: {job.lastError}</span>
        </div>
      )}

      {!compact && p.log.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-lg border border-white/5 bg-black/20 p-2 font-mono text-[11px] text-slate-400 space-y-0.5">
          {p.log.slice(-8).map((l, i) => (
            <div key={i}><span className="text-slate-600">{new Date(l.at).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span> {l.msg}</div>
          ))}
        </div>
      )}
      {done && !compact && p.ads.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
          {p.ads.map((ad) => <div key={ad.adId} className="px-3 py-1 text-xs text-slate-300 truncate">{ad.adName}</div>)}
        </div>
      )}
    </div>
  );
}
