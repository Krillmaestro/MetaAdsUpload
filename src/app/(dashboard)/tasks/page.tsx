"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  Plus,
  Play,
  Check,
  RotateCcw,
  Trash2,
  Pencil,
  CalendarDays,
  ListTodo,
  Loader2,
  ArrowRight,
} from "lucide-react";

interface AdminTask {
  id: string;
  title: string;
  description: string | null;
  assignedToId: string;
  assignedToName: string;
  createdById: string;
  createdByName: string;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface Founder {
  id: string;
  name: string;
}

const PRIORITY_STYLES: Record<AdminTask["priority"], { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "bg-red-500/10 text-red-400 border-red-500/20" },
  high: { label: "High", className: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  medium: { label: "Medium", className: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  low: { label: "Low", className: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
};

const COLUMNS: { status: AdminTask["status"]; label: string; dot: string }[] = [
  { status: "todo", label: "To Do", dot: "bg-slate-400" },
  { status: "in_progress", label: "In Progress", dot: "bg-cyan-400" },
  { status: "done", label: "Done", dot: "bg-emerald-400" },
];

type Filter = "all" | "for_me" | "by_me";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });
}

function isOverdue(task: AdminTask): boolean {
  if (!task.dueDate || task.status === "done") return false;
  const due = new Date(task.dueDate);
  due.setHours(23, 59, 59, 999);
  return due.getTime() < Date.now();
}

export default function TasksPage() {
  const [myId, setMyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMyId(data?.user?.id))
      .catch(() => {});
  }, []);

  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [founders, setFounders] = useState<Founder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");

  // Create/edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AdminTask | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [priority, setPriority] = useState<AdminTask["priority"]>("medium");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/admin-tasks");
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      toast.error("Could not load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTasks();
    fetch("/api/work/people")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setFounders(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [loadTasks]);

  const openCreate = () => {
    setEditingTask(null);
    setTitle("");
    setDescription("");
    setAssignedToId(myId || "");
    setPriority("medium");
    setDueDate("");
    setDialogOpen(true);
  };

  const openEdit = (task: AdminTask) => {
    setEditingTask(task);
    setTitle(task.title);
    setDescription(task.description || "");
    setAssignedToId(task.assignedToId);
    setPriority(task.priority);
    setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : "");
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Title is required"); return; }
    if (!assignedToId) { toast.error("Pick an assignee"); return; }
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        assignedToId,
        priority,
        dueDate: dueDate || null,
      };
      const res = editingTask
        ? await fetch(`/api/admin-tasks/${editingTask.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/admin-tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Save failed");
      }
      toast.success(editingTask ? "Task updated" : "Task created");
      setDialogOpen(false);
      await loadTasks();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (task: AdminTask, status: AdminTask["status"]) => {
    // Optimistic update
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status } : t)));
    try {
      const res = await fetch(`/api/admin-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      await loadTasks();
    } catch {
      toast.error("Could not update status");
      await loadTasks();
    }
  };

  const handleDelete = async (task: AdminTask) => {
    setConfirmDeleteId(null);
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    try {
      const res = await fetch(`/api/admin-tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Task deleted");
    } catch {
      toast.error("Could not delete task");
      await loadTasks();
    }
  };

  const filtered = tasks.filter((t) => {
    if (filter === "for_me") return t.assignedToId === myId;
    if (filter === "by_me") return t.createdById === myId;
    return true;
  });

  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "for_me", label: "For me" },
    { value: "by_me", label: "By me" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <ListTodo className="h-5 w-5 text-cyan-400" />
            Team Tasks
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Quick tasks between founders — assign, start, finish.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-white/10 bg-[#111827] p-0.5">
            {filters.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  filter === f.value
                    ? "bg-cyan-500/15 text-cyan-400"
                    : "text-slate-400 hover:text-slate-200"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            New Task
          </button>
        </div>
      </div>

      {/* Board */}
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const colTasks = filtered.filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="rounded-xl border border-white/5 bg-[#111827]/60 p-3">
              <div className="flex items-center gap-2 px-1 pb-3">
                <span className={cn("h-2 w-2 rounded-full", col.dot)} />
                <span className="text-sm font-semibold text-white">{col.label}</span>
                <span className="text-xs text-slate-500">{colTasks.length}</span>
              </div>
              <div className="space-y-2.5">
                {colTasks.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/10 py-8 text-center text-xs text-slate-500">
                    No tasks
                  </div>
                )}
                {colTasks.map((task) => {
                  const prio = PRIORITY_STYLES[task.priority];
                  const overdue = isOverdue(task);
                  return (
                    <div
                      key={task.id}
                      className={cn(
                        "group rounded-xl border bg-[#111827] p-3.5 transition-colors",
                        overdue ? "border-red-500/30" : "border-white/5 hover:border-white/15"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={cn(
                            "text-sm font-medium leading-snug",
                            task.status === "done" ? "text-slate-400 line-through" : "text-white"
                          )}
                        >
                          {task.title}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                            prio.className
                          )}
                        >
                          {prio.label}
                        </span>
                      </div>

                      {task.description && (
                        <p className="mt-1.5 text-xs text-slate-400 line-clamp-3 whitespace-pre-wrap">
                          {task.description}
                        </p>
                      )}

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1">
                          {task.createdByName.split(" ")[0]}
                          <ArrowRight className="h-3 w-3" />
                          <span className={cn(task.assignedToId === myId && "text-cyan-400 font-medium")}>
                            {task.assignedToId === myId ? "Me" : task.assignedToName.split(" ")[0]}
                          </span>
                        </span>
                        {task.dueDate && (
                          <span className={cn("flex items-center gap-1", overdue && "text-red-400 font-medium")}>
                            <CalendarDays className="h-3 w-3" />
                            {formatDate(task.dueDate)}
                          </span>
                        )}
                        {task.status === "done" && task.completedAt && (
                          <span className="flex items-center gap-1 text-emerald-500/70">
                            <Check className="h-3 w-3" />
                            {formatDate(task.completedAt)}
                          </span>
                        )}
                      </div>

                      <div className="mt-3 flex items-center gap-1.5">
                        {task.status === "todo" && (
                          <button
                            onClick={() => setStatus(task, "in_progress")}
                            className="flex items-center gap-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1 text-xs font-medium text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                          >
                            <Play className="h-3 w-3" />
                            Start
                          </button>
                        )}
                        {task.status === "in_progress" && (
                          <button
                            onClick={() => setStatus(task, "done")}
                            className="flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Check className="h-3 w-3" />
                            Finish
                          </button>
                        )}
                        {task.status === "done" && (
                          <button
                            onClick={() => setStatus(task, "todo")}
                            className="flex items-center gap-1 rounded-md bg-slate-500/10 border border-slate-500/20 px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-500/20 transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            Reopen
                          </button>
                        )}

                        <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(task)}
                            className="rounded-md p-1.5 text-slate-500 hover:text-white hover:bg-white/5 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {confirmDeleteId === task.id ? (
                            <button
                              onClick={() => handleDelete(task)}
                              onBlur={() => setConfirmDeleteId(null)}
                              className="rounded-md px-2 py-1 text-[11px] font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25 transition-colors"
                            >
                              Sure?
                            </button>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(task.id)}
                              className="rounded-md p-1.5 text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#111827] border-white/10 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editingTask ? "Edit Task" : "New Task"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="bg-[#0a0e1a] border-white/10 text-white"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Description (optional)</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Details, links, context…"
                rows={3}
                className="bg-[#0a0e1a] border-white/10 text-white resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Assign to</Label>
                <Select value={assignedToId} onValueChange={setAssignedToId}>
                  <SelectTrigger className="bg-[#0a0e1a] border-white/10 text-white">
                    <SelectValue placeholder="Pick founder" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111827] border-white/10">
                    {founders.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.id === myId ? `${a.name} (me)` : a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300">Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as AdminTask["priority"])}>
                  <SelectTrigger className="bg-[#0a0e1a] border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111827] border-white/10">
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300">Due date (optional)</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-[#0a0e1a] border-white/10 text-white [color-scheme:dark]"
              />
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {editingTask ? "Save" : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
