"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  AlertTriangle,
  Upload,
  Share2,
  FileVideo,
  FileImage,
  HardDrive,
  Clock,
  User,
  Layers,
  Columns,
  Send,
  Rocket,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VersionStack } from "@/components/review/version-stack";
import type {
  ReviewAssignment,
  DeliverableVersion,
  ReviewStatus,
} from "@/lib/review-types";
import { formatTimeSimple, fileLabel } from "@/lib/review-types";

const ASSIGNMENT_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bgClass: string }
> = {
  READY_FOR_EDITING: {
    label: "Ready for Editing",
    color: "text-blue-400",
    bgClass: "bg-blue-500/10 border-blue-500/20",
  },
  EDITING_NOW: {
    label: "Editing Now",
    color: "text-yellow-400",
    bgClass: "bg-yellow-500/10 border-yellow-500/20",
  },
  READY_FOR_REVIEW: {
    label: "Review",
    color: "text-purple-400",
    bgClass: "bg-purple-500/10 border-purple-500/20",
  },
  REVISION: {
    label: "Revision",
    color: "text-red-400",
    bgClass: "bg-red-500/10 border-red-500/20",
  },
  READY_FOR_POSTING: {
    label: "Ready",
    color: "text-emerald-400",
    bgClass: "bg-emerald-500/10 border-emerald-500/20",
  },
  POSTED: {
    label: "Posted",
    color: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/20",
  },
};

const PRIORITY_CONFIG: Record<
  string,
  { label: string; color: string; bgClass: string }
> = {
  URGENT: {
    label: "Urgent",
    color: "text-red-400",
    bgClass: "bg-red-500/10 border-red-500/20",
  },
  HIGH: {
    label: "High",
    color: "text-orange-400",
    bgClass: "bg-orange-500/10 border-orange-500/20",
  },
  MEDIUM: {
    label: "Medium",
    color: "text-blue-400",
    bgClass: "bg-blue-500/10 border-blue-500/20",
  },
  LOW: {
    label: "Low",
    color: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/20",
  },
};

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "Unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

interface ReviewSidebarProps {
  assignment: ReviewAssignment;
  versions: DeliverableVersion[];
  currentVersion: DeliverableVersion | null;
  onVersionSelect: (versionId: string) => void;
  /** File-level: approve / request revision (with a note) on the selected file. */
  onStatusChange: (status: ReviewStatus, note?: string | null) => void | Promise<void>;
  /** Assignment-level: send the revision to the editor, or mark ready for upload. */
  onAssignmentStatusChange?: (status: "REVISION" | "READY_FOR_POSTING", feedback?: string) => void | Promise<void>;
  onUploadNew?: () => void;
  onShareLink?: () => void;
  onCompare?: () => void;
}

export function ReviewSidebar({
  assignment,
  versions,
  currentVersion,
  onVersionSelect,
  onStatusChange,
  onAssignmentStatusChange,
  onUploadNew,
  onShareLink,
  onCompare,
}: ReviewSidebarProps) {
  // Inline note for "Request revision" on the selected file (no window.prompt).
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setNoteOpen(false);
    setNote(currentVersion?.reviewNote ?? "");
  }, [currentVersion?.id, currentVersion?.reviewNote]);

  const flagged = versions.filter((v) => v.reviewStatus === "needs_review");
  const pending = versions.filter((v) => v.reviewStatus === "no_status" || v.reviewStatus === "in_progress");
  const approved = versions.filter((v) => v.reviewStatus === "approved");
  const reviewing = ["READY_FOR_REVIEW", "REVISION", "EDITING_NOW"].includes(assignment.status);

  const run = async (key: string, fn: () => void | Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };
  const statusConfig = ASSIGNMENT_STATUS_CONFIG[assignment.status] || {
    label: assignment.status,
    color: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/20",
  };
  const priorityConfig = PRIORITY_CONFIG[assignment.priority] || {
    label: assignment.priority,
    color: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/20",
  };

  const isVideo = currentVersion?.contentType?.startsWith("video/");
  const FileIcon = isVideo ? FileVideo : FileImage;
  const overdue = isOverdue(assignment.dueDate) && !["POSTED", "READY_FOR_POSTING"].includes(assignment.status);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Assignment header */}
        <div>
          <div className="flex items-center gap-2">
            {/* File type icon */}
            <FileIcon className="h-4 w-4 text-slate-500 flex-shrink-0" />
            <h2 className="text-sm font-semibold text-slate-200 leading-tight truncate">
              {assignment.autoName || assignment.title}
            </h2>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-500">
            <Layers className="h-3 w-3" />
            Batch {assignment.batchNumber}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                statusConfig.bgClass,
                statusConfig.color
              )}
            >
              {statusConfig.label}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                priorityConfig.bgClass,
                priorityConfig.color
              )}
            >
              {priorityConfig.label}
            </Badge>
          </div>
        </div>

        <Separator className="bg-white/5" />

        {/* Version Stack */}
        <div>
          <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-2">
            Files
          </h3>
          {currentVersion && (
            <VersionStack
              versions={versions}
              currentVersionId={currentVersion.id}
              onVersionSelect={onVersionSelect}
              onUploadNew={onUploadNew}
            />
          )}
        </div>

        <Separator className="bg-white/5" />

        {/* File info */}
        {currentVersion && (
          <div>
            <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-2">
              File Info
            </h3>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2 text-slate-400">
                <FileIcon className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-slate-300 truncate text-xs">
                  {currentVersion.filename}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <HardDrive className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-slate-300 text-xs">
                  {formatFileSize(currentVersion.fileSize)}
                </span>
              </div>
              {currentVersion.width && currentVersion.height && (
                <div className="flex items-center gap-2 text-slate-400">
                  <FileImage className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-slate-300 text-xs">
                    {currentVersion.width} x {currentVersion.height}
                  </span>
                </div>
              )}
              {currentVersion.duration != null && (
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-slate-300 text-xs">
                    {formatTimeSimple(currentVersion.duration)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <Separator className="bg-white/5" />

        {/* This file: approve or request revision (with a note) */}
        <div>
          <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-3">
            {currentVersion ? `This file · ${fileLabel(currentVersion)}` : "This file"}
          </h3>
          {currentVersion?.reviewNote && currentVersion.reviewStatus === "needs_review" && !noteOpen && (
            <div className="mb-2 rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5">
              <p className="text-[10px] font-medium text-orange-400 uppercase tracking-wide mb-1">Revision note</p>
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{currentVersion.reviewNote}</p>
            </div>
          )}
          <div className="space-y-2">
            <Button
              size="sm"
              disabled={!currentVersion || busy !== null || currentVersion.reviewStatus === "approved"}
              onClick={() => run("approve", () => onStatusChange("approved"))}
              className="w-full h-9 bg-green-600 hover:bg-green-700 text-white text-xs justify-start font-medium shadow-sm shadow-green-900/20"
            >
              {busy === "approve" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              {currentVersion?.reviewStatus === "approved" ? "Approved" : "Approve file"}
            </Button>
            {!noteOpen ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!currentVersion || busy !== null}
                onClick={() => setNoteOpen(true)}
                className="w-full h-9 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10 justify-start font-medium"
              >
                <AlertTriangle className="h-4 w-4 mr-2" />
                {currentVersion?.reviewStatus === "needs_review" ? "Edit revision note" : "Request revision"}
              </Button>
            ) : (
              <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2 space-y-2">
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What should change? Timecoded comments on this file are sent along automatically."
                  className="min-h-[72px] text-xs bg-[#0d1220] border-white/10"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => run("flag", async () => { await onStatusChange("needs_review", note.trim() || null); setNoteOpen(false); })}
                    className="h-8 flex-1 text-xs bg-orange-600 hover:bg-orange-700 text-white"
                  >
                    {busy === "flag" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />}
                    Flag for revision
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => { setNoteOpen(false); setNote(currentVersion?.reviewNote ?? ""); }} className="h-8 text-xs text-slate-400">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {currentVersion?.reviewStatus === "needs_review" && !noteOpen && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => run("clear", () => onStatusChange("no_status", null))}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline-offset-2 hover:underline"
              >
                Clear flag
              </button>
            )}
          </div>
        </div>

        <Separator className="bg-white/5" />

        {/* The assignment: send revision / ready for upload */}
        {onAssignmentStatusChange && (
          <div>
            <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-2">
              Assignment
            </h3>
            <div className="flex items-center gap-1.5 mb-2 text-[11px] text-slate-500">
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusConfig.bgClass, statusConfig.color)}>{statusConfig.label}</Badge>
              <span>{approved.length} approved · {pending.length} pending · {flagged.length} flagged</span>
            </div>
            {reviewing ? (
              <div className="space-y-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={flagged.length === 0 || busy !== null}
                  onClick={() => run("revision", () => onAssignmentStatusChange("REVISION"))}
                  className="w-full h-9 text-xs border-orange-500/30 text-orange-400 hover:bg-orange-500/10 justify-start font-medium disabled:opacity-40"
                >
                  {busy === "revision" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  Send revision ({flagged.length} flagged)
                </Button>
                <Button
                  size="sm"
                  disabled={flagged.length > 0 || versions.length === 0 || busy !== null}
                  onClick={() => run("ready", () => onAssignmentStatusChange("READY_FOR_POSTING"))}
                  className="w-full h-9 text-xs bg-emerald-600 hover:bg-emerald-700 text-white justify-start font-medium disabled:opacity-40"
                >
                  {busy === "ready" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
                  All approved → Ready for upload
                </Button>
                <p className="text-[11px] text-slate-500">
                  {flagged.length > 0
                    ? `${flagged.map((v) => v.hookLabel ?? v.filename).join(", ")} must be fixed or cleared before the assignment can be ready.`
                    : pending.length > 0
                      ? `${pending.length} pending file${pending.length === 1 ? "" : "s"} will be approved with it.`
                      : versions.length === 0
                        ? "No files uploaded yet."
                        : "Every file is approved."}
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">
                {assignment.status === "READY_FOR_POSTING"
                  ? "Ready — upload to Meta from the assignment."
                  : assignment.status === "POSTED"
                    ? "Uploaded to Meta."
                    : "Waiting for the editor to upload."}
              </p>
            )}
          </div>
        )}

        <Separator className="bg-white/5" />

        {/* More */}
        <div>
          <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-3">
            More
          </h3>
          <div className="space-y-2">
            <div className="space-y-1.5">
              {onUploadNew && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onUploadNew}
                  className="w-full h-8 text-xs text-slate-300 hover:bg-white/5 justify-start"
                >
                  <Upload className="h-3.5 w-3.5 mr-2" />
                  Upload file
                </Button>
              )}
              {onCompare && versions.length >= 2 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCompare}
                  className="w-full h-8 text-xs text-slate-300 hover:bg-white/5 justify-start"
                >
                  <Columns className="h-3.5 w-3.5 mr-2" />
                  Compare files
                </Button>
              )}
              {onShareLink && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onShareLink}
                  className="w-full h-8 text-xs text-slate-300 hover:bg-white/5 justify-start"
                >
                  <Share2 className="h-3.5 w-3.5 mr-2" />
                  Share Link
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Assignment details */}
        <Separator className="bg-white/5" />
        <div>
          <h3 className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-2">
            Details
          </h3>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-slate-400">
              <User className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="text-slate-300">
                {assignment.assignedTo.name}
              </span>
            </div>
            {assignment.format && (
              <div className="flex items-center gap-2 text-slate-400">
                <FileVideo className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-slate-300">{assignment.format.name}</span>
              </div>
            )}
            {assignment.product && (
              <div className="flex items-center gap-2 text-slate-400">
                <Layers className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-slate-300">
                  {assignment.product.name}
                </span>
              </div>
            )}
            {assignment.dueDate && (
              <div className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                <span
                  className={cn(
                    overdue ? "text-red-400 font-medium" : "text-slate-300"
                  )}
                >
                  Due {new Date(assignment.dueDate).toLocaleDateString("sv-SE")}
                  {overdue && " (overdue)"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
