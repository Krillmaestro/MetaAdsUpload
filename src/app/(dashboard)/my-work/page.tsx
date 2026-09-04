"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Play,
  CheckCircle,
  AlertCircle,
  Calendar,
  FileText,
  ChevronDown,
  ChevronUp,
  Timer,
  Video,
  Image,
  Film,
  Flag,
  Target,
  MessageSquare,
  RefreshCw,
  ClipboardList,
  Upload,
  FileVideo,
  ExternalLink,
  TrendingUp,
  DollarSign,
  ShoppingCart,
  BarChart3,
  Loader2,
  Undo2,
  StickyNote,
  Eye,
  X,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  formatDuration,
  type EditorAssignment,
  type AssignmentStatus,
  type ScriptContent,
} from "@/components/assignments/assignment-card";

interface MyAssignmentsResponse {
  needsAttention: EditorAssignment[];
  active: EditorAssignment[];
  pending: EditorAssignment[];
  inReview: EditorAssignment[];
  posted: EditorAssignment[];
  total: number;
}

interface FileComment {
  id: string;
  timecodeSeconds: number | null;
  body: string;
  author: string;
  isResolved: boolean;
}

// One row per file (hook). A revision replaces its file, so the list only
// ever holds what currently exists.
interface DeliverableFileInfo {
  id: string;
  filename: string;
  r2Url: string;
  hookLabel: string | null;
  versionNumber: number;
  reviewStatus: "no_status" | "in_progress" | "needs_review" | "approved";
  reviewNote: string | null;
  metaAdId: string | null;
  createdAt: string;
  comments: FileComment[];
}

/** "H2 SE Fervin …mp4" → "H2" (what the server uses to match a revision). */
const hookLabelOf = (filename: string): string | null => {
  const m = filename.match(/^\s*(H\d+)(?![A-Za-z0-9])/i);
  return m ? m[1].toUpperCase() : null;
};

const formatTimecode = (seconds: number | null) => {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const FILE_STATUS: Record<DeliverableFileInfo["reviewStatus"], { label: string; className: string }> = {
  no_status: { label: "Pending", className: "border-white/10 text-slate-400" },
  in_progress: { label: "Pending", className: "border-white/10 text-slate-400" },
  approved: { label: "Approved", className: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" },
  needs_review: { label: "Needs revision", className: "border-orange-500/30 text-orange-400 bg-orange-500/10" },
};

interface PendingUpload {
  assignmentId: string;
  files: File[];
  /** index in files → id of the flagged file it replaces, or "" for a new file */
  replaces: Record<number, string>;
}

interface AdInsight {
  assignmentId: string;
  adId: string;
  autoName: string;
  spend: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpa: number;
  ctr: number;
  cpc: number;
  cpm: number;
}

const FORMAT_ICONS: Record<string, React.ElementType> = {
  STATIC: Image,
  UGC: Video,
  VSL: Film,
  VIDEO: Video,
};

export default function MyWorkPage() {
  const router = useRouter();
  const [data, setData] = useState<MyAssignmentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "review" | "all">("active");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [takingBackId, setTakingBackId] = useState<string | null>(null);

  // Upload state
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadQueue, setUploadQueue] = useState<{ current: number; total: number } | null>(null);
  const [versionsByAssignment, setVersionsByAssignment] = useState<Record<string, DeliverableFileInfo[]>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Revision: which flagged file each chosen file replaces, confirmed before upload
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revisionDoneIds, setRevisionDoneIds] = useState<Set<string>>(new Set());
  // Server-side refusals (e.g. a flagged file not yet replaced), per assignment
  const [actionError, setActionError] = useState<Record<string, string>>({});

  // Video length modal state
  const [videoLengthModalId, setVideoLengthModalId] = useState<string | null>(null);
  const [videoLengthInput, setVideoLengthInput] = useState("");

  // Performance insights
  const [insights, setInsights] = useState<AdInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const fetchAssignments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/assignments/my");
      if (!res.ok) throw new Error("Failed to fetch assignments");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const res = await fetch("/api/assignments/my/insights");
      if (res.ok) {
        const json = await res.json();
        setInsights(json.insights || []);
      }
    } catch {
      // Silently fail - insights are optional
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAssignments(); }, [fetchAssignments]);
  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  // Fetch the list of uploaded deliverable files for an assignment
  const fetchVersions = useCallback(async (assignmentId: string) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/versions`);
      if (!res.ok) return;
      const versions: DeliverableFileInfo[] = await res.json();
      setVersionsByAssignment((prev) => ({ ...prev, [assignmentId]: versions }));
    } catch { /* list is a nice-to-have; single deliverableUrl still shows */ }
  }, []);

  useEffect(() => {
    if (expandedId) fetchVersions(expandedId);
  }, [expandedId, fetchVersions]);

  // Upload a single file to R2 and register it as a deliverable.
  // replacesId = the flagged file this one is the revision of (server deletes the old file).
  const uploadOne = async (assignmentId: string, file: File, opts: { replacesId?: string } = {}) => {
    // 1. Get presigned URL
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
        assignmentId,
      }),
    });
    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to get upload URL");
    }
    const { uploadUrl, publicUrl, key } = await presignRes.json();
    setUploadProgress(10);

    // 2. Upload directly to R2
    const xhr = new XMLHttpRequest();
    await new Promise<void>((resolve, reject) => {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(10 + Math.round((e.loaded / e.total) * 80));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed: ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
    setUploadProgress(95);

    // 3. Save as a deliverable file on the assignment
    const saveRes = await fetch(`/api/assignments/${assignmentId}/deliverable`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliverableUrl: publicUrl,
        deliverableR2Key: key,
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
        hookLabel: hookLabelOf(file.name),
        replacesId: opts.replacesId || undefined,
      }),
    });
    if (!saveRes.ok) {
      const err = await saveRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save deliverable");
    }
    setUploadProgress(100);
  };

  // Upload one or more files, sequentially, with per-file progress
  const runUploads = async (assignmentId: string, files: File[], replaces: Record<number, string> = {}) => {
    setUploadingId(assignmentId);
    setActionError((prev) => ({ ...prev, [assignmentId]: "" }));
    let failedAt: string | null = null;
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadQueue({ current: i + 1, total: files.length });
        setUploadProgress(0);
        failedAt = files[i].name;
        await uploadOne(assignmentId, files[i], { replacesId: replaces[i] || undefined });
        failedAt = null;
      }
    } catch (err) {
      console.error("Upload error:", err);
      setActionError((prev) => ({
        ...prev,
        [assignmentId]: (failedAt ? `"${failedAt}": ` : "") + (err instanceof Error ? err.message : "Upload failed"),
      }));
    } finally {
      // Keep what did upload — refresh so the successful files show
      await Promise.all([fetchAssignments(), fetchVersions(assignmentId)]);
      setUploadingId(null);
      setUploadQueue(null);
      setUploadProgress(0);
    }
  };

  // Files chosen in the picker. When files are flagged for revision, the
  // editor first confirms which flagged file each upload replaces.
  const handleUpload = async (assignmentId: string, files: File[]) => {
    const flagged = (versionsByAssignment[assignmentId] ?? []).filter((v) => v.reviewStatus === "needs_review");
    if (flagged.length === 0) {
      await runUploads(assignmentId, files);
      return;
    }
    const replaces: Record<number, string> = {};
    files.forEach((file, i) => {
      const label = hookLabelOf(file.name);
      const byLabel = label ? flagged.find((v) => v.hookLabel === label) : undefined;
      if (byLabel) replaces[i] = byLabel.id;
      else if (flagged.length === 1 && files.length === 1) replaces[i] = flagged[0].id;
      else replaces[i] = "";
    });
    setPendingUpload({ assignmentId, files, replaces });
  };

  const confirmPendingUpload = async () => {
    if (!pendingUpload) return;
    const { assignmentId, files, replaces } = pendingUpload;
    setPendingUpload(null);
    await runUploads(assignmentId, files, replaces);
    // Nothing left flagged → the revision is complete
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/versions`);
      if (res.ok) {
        const versions: DeliverableFileInfo[] = await res.json();
        setVersionsByAssignment((prev) => ({ ...prev, [assignmentId]: versions }));
        if (!versions.some((v) => v.reviewStatus === "needs_review")) {
          setRevisionDoneIds((prev) => new Set(prev).add(assignmentId));
        }
      }
    } catch { /* list refresh is best effort */ }
  };

  const handleDeleteFile = async (assignmentId: string, versionId: string) => {
    setDeletingId(versionId);
    setActionError((prev) => ({ ...prev, [assignmentId]: "" }));
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/versions/${versionId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to remove file");
      }
      await Promise.all([fetchAssignments(), fetchVersions(assignmentId)]);
    } catch (err) {
      setActionError((prev) => ({ ...prev, [assignmentId]: err instanceof Error ? err.message : "Failed to remove file" }));
    } finally {
      setDeletingId(null);
      setRemoveConfirmId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <div className="rounded-xl border border-white/5 bg-[#111827] p-8 text-center">
          <FileText className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">No Assignments Yet</h2>
          <p className="text-slate-500 mb-4">
            You don&apos;t have any assignments right now. When an admin assigns you a task, it will appear here.
          </p>
          <button
            onClick={fetchAssignments}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>
    );
  }

  const allAssignments = [
    ...(data.needsAttention || []),
    ...(data.active || []),
    ...(data.pending || []),
    ...(data.inReview || []),
    ...(data.posted || []),
  ].filter((a, i, self) => i === self.findIndex((t) => t.id === a.id));

  const filteredAssignments = allAssignments.filter((a) => {
    if (filter === "active") return a.status !== "READY_FOR_REVIEW";
    if (filter === "review") return a.status === "READY_FOR_REVIEW";
    return true;
  });

  const sortedAssignments = [...filteredAssignments].sort((a, b) => {
    const priorityOrder = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const pA = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 2;
    const pB = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 2;
    if (pA !== pB) return pA - pB;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });

  const activeCount = allAssignments.filter((a) => a.status !== "READY_FOR_REVIEW").length;
  const inProgressCount = allAssignments.filter((a) => a.status === "EDITING_NOW").length;
  const revisionCount = allAssignments.filter((a) => a.status === "REVISION").length;
  const inReviewCount = allAssignments.filter((a) => a.status === "READY_FOR_REVIEW").length;

  const handleStartWorking = async (assignment: EditorAssignment) => {
    setStartingId(assignment.id);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}/start`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to start");
      router.push(`/timer?assignmentId=${assignment.id}`);
    } catch (err) {
      console.error(err);
      setStartingId(null);
    }
  };

  const handleMarkComplete = (assignment: EditorAssignment) => {
    setVideoLengthModalId(assignment.id);
    setVideoLengthInput("");
  };

  const handleConfirmComplete = async () => {
    if (!videoLengthModalId) return;
    setCompletingId(videoLengthModalId);
    try {
      const res = await fetch(`/api/assignments/${videoLengthModalId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoLengthSeconds: videoLengthInput ? parseInt(videoLengthInput) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to submit for review");
      }
      setActionError((prev) => ({ ...prev, [videoLengthModalId]: "" }));
      setVideoLengthModalId(null);
      fetchAssignments();
    } catch (err) {
      console.error(err);
      setActionError((prev) => ({ ...prev, [videoLengthModalId]: err instanceof Error ? err.message : "Failed to submit for review" }));
      setVideoLengthModalId(null);
    } finally {
      setCompletingId(null);
    }
  };

  const handleTakeBack = async (assignment: EditorAssignment) => {
    setTakingBackId(assignment.id);
    try {
      const res = await fetch(`/api/assignments/${assignment.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "EDITING_NOW" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to take back");
      }
      fetchAssignments();
    } catch (err) {
      setActionError((prev) => ({ ...prev, [assignment.id]: err instanceof Error ? err.message : "Failed to take back" }));
    } finally {
      setTakingBackId(null);
    }
  };

  // The file list: hook chip, name, version, review status, and for a flagged
  // file the reviewer's note plus the timecoded comments to act on.
  const renderFileList = (assignment: EditorAssignment, canManage: boolean) => {
    const files = versionsByAssignment[assignment.id] ?? [];
    if (files.length === 0) {
      return assignment.deliverableUrl ? (
        <a
          href={assignment.deliverableUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-cyan-400 hover:underline"
        >
          View uploaded file <ExternalLink className="h-3 w-3" />
        </a>
      ) : null;
    }
    return (
      <div className="space-y-1.5">
        {files.map((v) => {
          const status = FILE_STATUS[v.reviewStatus] ?? FILE_STATUS.no_status;
          const openComments = v.comments.filter((c) => !c.isResolved);
          const flagged = v.reviewStatus === "needs_review";
          return (
            <div
              key={v.id}
              className={cn(
                "rounded-lg border p-2",
                flagged ? "border-orange-500/20 bg-orange-500/5" : "border-white/5 bg-white/[0.02]"
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center justify-center min-w-[2rem] px-1.5 h-5 rounded text-[10px] font-semibold tracking-wide bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex-shrink-0">
                  {v.hookLabel ?? "—"}
                </span>
                <a
                  href={v.r2Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-cyan-400 hover:underline truncate min-w-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <FileVideo className="h-3 w-3 flex-shrink-0 text-slate-500" />
                  <span className="truncate">{v.filename}</span>
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                </a>
                {v.versionNumber > 1 && (
                  <span className="text-[10px] text-slate-500 flex-shrink-0">v{v.versionNumber}</span>
                )}
                <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5 flex-shrink-0 ml-auto", status.className)}>
                  {status.label}
                </Badge>
                {canManage && !v.metaAdId && (
                  removeConfirmId === v.id ? (
                    <span className="flex items-center gap-1 text-[11px] flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <span className="text-slate-400">Remove?</span>
                      <button
                        onClick={() => handleDeleteFile(assignment.id, v.id)}
                        disabled={deletingId === v.id}
                        className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-50"
                      >
                        {deletingId === v.id ? "…" : "Yes"}
                      </button>
                      <button
                        onClick={() => setRemoveConfirmId(null)}
                        className="px-1.5 py-0.5 rounded bg-white/5 text-slate-300 hover:bg-white/10"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setRemoveConfirmId(v.id); }}
                      title="Remove file"
                      className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 flex-shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )
                )}
              </div>
              {flagged && (v.reviewNote || openComments.length > 0) && (
                <div className="mt-2 ml-1 space-y-1.5">
                  {v.reviewNote && (
                    <p className="text-xs text-orange-200/90 whitespace-pre-wrap rounded bg-orange-500/10 border border-orange-500/20 px-2 py-1.5">
                      {v.reviewNote}
                    </p>
                  )}
                  {openComments.length > 0 && (
                    <ul className="space-y-0.5">
                      {openComments.map((c) => (
                        <li key={c.id} className="flex gap-2 text-xs text-slate-300">
                          {c.timecodeSeconds != null && (
                            <span className="font-mono text-orange-400 flex-shrink-0">{formatTimecode(c.timecodeSeconds)}</span>
                          )}
                          <span className="whitespace-pre-wrap">{c.body}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const getInsightForAssignment = (assignmentId: string): AdInsight | undefined => {
    return insights.find((i) => i.assignmentId === assignmentId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <ClipboardList className="h-6 w-6 text-cyan-400" />
            My Assignments
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Your assigned video and graphic tasks</p>
        </div>
        <button
          onClick={() => { fetchAssignments(); fetchInsights(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Tasks", value: activeCount, icon: FileText, glow: "glow-cyan", iconBg: "bg-cyan-500/10", iconColor: "text-cyan-400" },
          { label: "In Progress", value: inProgressCount, icon: Timer, glow: "glow-amber", iconBg: "bg-amber-500/10", iconColor: "text-amber-400" },
          { label: "Need Revision", value: revisionCount, icon: AlertCircle, glow: "glow-purple", iconBg: "bg-orange-500/10", iconColor: "text-orange-400" },
          { label: "In Review", value: inReviewCount, icon: CheckCircle, glow: "glow-green", iconBg: "bg-purple-500/10", iconColor: "text-purple-400" },
        ].map((stat) => (
          <div key={stat.label} className={cn("rounded-xl border bg-[#111827] p-4", stat.glow)}>
            <div className="flex items-center gap-3">
              <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", stat.iconBg)}>
                <stat.icon className={cn("h-5 w-5", stat.iconColor)} />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-slate-500">{stat.label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex rounded-lg border border-white/10 overflow-hidden w-fit">
        {(
          [
            { value: "active", label: "Active" },
            { value: "review", label: "In Review" },
            { value: "all", label: "All" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium transition-all",
              filter === tab.value
                ? "bg-cyan-500/20 text-cyan-400"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0 && uploadingId === null && expandedId) {
            handleUpload(expandedId, files);
          }
          e.target.value = "";
        }}
      />

      {/* Video Length Modal */}
      {videoLengthModalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setVideoLengthModalId(null)} />
          <div className="relative bg-[#111827] border border-white/10 rounded-xl p-6 w-full max-w-sm mx-4 shadow-2xl">
            <button
              onClick={() => setVideoLengthModalId(null)}
              className="absolute top-4 right-4 text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                <Video className="h-5 w-5 text-cyan-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Enter Video Length</h3>
                <p className="text-xs text-slate-500">Required before submitting for review</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">
                  Video Length (seconds)
                </label>
                <input
                  type="number"
                  min="1"
                  value={videoLengthInput}
                  onChange={(e) => setVideoLengthInput(e.target.value)}
                  placeholder="e.g. 45"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder:text-slate-600 focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition-all"
                />
                {videoLengthInput && parseInt(videoLengthInput) > 0 && (
                  <p className="text-xs text-slate-500 mt-1.5">
                    Duration: {Math.floor(parseInt(videoLengthInput) / 60)}m {parseInt(videoLengthInput) % 60}s
                  </p>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setVideoLengthModalId(null)}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmComplete}
                  disabled={!videoLengthInput || parseInt(videoLengthInput) <= 0 || completingId !== null}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-sm font-medium text-white hover:from-emerald-400 hover:to-emerald-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {completingId ? "Submitting..." : "Submit for Review"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assignments list */}
      <div className="space-y-3">
        {sortedAssignments.length === 0 ? (
          <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
            <FileText className="h-12 w-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white">No assignments</h3>
            <p className="text-slate-500 mt-1">
              {filter === "active"
                ? "You don't have any active assignments right now"
                : filter === "review"
                  ? "No assignments waiting for review"
                  : "No assignments found"}
            </p>
          </div>
        ) : (
          sortedAssignments.map((assignment) => {
            const isExpanded = expandedId === assignment.id;
            const formatName = assignment.format?.name?.toUpperCase() || "";
            const FormatIcon = FORMAT_ICONS[formatName] || FileText;
            const statusConfig = STATUS_CONFIG[assignment.status as AssignmentStatus];
            const canStart = assignment.status === "READY_FOR_EDITING" || assignment.status === "REVISION";
            const canComplete = assignment.status === "EDITING_NOW";
            const canUpload = assignment.status === "EDITING_NOW" || assignment.status === "REVISION";

            return (
              <div key={assignment.id} className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
                {/* Main row */}
                <div
                  className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : assignment.id)}
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 bg-white/5 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FormatIcon className="h-5 w-5 text-slate-400" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white truncate">
                          {assignment.autoName || assignment.title}
                        </h3>
                        {assignment.priority === "URGENT" && <Flag className="h-4 w-4 text-red-400 flex-shrink-0" />}
                        {assignment.priority === "HIGH" && <Flag className="h-4 w-4 text-orange-400 flex-shrink-0" />}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                        {assignment.format && <span>{assignment.format.name}</span>}
                        {assignment.angle && (
                          <>
                            <span className="text-slate-700">|</span>
                            <span>{assignment.angle.name}</span>
                          </>
                        )}
                        {assignment.dueDate && (
                          <>
                            <span className="text-slate-700">|</span>
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {new Date(assignment.dueDate).toLocaleDateString("sv-SE")}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Deliverable indicator */}
                    {assignment.deliverableUrl && (
                      <div className="flex items-center gap-1 text-emerald-400 flex-shrink-0" title="Video uploaded">
                        <FileVideo className="h-4 w-4" />
                      </div>
                    )}

                    {statusConfig && (
                      <Badge variant="outline" className={cn(statusConfig.bgClass, statusConfig.color, "flex-shrink-0")}>
                        {statusConfig.label}
                      </Badge>
                    )}

                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-slate-500 flex-shrink-0" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-slate-500 flex-shrink-0" />
                    )}
                  </div>
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-white/5 p-4 bg-white/[0.01]">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* Left — Details */}
                      <div className="space-y-4">
                        <div>
                          <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Details</h4>
                          <div className="rounded-lg border border-white/5 bg-[#0d1220] p-3 space-y-2 text-sm">
                            {[
                              { label: "Batch", value: assignment.batchNumber },
                              { label: "Version", value: `V${assignment.version}` },
                              ...(assignment.country ? [{ label: "Country", value: assignment.country.name }] : []),
                              ...(assignment.product ? [{ label: "Product", value: assignment.product.name }] : []),
                              ...(assignment.offerType ? [{ label: "Offer Type", value: assignment.offerType.name }] : []),
                              ...(assignment.estimatedMinutes ? [{ label: "Estimated Time", value: `${assignment.estimatedMinutes} min` }] : []),
                              ...(assignment.totalTrackedSeconds > 0 ? [{ label: "Tracked", value: formatDuration(assignment.totalTrackedSeconds) }] : []),
                            ].map((row) => (
                              <div key={row.label} className="flex justify-between">
                                <span className="text-slate-500">{row.label}</span>
                                <span className="font-medium text-slate-300">{row.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {assignment.status === "REVISION" && assignment.revisionFeedback && (
                          <div>
                            <h4 className="text-xs font-medium text-orange-400 uppercase tracking-wider mb-2">Revision Feedback</h4>
                            <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                              <p className="text-sm text-slate-300 whitespace-pre-wrap">{assignment.revisionFeedback}</p>
                            </div>
                          </div>
                        )}

                        {assignment.strategistNotes && (
                          <div>
                            <h4 className="text-xs font-medium text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <StickyNote className="h-3.5 w-3.5" />
                              Strategist Notes
                            </h4>
                            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
                              <p className="text-sm text-slate-300 whitespace-pre-wrap">{assignment.strategistNotes}</p>
                            </div>
                          </div>
                        )}

                        {assignment.description && (
                          <div>
                            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Description</h4>
                            <p className="text-sm text-slate-400 bg-white/[0.02] rounded-lg p-3">{assignment.description}</p>
                          </div>
                        )}

                        {/* Files */}
                        {(canUpload || (versionsByAssignment[assignment.id]?.length ?? 0) > 0 || assignment.deliverableUrl) && (
                          <div>
                            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                              {canUpload ? "Upload Deliverable" : "Files"}
                            </h4>
                            <div className="rounded-lg border border-white/5 bg-[#0d1220] p-3 space-y-3">
                              {(versionsByAssignment[assignment.id]?.length ?? 0) > 0 && (
                                <div className="flex items-center gap-2 text-sm">
                                  <FileVideo className="h-4 w-4 text-emerald-400" />
                                  <span className="text-emerald-400 font-medium">
                                    {versionsByAssignment[assignment.id].length} file{versionsByAssignment[assignment.id].length !== 1 ? "s" : ""}
                                  </span>
                                  {versionsByAssignment[assignment.id].some((v) => v.reviewStatus === "needs_review") && (
                                    <span className="text-xs text-orange-400 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />
                                      {versionsByAssignment[assignment.id].filter((v) => v.reviewStatus === "needs_review").length} need revision
                                    </span>
                                  )}
                                  {!canUpload && (
                                    <Link
                                      href={`/review/${assignment.id}`}
                                      className="ml-auto inline-flex items-center gap-1 text-xs text-cyan-400 hover:underline"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Eye className="h-3 w-3" /> Review
                                    </Link>
                                  )}
                                </div>
                              )}
                              {renderFileList(assignment, canUpload)}

                              {revisionDoneIds.has(assignment.id) && !(versionsByAssignment[assignment.id] ?? []).some((v) => v.reviewStatus === "needs_review") && (
                                <p className="flex items-center gap-1.5 text-xs text-emerald-400 rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-1.5">
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  All revisions uploaded – send to review
                                </p>
                              )}

                              {canUpload && uploadingId === assignment.id && (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-sm text-cyan-400">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {uploadQueue && uploadQueue.total > 1
                                      ? `Uploading file ${uploadQueue.current} of ${uploadQueue.total}...`
                                      : "Uploading..."}
                                  </div>
                                  <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-300 rounded-full"
                                      style={{ width: `${uploadProgress}%` }}
                                    />
                                  </div>
                                  <p className="text-xs text-slate-500">{uploadProgress}%</p>
                                </div>
                              )}

                              {/* Revision: confirm which flagged file each upload replaces */}
                              {canUpload && pendingUpload?.assignmentId === assignment.id && uploadingId === null && (
                                <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2" onClick={(e) => e.stopPropagation()}>
                                  <p className="text-xs text-orange-300 font-medium">Which file does each upload replace? The old file is deleted.</p>
                                  {pendingUpload.files.map((file, i) => {
                                    const flagged = (versionsByAssignment[assignment.id] ?? []).filter((v) => v.reviewStatus === "needs_review");
                                    return (
                                      <div key={`${file.name}-${i}`} className="flex items-center gap-2 text-xs">
                                        <span className="truncate text-slate-300 flex-1 min-w-0" title={file.name}>{file.name}</span>
                                        <span className="text-slate-600 flex-shrink-0">→</span>
                                        <select
                                          value={pendingUpload.replaces[i] ?? ""}
                                          onChange={(e) => {
                                            const value = e.target.value;
                                            setPendingUpload((prev) => prev ? { ...prev, replaces: { ...prev.replaces, [i]: value } } : prev);
                                          }}
                                          className="max-w-[55%] px-2 py-1 rounded bg-white/5 border border-white/10 text-slate-200 focus:border-cyan-500/50 focus:outline-none"
                                        >
                                          <option value="">New file</option>
                                          {flagged.map((v) => (
                                            <option key={v.id} value={v.id}>
                                              Replaces {v.hookLabel ?? "—"} · {v.filename}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                    );
                                  })}
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={confirmPendingUpload}
                                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-xs font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all"
                                    >
                                      <Upload className="h-3.5 w-3.5" />
                                      Upload {pendingUpload.files.length} file{pendingUpload.files.length !== 1 ? "s" : ""}
                                    </button>
                                    <button
                                      onClick={() => setPendingUpload(null)}
                                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 transition-all"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}

                              {canUpload && uploadingId !== assignment.id && pendingUpload?.assignmentId !== assignment.id && (
                                <div className="space-y-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      fileInputRef.current?.click();
                                    }}
                                    disabled={uploadingId !== null}
                                    className="flex items-center gap-2 px-3 py-2 w-full rounded-lg border-2 border-dashed border-white/10 text-sm text-slate-400 hover:border-cyan-500/30 hover:text-cyan-400 hover:bg-cyan-500/5 transition-all disabled:opacity-50"
                                  >
                                    <Upload className="h-4 w-4" />
                                    {(versionsByAssignment[assignment.id]?.length ?? 0) > 0 || assignment.deliverableUrl
                                      ? "Upload More Files"
                                      : "Upload Files"}
                                  </button>
                                  <p className="text-[11px] text-slate-600">
                                    You can select multiple files at once. Name files H1 …, H2 … so a revision replaces the right file.
                                  </p>
                                </div>
                              )}

                              {actionError[assignment.id] && (
                                <p className="flex items-start gap-1.5 text-xs text-red-400 rounded bg-red-500/10 border border-red-500/20 px-2 py-1.5">
                                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                                  <span>{actionError[assignment.id]}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right — Script OR Performance */}
                      <div>
                        {assignment.scriptContent && (
                          <div>
                            <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Script</h4>
                            <div className="rounded-lg border border-white/5 overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-white/5">
                                    <th className="px-3 py-2 text-left text-slate-500 font-medium">Section</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-medium">English</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-medium">Swedish</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(assignment.scriptContent as ScriptContent).hooks?.map((hook, index) => (
                                    <tr key={index} className="border-b border-white/5">
                                      <td className="px-3 py-2 font-medium text-slate-300">H{index + 1}</td>
                                      <td className="px-3 py-2 text-slate-400">{hook.eng || "-"}</td>
                                      <td className="px-3 py-2 text-slate-400">{hook.se || "-"}</td>
                                    </tr>
                                  ))}
                                  {(assignment.scriptContent as ScriptContent).body && (
                                    <tr>
                                      <td className="px-3 py-2 font-medium text-slate-300">Body</td>
                                      <td className="px-3 py-2 text-slate-400">{(assignment.scriptContent as ScriptContent).body.eng || "-"}</td>
                                      <td className="px-3 py-2 text-slate-400">{(assignment.scriptContent as ScriptContent).body.se || "-"}</td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="mt-4 pt-4 border-t border-white/5 flex gap-3">
                      {canStart && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStartWorking(assignment); }}
                          disabled={startingId === assignment.id}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all disabled:opacity-50"
                        >
                          <Play className="h-4 w-4" />
                          {assignment.status === "REVISION" ? "Start Revision" : "Start Working"}
                        </button>
                      )}
                      {canComplete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMarkComplete(assignment); }}
                          disabled={completingId === assignment.id}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Mark Ready for Review
                        </button>
                      )}
                      {assignment.status === "READY_FOR_REVIEW" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTakeBack(assignment); }}
                          disabled={takingBackId === assignment.id}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm font-medium text-amber-400 hover:bg-amber-500/20 transition-all disabled:opacity-50"
                        >
                          <Undo2 className="h-4 w-4" />
                          Take Back
                        </button>
                      )}
                      {assignment.status === "EDITING_NOW" && (
                        <div className="flex items-center gap-2 text-amber-400">
                          <Clock className="h-4 w-4 animate-pulse" />
                          <span className="text-sm font-medium">Currently working on this</span>
                        </div>
                      )}
                      {actionError[assignment.id] && !canUpload && (versionsByAssignment[assignment.id]?.length ?? 0) === 0 && !assignment.deliverableUrl && (
                        <p className="flex items-center gap-1.5 text-xs text-red-400">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {actionError[assignment.id]}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
