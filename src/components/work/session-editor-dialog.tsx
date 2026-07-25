"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { TagPicker } from "@/components/work/work-timer-widget";
import {
  type WorkSession,
  type WorkTag,
  MIN_NOTE_LENGTH,
  formatDuration,
} from "@/lib/work-types";

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Add a session you forgot to time, or correct one you already logged. */
export function SessionEditorDialog({
  open,
  onOpenChange,
  session,
  categories,
  brands,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: WorkSession | null; // null = new manual entry
  categories: WorkTag[];
  brands: WorkTag[];
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [task, setTask] = useState("");
  const [note, setNote] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (session) {
      setCategoryId(session.categoryId);
      setBrandId(session.brandId ?? "");
      setTask(session.task ?? "");
      setNote(session.note ?? "");
      setStartedAt(toLocalInput(new Date(session.startedAt)));
      setEndedAt(session.endedAt ? toLocalInput(new Date(session.endedAt)) : "");
    } else {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 3600_000);
      setCategoryId(categories[0]?.id ?? "");
      setBrandId("");
      setTask("");
      setNote("");
      setStartedAt(toLocalInput(hourAgo));
      setEndedAt(toLocalInput(now));
    }
  }, [open, session, categories]);

  const start = startedAt ? new Date(startedAt) : null;
  const end = endedAt ? new Date(endedAt) : null;
  const durationSeconds = start && end ? Math.floor((end.getTime() - start.getTime()) / 1000) : 0;
  const timesValid = !!start && !!end && durationSeconds > 0;
  const noteOk = note.trim().length >= MIN_NOTE_LENGTH;
  const canSave = !!categoryId && timesValid && noteOk && !busy;

  async function save() {
    if (!canSave || !start || !end) return;
    setBusy(true);
    try {
      const payload = {
        categoryId,
        brandId: brandId || null,
        task: task.trim() || null,
        note: note.trim(),
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
      };

      const res = session
        ? await fetch(`/api/work/sessions/${session.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "update", ...payload }),
          })
        : await fetch("/api/work/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manual: true, ...payload }),
          });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Kunde inte spara");
        return;
      }
      toast.success(session ? "Passet uppdaterat" : `Loggat: ${formatDuration(durationSeconds)}`);
      onOpenChange(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!session) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/work/sessions/${session.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Kunde inte radera");
        return;
      }
      toast.success("Passet raderat");
      onOpenChange(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{session ? "Redigera pass" : "Lägg till pass manuellt"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <TagPicker label="Kategori" tags={categories} value={categoryId} onChange={setCategoryId} />
          <TagPicker
            label="Varumärke"
            tags={brands}
            value={brandId}
            onChange={setBrandId}
            allowNone
            noneLabel="Inget"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                Start
              </label>
              <Input
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
                className="h-9 bg-[#0a0e1a] border-white/10 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                Slut
              </label>
              <Input
                type="datetime-local"
                value={endedAt}
                onChange={(e) => setEndedAt(e.target.value)}
                className="h-9 bg-[#0a0e1a] border-white/10 text-sm text-white"
              />
            </div>
          </div>

          <div className="text-xs">
            {timesValid ? (
              <span className="text-slate-400">
                Längd: <span className="font-semibold text-white">{formatDuration(durationSeconds)}</span>
              </span>
            ) : (
              <span className="text-rose-400">Sluttiden måste vara efter starttiden</span>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Uppgift <span className="text-slate-600 normal-case tracking-normal">(valfritt)</span>
            </label>
            <Input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="t.ex. Ear-lander hero"
              className="h-9 bg-[#0a0e1a] border-white/10 text-sm text-white"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
              Kommentar <span className="text-rose-400">*</span>
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Vad gjorde du under passet?"
              className="min-h-[80px] bg-[#0a0e1a] border-white/10 text-sm text-white"
            />
            <div className="mt-1 text-right text-[11px] tabular-nums">
              <span className={noteOk ? "text-emerald-400" : "text-slate-500"}>
                {note.trim().length}/{MIN_NOTE_LENGTH}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          {session ? (
            <button
              onClick={remove}
              disabled={busy}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
                confirmDelete
                  ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                  : "text-slate-500 hover:text-rose-400"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmDelete ? "Säker? Klicka igen" : "Radera"}
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors"
            >
              Avbryt
            </button>
            <button
              onClick={save}
              disabled={!canSave}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 px-4 py-2 text-xs font-semibold text-[#04202a] transition-colors"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Spara
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
