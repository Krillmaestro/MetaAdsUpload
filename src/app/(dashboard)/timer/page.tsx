"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Play,
  Pause,
  Square,
  Timer as TimerIcon,
  Video,
  Search,
  Image,
  MoreHorizontal,
  Repeat,
  FileImage,
  History,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductivityDashboard } from "@/components/timer/productivity-dashboard";
import type { EditorAssignment, ScriptContent } from "@/components/assignments/assignment-card";

// --- Types ---
interface TimerState {
  status: "idle" | "running" | "paused";
  taskType: string;
  taskName: string;
  startedAt: number | null;
  pausedAt: number | null;
  accumulatedMs: number;
  assignmentId: string | null;
}

interface TimeEntry {
  id: string;
  taskType: string;
  taskName: string;
  startTime: string;
  endTime: string | null;
  duration: number | null;
  status: string;
}

const TASK_TYPES = [
  { value: "NEW_VIDEO", label: "New Video", icon: Video, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", activeBg: "bg-blue-500/20 border-blue-500/40" },
  { value: "VIDEO_SOURCING", label: "Video Sourcing", icon: Search, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", activeBg: "bg-purple-500/20 border-purple-500/40" },
  { value: "IMAGE_WORK", label: "Image Work", icon: Image, color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20", activeBg: "bg-pink-500/20 border-pink-500/40" },
  { value: "STATIC_AD", label: "Static Ad", icon: FileImage, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", activeBg: "bg-orange-500/20 border-orange-500/40" },
  { value: "REVISION_WORK", label: "Revision", icon: Repeat, color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20", activeBg: "bg-yellow-500/20 border-yellow-500/40" },
  { value: "OTHER", label: "Other", icon: MoreHorizontal, color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20", activeBg: "bg-slate-500/20 border-slate-500/40" },
];

const VIDEO_TASK_TYPES = ["NEW_VIDEO", "REVISION_WORK", "VIDEO_EDITING"];

const TIMER_STORAGE_KEY = "meta-ads-timer-state";

function formatTimer(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function loadTimerState(): TimerState {
  if (typeof window === "undefined") {
    return { status: "idle", taskType: "NEW_VIDEO", taskName: "", startedAt: null, pausedAt: null, accumulatedMs: 0, assignmentId: null };
  }
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { status: "idle", taskType: "NEW_VIDEO", taskName: "", startedAt: null, pausedAt: null, accumulatedMs: 0, assignmentId: null };
}

function saveTimerState(state: TimerState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(state));
}

export default function TimerPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[400px]"><div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" /></div>}>
      <TimerPageContent />
    </Suspense>
  );
}

function TimerPageContent() {
  const searchParams = useSearchParams();
  const assignmentIdParam = searchParams.get("assignmentId");
  const taskNameParam = searchParams.get("taskName");
  const taskTypeParam = searchParams.get("taskType");

  const [timerState, setTimerState] = useState<TimerState>(loadTimerState);
  const [displayMs, setDisplayMs] = useState(0);
  const [assignment, setAssignment] = useState<EditorAssignment | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<TimeEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Completion modal
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState("");
  const [completionComment, setCompletionComment] = useState("");
  const [googleDriveLink, setGoogleDriveLink] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const aId = assignmentIdParam || timerState.assignmentId;
    if (aId) {
      fetch(`/api/assignments/${aId}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) setAssignment(data); })
        .catch(console.error);
    }
  }, [assignmentIdParam, timerState.assignmentId]);

  useEffect(() => { saveTimerState(timerState); }, [timerState]);

  // Prefill from query params (e.g. /timer?taskType=OTHER&taskName=... from Team Tasks)
  useEffect(() => {
    if (!taskNameParam) return;
    setTimerState((prev) => {
      if (prev.status !== "idle") return prev;
      const type = taskTypeParam && TASK_TYPES.some((t) => t.value === taskTypeParam) ? taskTypeParam : "OTHER";
      return { ...prev, taskName: taskNameParam, taskType: type, assignmentId: null };
    });
  }, [taskNameParam, taskTypeParam]);

  useEffect(() => {
    if (timerState.status === "running" && timerState.startedAt) {
      intervalRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = now - timerState.startedAt! + timerState.accumulatedMs;
        setDisplayMs(elapsed);
      }, 100);
      return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    } else if (timerState.status === "paused") {
      setDisplayMs(timerState.accumulatedMs);
    } else {
      setDisplayMs(0);
    }
  }, [timerState.status, timerState.startedAt, timerState.accumulatedMs]);

  useEffect(() => {
    if (showHistory) {
      setHistoryLoading(true);
      fetch("/api/time?days=7")
        .then((r) => (r.ok ? r.json() : { entries: [] }))
        .then((data) => setHistory(data.entries || []))
        .catch(console.error)
        .finally(() => setHistoryLoading(false));
    }
  }, [showHistory]);

  const handleStart = () => {
    const aId = assignmentIdParam || null;
    setTimerState({
      status: "running",
      taskType: timerState.taskType,
      taskName: timerState.taskName || (assignment ? assignment.title : ""),
      startedAt: Date.now(),
      pausedAt: null,
      accumulatedMs: 0,
      assignmentId: aId,
    });
  };

  const handlePause = () => {
    if (timerState.status !== "running" || !timerState.startedAt) return;
    const now = Date.now();
    const accumulated = now - timerState.startedAt + timerState.accumulatedMs;
    setTimerState({ ...timerState, status: "paused", pausedAt: now, accumulatedMs: accumulated, startedAt: null });
  };

  const handleResume = () => {
    setTimerState({ ...timerState, status: "running", startedAt: Date.now(), pausedAt: null });
  };

  const handleStop = () => { setShowCompletionModal(true); };

  const handleComplete = async () => {
    setSubmitting(true);
    const durationSeconds = Math.floor(displayMs / 1000);
    try {
      if (timerState.assignmentId) {
        await fetch(`/api/assignments/${timerState.assignmentId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            videoLengthSeconds: videoSeconds ? parseInt(videoSeconds) : undefined,
            googleDriveLink: googleDriveLink || undefined,
            durationSeconds,
          }),
        });
      } else {
        await fetch("/api/time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskType: timerState.taskType,
            taskName: timerState.taskName,
            durationSeconds,
            videoOutputSeconds: videoSeconds ? parseInt(videoSeconds) : undefined,
            description: completionComment || undefined,
          }),
        });
      }
      setTimerState({ status: "idle", taskType: "NEW_VIDEO", taskName: "", startedAt: null, pausedAt: null, accumulatedMs: 0, assignmentId: null });
      setShowCompletionModal(false);
      setVideoSeconds("");
      setCompletionComment("");
      setGoogleDriveLink("");
      setAssignment(null);
      setDisplayMs(0);
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    setTimerState({ status: "idle", taskType: "NEW_VIDEO", taskName: "", startedAt: null, pausedAt: null, accumulatedMs: 0, assignmentId: null });
    setAssignment(null);
    setDisplayMs(0);
  };

  const isIdle = timerState.status === "idle";
  const isRunning = timerState.status === "running";
  const isPaused = timerState.status === "paused";
  const showVideoField = VIDEO_TASK_TYPES.includes(timerState.taskType) || timerState.assignmentId;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white flex items-center justify-center gap-3">
          <TimerIcon className="h-6 w-6 text-cyan-400" />
          Timer
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Track your work sessions</p>
      </div>

      {/* Timer Display */}
      <div className={cn(
        "rounded-xl border overflow-hidden transition-all",
        isRunning && "border-emerald-500/30 bg-[#111827] shadow-[0_0_30px_rgba(16,185,129,0.08)]",
        isPaused && "border-yellow-500/30 bg-[#111827] shadow-[0_0_30px_rgba(234,179,8,0.08)]",
        isIdle && "border-white/5 bg-[#111827]"
      )}>
        <div className="py-12 text-center px-6">
          {/* Timer digits */}
          <div className={cn(
            "text-7xl font-mono font-bold tracking-wider mb-8 transition-colors",
            isRunning && "text-emerald-400",
            isPaused && "text-yellow-400",
            isIdle && "text-slate-600"
          )}>
            {formatTimer(displayMs)}
          </div>

          {/* Pulse indicator when running */}
          {isRunning && (
            <div className="flex items-center justify-center gap-2 mb-6">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400" />
              </span>
              <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Recording</span>
            </div>
          )}

          {/* Task Type Selector (only when idle and no assignment) */}
          {isIdle && !assignmentIdParam && (
            <div className="mb-6">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Select Task Type</p>
              <div className="flex flex-wrap justify-center gap-2">
                {TASK_TYPES.map((tt) => {
                  const Icon = tt.icon;
                  const active = timerState.taskType === tt.value;
                  return (
                    <button
                      key={tt.value}
                      onClick={() => setTimerState({ ...timerState, taskType: tt.value })}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                        active ? `${tt.activeBg} ${tt.color}` : `${tt.bg} text-slate-400 hover:text-slate-200`
                      )}
                    >
                      <Icon className={cn("h-4 w-4", tt.color)} />
                      {tt.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 max-w-sm mx-auto">
                <Input
                  value={timerState.taskName}
                  onChange={(e) => setTimerState({ ...timerState, taskName: e.target.value })}
                  placeholder="Task description (optional)"
                  className="bg-white/5 border-white/10 placeholder:text-slate-600 text-center"
                />
              </div>
            </div>
          )}

          {/* Assignment info when in assignment context */}
          {assignmentIdParam && isIdle && assignment && (
            <div className="mb-6">
              <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 mb-2">
                Assignment Mode
              </span>
              <p className="text-lg font-semibold text-white">
                {assignment.autoName || assignment.title}
              </p>
              <p className="text-sm text-slate-500">
                {assignment.format?.name}
                {assignment.angle ? ` | ${assignment.angle.name}` : ""}
              </p>
            </div>
          )}

          {/* Active session info */}
          {!isIdle && (
            <div className="mb-6">
              <p className="text-sm text-slate-400">
                {timerState.assignmentId && assignment
                  ? `Working on: ${assignment.autoName || assignment.title}`
                  : `Task: ${TASK_TYPES.find((t) => t.value === timerState.taskType)?.label || timerState.taskType}`}
              </p>
              {timerState.taskName && !timerState.assignmentId && (
                <p className="text-xs text-slate-500 mt-1">{timerState.taskName}</p>
              )}
            </div>
          )}

          {/* Controls */}
          <div className="flex justify-center gap-3">
            {isIdle && (
              <button
                onClick={handleStart}
                className="flex items-center gap-2 px-8 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-semibold text-white hover:from-cyan-400 hover:to-cyan-500 transition-all shadow-lg shadow-cyan-500/20"
              >
                <Play className="h-5 w-5" />
                Start
              </button>
            )}
            {isRunning && (
              <>
                <button
                  onClick={handlePause}
                  className="flex items-center gap-2 px-8 py-3 rounded-lg bg-white/5 border border-white/10 text-sm font-medium text-slate-300 hover:bg-white/10 transition-all"
                >
                  <Pause className="h-5 w-5" />
                  Pause
                </button>
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-8 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-all"
                >
                  <Square className="h-5 w-5" />
                  Stop
                </button>
              </>
            )}
            {isPaused && (
              <>
                <button
                  onClick={handleResume}
                  className="flex items-center gap-2 px-8 py-3 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-semibold text-white hover:from-cyan-400 hover:to-cyan-500 transition-all shadow-lg shadow-cyan-500/20"
                >
                  <Play className="h-5 w-5" />
                  Resume
                </button>
                <button
                  onClick={handleStop}
                  className="flex items-center gap-2 px-8 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-all"
                >
                  <Square className="h-5 w-5" />
                  Stop
                </button>
              </>
            )}
            {!isIdle && (
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-6 py-3 rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-all"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Assignment Script */}
      {assignment?.scriptContent && !isIdle && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
            <FileText className="h-4 w-4 text-cyan-400" />
            <h3 className="text-sm font-semibold text-white">Script</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3 w-16" />
                  <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">English</th>
                  <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Swedish</th>
                </tr>
              </thead>
              <tbody>
                {(assignment.scriptContent as ScriptContent).hooks?.map((hook, i) =>
                  hook.eng || hook.se ? (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-xs font-medium text-slate-500">H{i + 1}</td>
                      <td className="px-4 py-3 text-xs text-slate-300">{hook.eng || "-"}</td>
                      <td className="px-4 py-3 text-xs text-slate-300">{hook.se || "-"}</td>
                    </tr>
                  ) : null
                )}
                {((assignment.scriptContent as ScriptContent).body.eng ||
                  (assignment.scriptContent as ScriptContent).body.se) && (
                  <tr className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-xs font-medium text-slate-500">Body</td>
                    <td className="px-4 py-3 text-xs text-slate-300 whitespace-pre-wrap">
                      {(assignment.scriptContent as ScriptContent).body.eng || "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300 whitespace-pre-wrap">
                      {(assignment.scriptContent as ScriptContent).body.se || "-"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Assignment Details */}
      {assignment && !isIdle && (
        <div className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5">
            <h3 className="text-sm font-semibold text-white">Assignment Details</h3>
          </div>
          <div className="p-5 space-y-3">
            {[
              { label: "Format", value: assignment.format?.name },
              { label: "Product", value: assignment.product?.name },
              { label: "Angle", value: assignment.angle?.name },
              ...(assignment.dueDate ? [{ label: "Due Date", value: new Date(assignment.dueDate).toLocaleDateString("sv-SE") }] : []),
              ...(assignment.estimatedMinutes ? [{ label: "Estimated", value: `${assignment.estimatedMinutes} min` }] : []),
            ].map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-slate-500">{row.label}</span>
                <span className="font-medium text-white">{row.value || "-"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History Section */}
      <div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center justify-between w-full px-4 py-3 rounded-lg bg-white/[0.02] border border-white/5 text-sm text-slate-400 hover:bg-white/[0.04] hover:text-slate-300 transition-all"
        >
          <span className="flex items-center gap-2">
            <History className="h-4 w-4 text-cyan-400" />
            Recent History
          </span>
          {showHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showHistory && (
          <div className="mt-2 rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
            {historyLoading ? (
              <div className="py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent mx-auto" />
              </div>
            ) : history.length === 0 ? (
              <div className="py-8 text-center text-slate-500 text-sm">No recent entries</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Date</th>
                    <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Task</th>
                    <th className="text-left text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Type</th>
                    <th className="text-right text-[10px] font-medium text-slate-500 uppercase tracking-wider px-4 py-3">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 20).map((entry, i) => (
                    <tr key={entry.id} className={cn("border-b border-white/5 hover:bg-white/[0.02]", i % 2 === 0 ? "bg-white/[0.01]" : "")}>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {new Date(entry.startTime).toLocaleDateString("sv-SE")}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300 truncate max-w-[200px]">
                        {entry.taskName}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{entry.taskType}</td>
                      <td className="px-4 py-3 text-xs text-right text-white font-medium">
                        {entry.duration ? formatDuration(entry.duration) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Productivity Dashboard */}
      <ProductivityDashboard />

      {/* Completion Modal */}
      <Dialog open={showCompletionModal} onOpenChange={setShowCompletionModal}>
        <DialogContent className="max-w-md bg-[#111827] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white">Complete Work Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center py-2">
              <p className="text-3xl font-mono font-bold text-white">{formatTimer(displayMs)}</p>
              <p className="text-sm text-slate-500 mt-1">Total time tracked</p>
            </div>

            {showVideoField && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Video Length (seconds)</label>
                <Input
                  type="number"
                  value={videoSeconds}
                  onChange={(e) => setVideoSeconds(e.target.value)}
                  placeholder="e.g. 45"
                  min="1"
                  className="bg-white/5 border-white/10 placeholder:text-slate-600"
                />
              </div>
            )}

            {timerState.assignmentId && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Google Drive Link (optional)</label>
                <Input
                  value={googleDriveLink}
                  onChange={(e) => setGoogleDriveLink(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="bg-white/5 border-white/10 placeholder:text-slate-600"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Notes (optional)</label>
              <Textarea
                value={completionComment}
                onChange={(e) => setCompletionComment(e.target.value)}
                rows={2}
                placeholder="Any notes about this session..."
                className="bg-white/5 border-white/10 placeholder:text-slate-600"
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setShowCompletionModal(false)}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
            >
              Continue Working
            </button>
            <button
              onClick={handleComplete}
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Complete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
