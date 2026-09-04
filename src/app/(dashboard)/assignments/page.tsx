"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LayoutGrid,
  Plus,
  Search,
  X,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  AssignmentCard,
  STATUS_CONFIG,
  type EditorAssignment,
  type AssignmentStatus,
  type AssignmentPriority,
  formatDuration,
} from "@/components/assignments/assignment-card";
import { AssignmentModal } from "@/components/assignments/assignment-modal";
import { AssignmentDetail } from "@/components/assignments/assignment-detail";
import { UploadToMetaDialog } from "@/components/assignments/upload-to-meta-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface AssignmentBoard {
  DRAFT: EditorAssignment[];
  READY_FOR_EDITING: EditorAssignment[];
  EDITING_NOW: EditorAssignment[];
  READY_FOR_REVIEW: EditorAssignment[];
  REVISION: EditorAssignment[];
  READY_FOR_POSTING: EditorAssignment[];
  POSTED: EditorAssignment[];
}

interface AssignmentStats {
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
  avgTimeSeconds: number;
}

interface OptionItem {
  id: string;
  name: string;
  code?: string;
}

interface UserItem {
  id: string;
  name: string;
  email: string;
  role?: string;
}

// Kanban Column
function KanbanColumn({
  status,
  assignments,
  onCardClick,
  onStatusChange,
  onPublish,
}: {
  status: AssignmentStatus;
  assignments: EditorAssignment[];
  onCardClick: (a: EditorAssignment) => void;
  onStatusChange: (id: string, status: AssignmentStatus) => void;
  onPublish?: (a: EditorAssignment) => void;
}) {
  const config = STATUS_CONFIG[status];
  const StatusIcon = config.icon;

  return (
    <div className="flex-1 min-w-[280px] max-w-[320px]">
      <div className={cn("rounded-t-xl px-4 py-3 border", config.bgClass)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn("h-4 w-4", config.color)} />
            <h3 className={cn("text-sm font-semibold", config.color)}>{config.label}</h3>
          </div>
          <Badge variant="outline" className="text-xs bg-white/5 border-white/10 text-slate-400">
            {assignments.length}
          </Badge>
        </div>
      </div>
      <div className="bg-[#0d1220] rounded-b-xl p-2 min-h-[400px] space-y-2 border border-t-0 border-white/5">
        {assignments.map((assignment) => (
          <AssignmentCard
            key={assignment.id}
            assignment={assignment}
            onClick={() => onCardClick(assignment)}
            onStatusChange={(newStatus) => onStatusChange(assignment.id, newStatus)}
            onPublish={status === "READY_FOR_POSTING" && onPublish ? () => onPublish(assignment) : undefined}
          />
        ))}
        {assignments.length === 0 && (
          <div className="text-center py-8 text-slate-600 text-sm">
            No assignments
          </div>
        )}
      </div>
    </div>
  );
}

export default function AssignmentsPage() {
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [stats, setStats] = useState<AssignmentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [formats, setFormats] = useState<OptionItem[]>([]);

  const [filters, setFilters] = useState<{
    assignedToId?: string;
    formatId?: string;
    productId?: string;
    priority?: AssignmentPriority;
  }>({});
  const [searchQuery, setSearchQuery] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<EditorAssignment | null>(null);
  const [viewingAssignment, setViewingAssignment] = useState<EditorAssignment | null>(null);
  const [publishingAssignment, setPublishingAssignment] = useState<EditorAssignment | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.assignedToId) params.set("assignedToId", filters.assignedToId);
      if (filters.formatId) params.set("formatId", filters.formatId);
      if (filters.productId) params.set("productId", filters.productId);
      if (filters.priority) params.set("priority", filters.priority);

      const [boardRes, statsRes] = await Promise.all([
        fetch(`/api/assignments/board?${params}`),
        fetch("/api/assignments/stats"),
      ]);

      if (!boardRes.ok) throw new Error("Failed to fetch board");
      const boardData = await boardRes.json();
      setBoard(boardData);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    Promise.all([
      fetch("/api/users").then((r) => r.json()).catch(() => ({ users: [] })),
      fetch("/api/options").then((r) => r.json()).catch(() => ({ formats: [], products: [] })),
    ]).then(([usersData, optionsData]) => {
      setUsers(usersData.users || []);
      setFormats(optionsData.formats || []);
    });
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const editors = users.filter((u) => u.role === "editor" || u.role === "employee");

  const handleStatusChange = async (assignmentId: string, newStatus: AssignmentStatus) => {
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to update status");
      }
      fetchBoard();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  // Keep the open detail in sync after file reviews / uploads / status changes.
  const refreshViewing = async (id: string) => {
    try {
      const res = await fetch(`/api/assignments/${id}`);
      if (res.ok) setViewingAssignment(await res.json());
    } catch { /* board refresh still runs */ }
  };

  const createDraftAndOpen = async () => {
    setCreatingDraft(true);
    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDraft: true }),
      });
      if (!res.ok) throw new Error("Failed to create draft");
      const draft = await res.json();
      // Fetch the full enriched assignment so the modal gets all fields
      const detailRes = await fetch(`/api/assignments/${draft.id}`);
      if (!detailRes.ok) throw new Error("Failed to fetch draft");
      const enrichedDraft = await detailRes.json();
      setEditingAssignment(enrichedDraft);
      setShowCreateModal(true);
      fetchBoard();
    } catch (err) {
      console.error(err);
    } finally {
      setCreatingDraft(false);
    }
  };

  const handleCardClick = (assignment: EditorAssignment) => {
    // Draft assignments open directly in edit mode
    if (assignment.status === "DRAFT") {
      setEditingAssignment(assignment);
      setShowCreateModal(true);
    } else {
      setViewingAssignment(assignment);
    }
  };

  const filterBySearch = (assignments: EditorAssignment[]) => {
    if (!searchQuery) return assignments;
    const q = searchQuery.toLowerCase();
    return assignments.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.autoName?.toLowerCase().includes(q) ||
        a.assignedTo.name.toLowerCase().includes(q) ||
        a.angle?.name.toLowerCase().includes(q) ||
        a.batchNumber.toString().includes(q)
    );
  };

  const hasFilters = filters.assignedToId || filters.formatId || filters.productId || filters.priority || searchQuery;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <LayoutGrid className="h-6 w-6 text-cyan-400" />
            Editor Assignments
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage video and graphic production tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchBoard}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={createDraftAndOpen}
            disabled={creatingDraft}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all disabled:opacity-50"
          >
            {creatingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New Assignment
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: "Total", value: stats.total, color: "text-white" },
            { label: "In Progress", value: (stats.byStatus?.EDITING_NOW || 0) + (stats.byStatus?.REVISION || 0), color: "text-yellow-400" },
            { label: "For Review", value: stats.byStatus?.READY_FOR_REVIEW || 0, color: "text-purple-400" },
            { label: "Overdue", value: stats.overdue, color: "text-red-400" },
            { label: "Avg Time", value: stats.avgTimeSeconds > 0 ? formatDuration(stats.avgTimeSeconds) : "-", color: "text-white" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-white/5 bg-[#111827] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500 uppercase tracking-wider">{stat.label}</span>
                <span className={cn("text-xl font-bold", stat.color)}>{stat.value}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-xl border border-white/5 bg-[#111827] p-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-[300px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search batch, name, editor..."
              className="pl-9 bg-white/5 border-white/10 text-sm placeholder:text-slate-600 focus:border-cyan-500/50"
            />
          </div>

          <Select
            value={filters.assignedToId || "all"}
            onValueChange={(v) =>
              setFilters({ ...filters, assignedToId: v === "all" ? undefined : v })
            }
          >
            <SelectTrigger className="w-[160px] bg-white/5 border-white/10">
              <SelectValue placeholder="All Editors" />
            </SelectTrigger>
            <SelectContent className="bg-[#111827] border-white/10">
              <SelectItem value="all">All Editors</SelectItem>
              {editors.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.formatId || "all"}
            onValueChange={(v) =>
              setFilters({ ...filters, formatId: v === "all" ? undefined : v })
            }
          >
            <SelectTrigger className="w-[160px] bg-white/5 border-white/10">
              <SelectValue placeholder="All Formats" />
            </SelectTrigger>
            <SelectContent className="bg-[#111827] border-white/10">
              <SelectItem value="all">All Formats</SelectItem>
              {formats.map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.priority || "all"}
            onValueChange={(v) =>
              setFilters({ ...filters, priority: v === "all" ? undefined : (v as AssignmentPriority) })
            }
          >
            <SelectTrigger className="w-[160px] bg-white/5 border-white/10">
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent className="bg-[#111827] border-white/10">
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>

          {hasFilters && (
            <button
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all"
              onClick={() => {
                setFilters({});
                setSearchQuery("");
              }}
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Kanban Board */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
          <AlertTriangle className="h-12 w-12 text-amber-400 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Could not load assignments</h3>
          <p className="text-slate-500 mb-4">{error}</p>
          <button
            onClick={fetchBoard}
            className="px-4 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-all"
          >
            Retry
          </button>
        </div>
      ) : board ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {(Object.keys(STATUS_CONFIG) as AssignmentStatus[]).map((status) => (
            <KanbanColumn
              key={status}
              status={status}
              assignments={filterBySearch(board[status] || [])}
              onCardClick={handleCardClick}
              onStatusChange={handleStatusChange}
              onPublish={(a) => setPublishingAssignment(a)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/5 bg-[#111827] py-12 text-center">
          <LayoutGrid className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-500">No assignments yet. Create your first one!</p>
        </div>
      )}

      {/* Create/Edit Modal */}
      <AssignmentModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        assignment={editingAssignment}
        onSaved={fetchBoard}
      />

      {/* Detail Modal */}
      {viewingAssignment && (
        <AssignmentDetail
          open={!!viewingAssignment}
          onOpenChange={(open) => {
            if (!open) setViewingAssignment(null);
          }}
          assignment={viewingAssignment}
          onEdit={() => {
            setEditingAssignment(viewingAssignment);
            setViewingAssignment(null);
            setShowCreateModal(true);
          }}
          onStatusChange={async (status, feedback) => {
            try {
              const res = await fetch(`/api/assignments/${viewingAssignment.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status, revisionFeedback: feedback }),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "Failed to update status");
              }
              fetchBoard();
              if (status === "READY_FOR_POSTING") refreshViewing(viewingAssignment.id);
              else setViewingAssignment(null);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to update status");
            }
          }}
          onUpdateNotes={(notes) => {
            fetch(`/api/assignments/${viewingAssignment.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ strategistNotes: notes }),
            }).then(() => fetchBoard());
          }}
          onDelete={() => {
            fetch(`/api/assignments/${viewingAssignment.id}`, {
              method: "DELETE",
            }).then(() => {
              setViewingAssignment(null);
              fetchBoard();
            });
          }}
          isAdmin
          onUploadComplete={() => {
            fetchBoard();
            refreshViewing(viewingAssignment.id);
          }}
        />
      )}

      {/* Upload to Meta (from the kanban card) */}
      {publishingAssignment && (
        <UploadToMetaDialog
          assignment={publishingAssignment}
          open={!!publishingAssignment}
          onOpenChange={(open) => { if (!open) setPublishingAssignment(null); }}
          onPublished={() => {
            setPublishingAssignment(null);
            fetchBoard();
          }}
        />
      )}
    </div>
  );
}
