"use client";

import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Edit2,
  Calendar,
  Clock,
  User,
  Video,
  Target,
  Globe,
  FileText,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  Trash2,
  Eye,
  Upload,
  Loader2,
  FlaskConical,
} from "lucide-react";
import Link from "next/link";
import { AssignmentPerformance } from "@/components/assignments/assignment-performance";
import { AWARENESS_LEVELS } from "@/components/learning-loop/format";
import { cn } from "@/lib/utils";
import {
  STATUS_CONFIG,
  PRIORITY_CONFIG,
  formatDuration,
  type EditorAssignment,
  type AssignmentStatus,
  type ScriptContent,
} from "@/components/assignments/assignment-card";

const COUNTRY_FLAGS: Record<string, string> = {
  SE: "\u{1F1F8}\u{1F1EA}",
  NO: "\u{1F1F3}\u{1F1F4}",
  DK: "\u{1F1E9}\u{1F1F0}",
  FI: "\u{1F1EB}\u{1F1EE}",
  DE: "\u{1F1E9}\u{1F1EA}",
  UK: "\u{1F1EC}\u{1F1E7}",
  US: "\u{1F1FA}\u{1F1F8}",
};

interface AssignmentDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignment: EditorAssignment;
  onEdit: () => void;
  onStatusChange: (status: AssignmentStatus, feedback?: string) => void;
  onUpdateNotes?: (notes: string) => void;
  onDelete?: () => void;
  isAdmin?: boolean;
  onUploadComplete?: () => void;
}

export function AssignmentDetail({
  open,
  onOpenChange,
  assignment,
  onEdit,
  onStatusChange,
  onUpdateNotes,
  onDelete,
  isAdmin,
  onUploadComplete,
}: AssignmentDetailProps) {
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [strategistNotes, setStrategistNotes] = useState(assignment.strategistNotes || "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Admin upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadQueue, setUploadQueue] = useState<{ current: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All uploaded deliverable files (one row per file in deliverable_versions)
  const [deliverableFiles, setDeliverableFiles] = useState<Array<{
    id: string; filename: string; r2Url: string; versionNumber: number;
  }>>([]);

  const fetchDeliverableFiles = async () => {
    try {
      const res = await fetch(`/api/assignments/${assignment.id}/versions`);
      if (res.ok) setDeliverableFiles(await res.json());
    } catch { /* single deliverableUrl link still shows */ }
  };

  useEffect(() => {
    if (open && assignment.deliverableUrl) fetchDeliverableFiles();
    else if (open) setDeliverableFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assignment.id]);

  const uploadOne = async (file: File) => {
    const presignRes = await fetch("/api/upload/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
        assignmentId: assignment.id,
      }),
    });
    if (!presignRes.ok) {
      const err = await presignRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to get upload URL");
    }
    const { uploadUrl, publicUrl, key } = await presignRes.json();
    setUploadProgress(10);

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

    const saveRes = await fetch(`/api/assignments/${assignment.id}/deliverable`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deliverableUrl: publicUrl,
        deliverableR2Key: key,
        filename: file.name,
        contentType: file.type,
        fileSize: file.size,
      }),
    });
    if (!saveRes.ok) throw new Error("Failed to save deliverable");
    setUploadProgress(100);
  };

  const handleAdminUpload = async (files: File[]) => {
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        setUploadQueue({ current: i + 1, total: files.length });
        setUploadProgress(0);
        await uploadOne(files[i]);
      }
      await fetchDeliverableFiles();
      onUploadComplete?.();
    } catch (err) {
      console.error("Upload error:", err);
      alert(err instanceof Error ? err.message : "Upload failed");
      await fetchDeliverableFiles();
    } finally {
      setUploading(false);
      setUploadQueue(null);
      setUploadProgress(0);
    }
  };

  const status = STATUS_CONFIG[assignment.status];
  const StatusIcon = status.icon;
  const priority = PRIORITY_CONFIG[assignment.priority];
  const script = assignment.scriptContent as ScriptContent | null;
  const countryFlag = assignment.country?.code
    ? COUNTRY_FLAGS[assignment.country.code] || ""
    : "";

  const handleSendToRevision = () => {
    if (revisionFeedback.trim()) {
      onStatusChange("REVISION", revisionFeedback);
      setShowRevisionModal(false);
      setRevisionFeedback("");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  {countryFlag} {assignment.title}
                </DialogTitle>
                {assignment.autoName && (
                  <p className="text-sm text-muted-foreground font-mono mt-1">
                    {assignment.autoName}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={onEdit}>
                  <Edit2 className="h-4 w-4" />
                </Button>
                {onDelete && (
                  <Button variant="outline" size="icon" className="text-red-400 hover:text-red-300 hover:border-red-500/30" onClick={() => setShowDeleteConfirm(true)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[70vh]">
            <div className="px-6 pb-6 space-y-5">
              {/* Status & Priority */}
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={cn("flex items-center gap-1.5", status.bgClass, status.color)}
                >
                  <StatusIcon className="h-3.5 w-3.5" />
                  {status.label}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(priority.bgClass, priority.color)}
                >
                  {priority.label} Priority
                </Badge>
              </div>

              {/* Quick Actions */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {assignment.status === "READY_FOR_REVIEW" && (
                    <>
                      <Button
                        size="sm"
                        className="bg-green-600 hover:bg-green-700"
                        onClick={() => onStatusChange("READY_FOR_POSTING")}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowRevisionModal(true)}
                      >
                        <AlertTriangle className="h-4 w-4 mr-1" />
                        Send to Revision
                      </Button>
                    </>
                  )}
                  {assignment.status === "READY_FOR_POSTING" && (
                    <Button
                      size="sm"
                      onClick={() => onStatusChange("POSTED")}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Mark as Posted
                    </Button>
                  )}
                  <Select
                    value={assignment.status}
                    onValueChange={(v) => onStatusChange(v as AssignmentStatus)}
                  >
                    <SelectTrigger className="w-[200px] h-8 text-xs">
                      <SelectValue placeholder="Change status..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_CONFIG) as AssignmentStatus[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_CONFIG[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* Revision Feedback */}
              {assignment.status === "REVISION" && assignment.revisionFeedback && (
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-red-400 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4" />
                      Revision Feedback
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{assignment.revisionFeedback}</p>
                  </CardContent>
                </Card>
              )}

              {/* Strategist Notes */}
              <Card className="border-cyan-500/20 bg-cyan-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-cyan-400 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Creative Strategist Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={strategistNotes}
                    onChange={(e) => setStrategistNotes(e.target.value)}
                    rows={3}
                    placeholder="Add notes, thoughts, or creative direction..."
                    className="bg-transparent border-cyan-500/20 focus:border-cyan-500/40 resize-none"
                  />
                  {strategistNotes !== (assignment.strategistNotes || "") && (
                    <Button
                      size="sm"
                      className="mt-2 bg-cyan-600 hover:bg-cyan-700"
                      disabled={savingNotes}
                      onClick={async () => {
                        setSavingNotes(true);
                        try {
                          onUpdateNotes?.(strategistNotes);
                        } finally {
                          setSavingNotes(false);
                        }
                      }}
                    >
                      {savingNotes ? "Saving..." : "Save Notes"}
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Learning Loop — the test this brief IS */}
              {(assignment.hypothesis || assignment.variableTested || assignment.adType || assignment.awarenessLevel || assignment.problem) && (
                <Card className="border-violet-500/20 bg-violet-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-violet-300 flex items-center gap-2">
                      <FlaskConical className="h-4 w-4" />
                      Learning Loop · hypotes
                      {assignment.adType && (
                        <span className="ml-auto rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-normal text-violet-300">
                          {assignment.adType === "iteration" ? "Iteration" : "Ideation"}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {assignment.hypothesis && <p className="whitespace-pre-wrap text-slate-200">{assignment.hypothesis}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                      {assignment.variableTested && <span><span className="text-slate-500">Variabel:</span> {assignment.variableTested}</span>}
                      {assignment.problem && <span><span className="text-slate-500">Problem:</span> {assignment.problem.name}</span>}
                      {assignment.awarenessLevel && <span><span className="text-slate-500">Awareness:</span> {AWARENESS_LEVELS.find((l) => l.value === assignment.awarenessLevel)?.label ?? assignment.awarenessLevel}</span>}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Learning Loop — where it runs and how it does */}
              {["READY_FOR_POSTING", "POSTED"].includes(assignment.status) && (
                <AssignmentPerformance
                  assignmentId={assignment.id}
                  assignmentName={`#${assignment.batchNumber} ${assignment.autoName || assignment.title}`}
                  isAdmin={isAdmin}
                  isPosted={assignment.status === "POSTED"}
                />
              )}

              {/* Properties Grid */}
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Details
                  </h4>
                  {assignment.format && (
                    <div className="flex items-center gap-3 text-sm">
                      <Video className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Format:</span>
                      <span className="font-medium">{assignment.format.name}</span>
                    </div>
                  )}
                  {assignment.product && (
                    <div className="flex items-center gap-3 text-sm">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Product:</span>
                      <span className="font-medium">{assignment.product.name}</span>
                    </div>
                  )}
                  {assignment.angle && (
                    <div className="flex items-center gap-3 text-sm">
                      <Target className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Angle:</span>
                      <span className="font-medium">{assignment.angle.name}</span>
                    </div>
                  )}
                  {assignment.scriptStructure && (
                    <div className="flex items-center gap-3 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Script Structure:</span>
                      <span className="font-medium">{assignment.scriptStructure.name}</span>
                    </div>
                  )}
                  {assignment.offerType && (
                    <div className="flex items-center gap-3 text-sm">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Offer Type:</span>
                      <span className="font-medium">{assignment.offerType.name}</span>
                    </div>
                  )}
                  {assignment.landingPage && (
                    <div className="flex items-center gap-3 text-sm">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Landing Page:</span>
                      <span className="font-medium">{assignment.landingPage}</span>
                    </div>
                  )}
                  {assignment.customerAvatars?.length > 0 && (
                    <div className="flex items-center gap-3 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Avatars:</span>
                      <span className="font-medium">{assignment.customerAvatars.join(", ")}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Assignment
                  </h4>
                  <div className="flex items-center gap-3 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Editor:</span>
                    <span className="font-medium">{assignment.assignedTo.name}</span>
                  </div>
                  {(assignment.creativeStrategistName || assignment.creativeStrategist) && (
                    <div className="flex items-center gap-3 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Strategist:</span>
                      <span className="font-medium">{assignment.creativeStrategistName || assignment.creativeStrategist?.name}</span>
                    </div>
                  )}
                  {assignment.dueDate && (
                    <div className="flex items-center gap-3 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Due:</span>
                      <span className="font-medium">
                        {new Date(assignment.dueDate).toLocaleDateString("sv-SE")}
                      </span>
                    </div>
                  )}
                  {assignment.estimatedMinutes && (
                    <div className="flex items-center gap-3 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Estimated:</span>
                      <span className="font-medium">{assignment.estimatedMinutes} min</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Tracked:</span>
                    <span className="font-medium">
                      {assignment.totalTrackedSeconds > 0
                        ? formatDuration(assignment.totalTrackedSeconds)
                        : "Not started"}
                    </span>
                  </div>
                  {assignment.videoLengthSeconds && (
                    <div className="flex items-center gap-3 text-sm">
                      <Video className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Video Length:</span>
                      <span className="font-medium">{assignment.videoLengthSeconds}s</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Deliverable */}
              {(assignment.deliverableUrl || assignment.googleDriveLink) && (
                <Card className="border-blue-500/30 bg-blue-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-blue-400 flex items-center gap-2">
                      <FolderOpen className="h-4 w-4" />
                      Deliverable
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {assignment.deliverableUrl && (
                      <div className="space-y-2">
                        {deliverableFiles.length > 0 ? (
                          <div className="space-y-1">
                            {deliverableFiles.map((f) => (
                              <a
                                key={f.id}
                                href={f.r2Url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300 underline flex items-center gap-2 text-sm break-all"
                              >
                                {f.filename}
                                <ExternalLink className="h-3.5 w-3.5 flex-shrink-0" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <a
                            href={assignment.deliverableUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 hover:text-blue-300 underline flex items-center gap-2 text-sm break-all"
                          >
                            Uploaded file
                            <ExternalLink className="h-4 w-4 flex-shrink-0" />
                          </a>
                        )}
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/review/${assignment.id}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-all"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Open Review
                          </Link>
                          {isAdmin && (
                            <Link
                              href={`/upload?assignment=${assignment.id}`}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-all"
                            >
                              <Upload className="h-3.5 w-3.5" />
                              Send to Uploader{deliverableFiles.length > 1 ? ` (${deliverableFiles.length})` : ""}
                            </Link>
                          )}
                        </div>
                      </div>
                    )}
                    {assignment.googleDriveLink && (
                      <a
                        href={assignment.googleDriveLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline flex items-center gap-2 text-sm break-all"
                      >
                        {assignment.googleDriveLink}
                        <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      </a>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Admin Upload Section */}
              {isAdmin && (
                <Card className="border-cyan-500/20 bg-cyan-500/5">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-cyan-400 flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      Upload Video
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        if (files.length > 0 && !uploading) handleAdminUpload(files);
                        e.target.value = "";
                      }}
                    />
                    {uploading ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-cyan-400">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {uploadQueue && uploadQueue.total > 1
                            ? `Uploading video ${uploadQueue.current} of ${uploadQueue.total}...`
                            : "Uploading..."}
                        </div>
                        <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400 transition-all duration-300 rounded-full"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{uploadProgress}%</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          className="border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10"
                        >
                          <Upload className="h-4 w-4 mr-1.5" />
                          {assignment.deliverableUrl ? "Upload More Videos" : "Upload Videos"}
                        </Button>
                        <p className="text-[11px] text-muted-foreground">You can select multiple files at once</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Description */}
              {(assignment as { briefContent?: string | null }).briefContent && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Brief</h4>
                  <div className="text-sm bg-muted/50 rounded-lg p-3 whitespace-pre-wrap">
                    {(assignment as { briefContent?: string | null }).briefContent}
                  </div>
                </div>
              )}
              {((assignment as { references?: Array<{ id: string; value: string; note?: string }> }).references?.length ?? 0) > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">References</h4>
                  <div className="space-y-1">
                    {(assignment as { references?: Array<{ id: string; value: string; note?: string }> }).references!.map((ref) => (
                      <div key={ref.id} className="flex items-center gap-2 text-xs">
                        <a href={ref.value} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate max-w-[260px]">
                          {(ref as { kind?: string; label?: string }).kind === "file" ? `📎 ${(ref as { label?: string }).label || "File"}` : ref.value}
                        </a>
                        {ref.note && <span className="text-slate-500">— {ref.note}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {assignment.description && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Description
                  </h4>
                  <p className="text-sm bg-muted/50 rounded-lg p-3">{assignment.description}</p>
                </div>
              )}

              {/* Script Content */}
              {script &&
                (script.hooks.some((h) => h.eng || h.se) ||
                  script.body.eng ||
                  script.body.se) && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      Script
                    </h4>
                    <Card>
                      <CardContent className="p-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16"></TableHead>
                              <TableHead>English</TableHead>
                              <TableHead>Swedish</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {script.hooks.map(
                              (hook) =>
                                (hook.eng || hook.se) && (
                                  <TableRow key={hook.id}>
                                    <TableCell className="font-semibold text-muted-foreground">
                                      {hook.label}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {hook.eng || "-"}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                      {hook.se || "-"}
                                    </TableCell>
                                  </TableRow>
                                )
                            )}
                            {(script.body.eng || script.body.se) && (
                              <TableRow>
                                <TableCell className="font-semibold text-muted-foreground">
                                  Body
                                </TableCell>
                                <TableCell className="text-sm whitespace-pre-wrap">
                                  {script.body.eng || "-"}
                                </TableCell>
                                <TableCell className="text-sm whitespace-pre-wrap">
                                  {script.body.se || "-"}
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  </div>
                )}

              {/* Time Entries */}
              {assignment.timeEntries && assignment.timeEntries.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Work Sessions
                  </h4>
                  <Card>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {assignment.timeEntries.map((entry) => (
                            <TableRow key={entry.id}>
                              <TableCell className="text-sm">
                                {new Date(entry.startTime).toLocaleDateString("sv-SE")}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {entry.taskType}
                              </TableCell>
                              <TableCell className="text-sm text-right">
                                {entry.duration
                                  ? formatDuration(entry.duration)
                                  : "In progress"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Timestamps */}
              <div className="text-xs text-muted-foreground border-t border-border pt-4 space-y-1">
                <div>
                  Created: {new Date(assignment.createdAt).toLocaleString("sv-SE")}
                </div>
                {assignment.startedAt && (
                  <div>
                    Started: {new Date(assignment.startedAt).toLocaleString("sv-SE")}
                  </div>
                )}
                {assignment.completedAt && (
                  <div>
                    Completed: {new Date(assignment.completedAt).toLocaleString("sv-SE")}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="px-6 pb-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revision Feedback Modal */}
      <Dialog open={showRevisionModal} onOpenChange={setShowRevisionModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              Send to Revision
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Provide feedback for the editor about what needs to be fixed.
          </p>
          <Textarea
            value={revisionFeedback}
            onChange={(e) => setRevisionFeedback(e.target.value)}
            rows={4}
            placeholder="Describe what needs to be revised..."
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowRevisionModal(false);
                setRevisionFeedback("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSendToRevision}
              disabled={!revisionFeedback.trim()}
            >
              Send to Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-red-400" />
              Delete Assignment
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <span className="font-medium text-foreground">{assignment.autoName || assignment.title}</span>? This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  onDelete?.();
                  setShowDeleteConfirm(false);
                  onOpenChange(false);
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
