"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronDown,
  Upload,
  MessageSquare,
  CheckCircle2,
  Clock,
  AlertCircle,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fileLabel, hookOrder, type DeliverableVersion, type ReviewStatus } from "@/lib/review-types";
import { useState } from "react";

const STATUS_BADGE: Record<
  ReviewStatus,
  { label: string; color: string; bgClass: string; icon: React.ElementType }
> = {
  no_status: {
    label: "Pending",
    color: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/20",
    icon: Circle,
  },
  in_progress: {
    label: "In Progress",
    color: "text-yellow-400",
    bgClass: "bg-yellow-500/10 border-yellow-500/20",
    icon: Clock,
  },
  needs_review: {
    label: "Needs revision",
    color: "text-orange-400",
    bgClass: "bg-orange-500/10 border-orange-500/20",
    icon: AlertCircle,
  },
  approved: {
    label: "Approved",
    color: "text-green-400",
    bgClass: "bg-green-500/10 border-green-500/20",
    icon: CheckCircle2,
  },
};

interface VersionStackProps {
  versions: DeliverableVersion[];
  currentVersionId: string;
  onVersionSelect: (versionId: string) => void;
  onUploadNew?: () => void;
}

export function VersionStack({
  versions,
  currentVersionId,
  onVersionSelect,
  onUploadNew,
}: VersionStackProps) {
  const [expanded, setExpanded] = useState(false);

  // One row per file: H1, H2 … (a revision replaces its file, so the newest
  // version of each hook is the only one here).
  const sortedVersions = [...versions].sort(
    (a, b) => hookOrder(a.hookLabel) - hookOrder(b.hookLabel) || b.versionNumber - a.versionNumber
  );
  const currentVersion = sortedVersions.find((v) => v.id === currentVersionId);
  const currentLabel = currentVersion ? fileLabel(currentVersion) : "Select file";

  return (
    <div className="space-y-1">
      {/* Dropdown trigger */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-200">
            {currentLabel}
          </span>
          {currentVersion && (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] px-1 py-0",
                STATUS_BADGE[currentVersion.reviewStatus].bgClass,
                STATUS_BADGE[currentVersion.reviewStatus].color
              )}
            >
              {STATUS_BADGE[currentVersion.reviewStatus].label}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-slate-400 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded version list */}
      {expanded && (
        <div className="rounded-lg border border-white/10 bg-[#0f1629] overflow-hidden">
          <ScrollArea className="max-h-[240px]">
            <div className="divide-y divide-white/[0.03]">
              {sortedVersions.map((version) => {
                const status = STATUS_BADGE[version.reviewStatus];
                const StatusIcon = status.icon;
                const isActive = version.id === currentVersionId;

                return (
                  <button
                    key={version.id}
                    onClick={() => {
                      onVersionSelect(version.id);
                      setExpanded(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors",
                      isActive && "bg-cyan-500/5 border-l-2 border-l-cyan-500"
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "text-sm font-semibold",
                            isActive ? "text-cyan-400" : "text-slate-200"
                          )}
                        >
                          {fileLabel(version)}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] px-1 py-0",
                            status.bgClass,
                            status.color
                          )}
                        >
                          <StatusIcon className="h-2.5 w-2.5 mr-0.5" />
                          {status.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
                        {version.hookLabel && (
                          <span className="truncate max-w-[140px]" title={version.filename}>{version.filename}</span>
                        )}
                        <span>
                          {version.uploadedBy?.name || "Unknown"}
                        </span>
                        <span>
                          {new Date(version.createdAt).toLocaleDateString(
                            "sv-SE"
                          )}
                        </span>
                        {version.commentCount != null &&
                          version.commentCount > 0 && (
                            <span className="flex items-center gap-0.5">
                              <MessageSquare className="h-2.5 w-2.5" />
                              {version.commentCount}
                            </span>
                          )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          {onUploadNew && (
            <div className="border-t border-white/5 p-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onUploadNew();
                  setExpanded(false);
                }}
                className="w-full h-8 text-xs border-dashed border-white/10 text-slate-400 hover:text-cyan-400 hover:border-cyan-500/30"
              >
                <Upload className="h-3 w-3 mr-1.5" />
                Upload file
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
