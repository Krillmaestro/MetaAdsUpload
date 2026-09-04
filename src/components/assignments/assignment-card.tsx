"use client";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar,
  Clock,
  MoreVertical,
  Play,
  Eye,
  AlertTriangle,
  CheckCircle2,
  Target,
  MessageSquare,
  Video,
  Image,
  Rocket,
  Film,
  FileEdit,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

// --- Shared types ---
export type AssignmentStatus =
  | "DRAFT"
  | "READY_FOR_EDITING"
  | "EDITING_NOW"
  | "READY_FOR_REVIEW"
  | "REVISION"
  | "READY_FOR_POSTING"
  | "POSTED";

export type AssignmentPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface ScriptHook {
  id: string;
  label: string;
  eng: string;
  se: string;
}

export interface ScriptContent {
  hooks: ScriptHook[];
  body: { eng: string; se: string };
}

export interface EditorAssignment {
  id: string;
  title: string;
  description: string | null;
  batchNumber: number;
  version: number;
  formatId: string | null;
  format: { id: string; name: string } | null;
  angleId: string | null;
  angle: { id: string; name: string } | null;
  productId: string | null;
  product: { id: string; name: string; code: string } | null;
  countryId: string | null;
  country: { id: string; name: string; code: string } | null;
  offerTypeId: string | null;
  offerType: { id: string; name: string } | null;
  scriptStructureId: string | null;
  scriptStructure: { id: string; name: string } | null;
  customerAvatars: string[];
  landingPage: string | null;
  assignedToId: string;
  assignedTo: { id: string; name: string; email: string };
  assignedById: string;
  assignedBy: { id: string; name: string; email: string };
  creativeStrategistId: string | null;
  creativeStrategist: { id: string; name: string; email: string } | null;
  creativeStrategistName: string | null;
  status: AssignmentStatus;
  priority: AssignmentPriority;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  estimatedMinutes: number | null;
  videoLengthSeconds: number | null;
  googleDriveLink: string | null;
  scriptContent: ScriptContent | null;
  autoName: string | null;
  revisionFeedback: string | null;
  strategistNotes: string | null;
  deliverableUrl: string | null;
  deliverableR2Key: string | null;
  metaAdId: string | null;
  metaAdsetId: string | null;
  metaCampaignId: string | null;
  // Learning Loop
  problemId?: string | null;
  problem?: { id: string; name: string } | null;
  hypothesis?: string | null;
  variableTested?: string | null;
  adType?: string | null;
  iterationOfId?: string | null;
  awarenessLevel?: string | null;
  publishTemplateId?: number | null;
  linkedAdsets?: number;
  briefContent?: string | null;
  references?: Array<{ id: string; kind: "url" | "library" | "file"; value: string; label?: string; note?: string }>;
  totalTrackedSeconds: number;
  createdAt: string;
  updatedAt: string;
  timeEntries?: Array<{
    id: string;
    startTime: string;
    endTime: string | null;
    duration: number | null;
    taskType: string;
  }>;
}

export const STATUS_CONFIG: Record<
  AssignmentStatus,
  { label: string; color: string; bgClass: string; icon: React.ElementType }
> = {
  DRAFT: {
    label: "Draft",
    color: "text-cyan-400",
    bgClass: "bg-cyan-500/10 border-cyan-500/20",
    icon: FileEdit,
  },
  READY_FOR_EDITING: {
    label: "Ready for Editing",
    color: "text-blue-400",
    bgClass: "bg-blue-500/10 border-blue-500/20",
    icon: Play,
  },
  EDITING_NOW: {
    label: "Editing Now",
    color: "text-yellow-400",
    bgClass: "bg-yellow-500/10 border-yellow-500/20",
    icon: Clock,
  },
  READY_FOR_REVIEW: {
    label: "Ready for Review",
    color: "text-purple-400",
    bgClass: "bg-purple-500/10 border-purple-500/20",
    icon: Eye,
  },
  REVISION: {
    label: "Revision",
    color: "text-red-400",
    bgClass: "bg-red-500/10 border-red-500/20",
    icon: AlertTriangle,
  },
  READY_FOR_POSTING: {
    label: "Ready for Posting",
    color: "text-emerald-400",
    bgClass: "bg-emerald-500/10 border-emerald-500/20",
    icon: CheckCircle2,
  },
  POSTED: {
    label: "Posted",
    color: "text-slate-400",
    bgClass: "bg-slate-500/10 border-slate-500/20",
    icon: CheckCircle2,
  },
};

export const PRIORITY_CONFIG: Record<
  AssignmentPriority,
  { label: string; color: string; bgClass: string }
> = {
  URGENT: { label: "Urgent", color: "text-red-400", bgClass: "bg-red-500/10 border-red-500/20" },
  HIGH: { label: "High", color: "text-orange-400", bgClass: "bg-orange-500/10 border-orange-500/20" },
  MEDIUM: { label: "Medium", color: "text-blue-400", bgClass: "bg-blue-500/10 border-blue-500/20" },
  LOW: { label: "Low", color: "text-slate-400", bgClass: "bg-slate-500/10 border-slate-500/20" },
};

const COUNTRY_FLAGS: Record<string, string> = {
  SE: "\u{1F1F8}\u{1F1EA}",
  NO: "\u{1F1F3}\u{1F1F4}",
  DK: "\u{1F1E9}\u{1F1F0}",
  FI: "\u{1F1EB}\u{1F1EE}",
  DE: "\u{1F1E9}\u{1F1EA}",
  UK: "\u{1F1EC}\u{1F1E7}",
  US: "\u{1F1FA}\u{1F1F8}",
};

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

interface AssignmentCardProps {
  assignment: EditorAssignment;
  onClick: () => void;
  onStatusChange: (status: AssignmentStatus) => void;
  onPublish?: () => void;
}

export function AssignmentCard({ assignment, onClick, onStatusChange, onPublish }: AssignmentCardProps) {
  const router = useRouter();
  const priority = PRIORITY_CONFIG[assignment.priority];
  const isStatic = (assignment.format?.name ?? "").toUpperCase().includes("STATIC");
  const overdue =
    isOverdue(assignment.dueDate) &&
    !["POSTED", "READY_FOR_POSTING"].includes(assignment.status);
  const countryCode = assignment.country?.code;
  const countryFlag = countryCode ? COUNTRY_FLAGS[countryCode] || "" : "";

  return (
    <div
      className={cn(
        "rounded-lg border bg-[#0f1629] p-3 hover:bg-[#131b30] transition-all cursor-pointer group",
        overdue ? "border-red-500/30 bg-red-500/5" : "border-white/5"
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {countryFlag && <span className="text-base flex-shrink-0">{countryFlag}</span>}
          <h4 className="font-semibold text-sm text-slate-200 truncate">
            {assignment.autoName || assignment.title}
          </h4>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger>
            <button
              className="h-6 w-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white/10 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-3 w-3 text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-[#111827] border-white/10" onClick={(e) => e.stopPropagation()}>
            {assignment.deliverableUrl && (
              <DropdownMenuItem
                onClick={() => router.push(`/review/${assignment.id}`)}
                className="text-cyan-400 focus:text-cyan-400"
              >
                <Film className="h-4 w-4 mr-2" />
                Open Review
              </DropdownMenuItem>
            )}
            {assignment.status === "READY_FOR_POSTING" && onPublish && (
              <DropdownMenuItem
                onClick={onPublish}
                className="text-emerald-400 focus:text-emerald-400"
              >
                <Rocket className="h-4 w-4 mr-2" />
                Publish to Meta
              </DropdownMenuItem>
            )}
            {(Object.keys(STATUS_CONFIG) as AssignmentStatus[]).map((status) => {
              const config = STATUS_CONFIG[status];
              const Icon = config.icon;
              return (
                <DropdownMenuItem
                  key={status}
                  onClick={() => onStatusChange(status)}
                  className={cn(assignment.status === status && "bg-white/5")}
                >
                  <Icon className={cn("h-4 w-4 mr-2", config.color)} />
                  {config.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Format & Product */}
      <div className="flex items-center gap-2 mb-2 text-xs">
        {assignment.format && (
          <span className="flex items-center gap-1 text-slate-500">
            {isStatic ? <Image className="h-3 w-3" /> : <Video className="h-3 w-3" />}
            {assignment.format.name}
          </span>
        )}
        {assignment.product && (
          <>
            {assignment.format && <span className="text-slate-700">|</span>}
            <span className="text-slate-500">{assignment.product.name}</span>
          </>
        )}
      </div>

      {/* Angle */}
      {assignment.angle && (
        <div className="flex items-center gap-1 mb-2 text-xs text-slate-500">
          <Target className="h-3 w-3" />
          {assignment.angle.name}
        </div>
      )}

      {/* Assigned To */}
      <div className="flex items-center gap-2 mb-2">
        <div className="h-5 w-5 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-[10px] font-medium flex-shrink-0">
          {assignment.assignedTo.name.charAt(0)}
        </div>
        <span className="text-xs text-slate-500 truncate">{assignment.assignedTo.name}</span>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        {assignment.dueDate ? (
          <span
            className={cn(
              "flex items-center gap-1 text-xs",
              overdue ? "text-red-400 font-medium" : "text-slate-500"
            )}
          >
            <Calendar className="h-3 w-3" />
            {new Date(assignment.dueDate).toLocaleDateString("sv-SE")}
          </span>
        ) : (
          <span />
        )}
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", priority.bgClass, priority.color)}>
          {priority.label}
        </Badge>
      </div>

      {/* Learning Loop link state — only meaningful once the video is out */}
      {assignment.status === "POSTED" && (
        <div className={cn("mt-1.5 flex items-center gap-1 text-xs", (assignment.linkedAdsets ?? 0) > 0 ? "text-cyan-400/80" : "text-amber-400/80")}>
          <Target className="h-3 w-3" />
          {(assignment.linkedAdsets ?? 0) > 0
            ? `${assignment.linkedAdsets} ad set kopplade`
            : "Inget ad set kopplat"}
        </div>
      )}

      {/* Tracked Time */}
      {assignment.totalTrackedSeconds > 0 && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          {formatDuration(assignment.totalTrackedSeconds)} tracked
        </div>
      )}

      {/* Revision Feedback Indicator */}
      {assignment.status === "REVISION" && assignment.revisionFeedback && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
          <MessageSquare className="h-3 w-3" />
          Has feedback
        </div>
      )}
    </div>
  );
}
