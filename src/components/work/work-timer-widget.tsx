"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Square, X, Timer as TimerIcon, Trash2, AlertTriangle, Loader2, Coffee, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  type WorkSession,
  type WorkTag,
  MIN_NOTE_LENGTH,
  formatClock,
  formatDuration,
} from "@/lib/work-types";

/** Fired whenever a session starts/stops/changes so open dashboards can refresh. */
export const WORK_SESSION_EVENT = "work-session-changed";
const LONG_RUN_WARNING_SECONDS = 4 * 3600;

function notifyChanged() {
  window.dispatchEvent(new CustomEvent(WORK_SESSION_EVENT));
}


// ── Drag anywhere ────────────────────────────────────────────────────────────
// The widget sits bottom-right by default, which is exactly where comment
// boxes and approve buttons live on the review pages. Grab any header (or the
// idle pill) to move it; the spot is remembered, kept on screen, and a
// double-click on the handle puts it back.
const POS_KEY = "work-timer-widget-pos";
type Pos = { x: number; y: number };

function useDraggable() {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const movedRef = useRef(false);

  const clamp = useCallback((p: Pos): Pos => {
    const el = ref.current;
    if (!el) return p;
    const m = 8;
    const maxX = Math.max(m, window.innerWidth - el.offsetWidth - m);
    const maxY = Math.max(m, window.innerHeight - el.offsetHeight - m);
    return { x: Math.min(Math.max(m, p.x), maxX), y: Math.min(Math.max(m, p.y), maxY) };
  }, []);

  useEffect(() => {
    // Read the saved spot after mount (localStorage is client-only) and apply
    // it on the next frame so the layout has the widget's real size to clamp to.
    let raw: string | null = null;
    try { raw = localStorage.getItem(POS_KEY); } catch { /* storage blocked */ }
    if (!raw) return;
    const id = requestAnimationFrame(() => {
      try { setPos(clamp(JSON.parse(raw as string) as Pos)); } catch { /* corrupt value */ }
    });
    return () => cancelAnimationFrame(id);
  }, [clamp]);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clamp(p) : p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  /** Call when the widget changes size (pill ↔ panel) so it stays on screen. */
  const reclamp = useCallback(() => setPos((p) => (p ? clamp(p) : p)), [clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    drag.current = { startX: e.clientX, startY: e.clientY, originX: r.left, originY: r.top, moved: false };
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return; // a click, not a drag
    d.moved = true;
    movedRef.current = true;
    setPos(clamp({ x: d.originX + dx, y: d.originY + dy }));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (d?.moved) {
      setPos((p) => {
        if (p) try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
        return p;
      });
    }
  };
  const reset = () => {
    setPos(null);
    try { localStorage.removeItem(POS_KEY); } catch { /* storage blocked */ }
  };

  const handleProps = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onDoubleClick: reset,
    style: { touchAction: "none" as const },
    title: "Dra för att flytta · dubbelklick lägger tillbaka den",
  };
  const style: React.CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto" } : undefined;
  return { ref, style, handleProps, movedRef, reclamp };
}

export function WorkTimerWidget() {
  const { ref: dragRef, style: dragStyle, handleProps: dragHandle, movedRef: dragMoved, reclamp } = useDraggable();
  const [active, setActive] = useState<WorkSession | null>(null);
  const [categories, setCategories] = useState<WorkTag[]>([]);
  const [brands, setBrands] = useState<WorkTag[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const [expanded, setExpanded] = useState(false);
  useEffect(() => { reclamp(); }, [active, expanded, reclamp]); // pill ↔ panel changes size
  const [categoryId, setCategoryId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [task, setTask] = useState("");

  const [stopOpen, setStopOpen] = useState(false);
  const [note, setNote] = useState("");
  const [stopCategoryId, setStopCategoryId] = useState("");
  const [stopBrandId, setStopBrandId] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Baseline from the server + local delta — immune to client/server clock skew.
  const baselineRef = useRef<{ seconds: number; at: number }>({ seconds: 0, at: Date.now() });
  const [, forceTick] = useState(0);

  const applyActive = useCallback((session: WorkSession | null) => {
    setActive(session);
    baselineRef.current = { seconds: session?.elapsedSeconds ?? 0, at: Date.now() };
  }, []);

  const loadActive = useCallback(async () => {
    try {
      const res = await fetch("/api/work/sessions/active", { cache: "no-store" });
      if (!res.ok) return;
      applyActive((await res.json()) as WorkSession | null);
    } catch {
      /* offline — keep ticking locally */
    }
  }, [applyActive]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cats, brs] = await Promise.all([
        fetch("/api/work/categories").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/work/brands").then((r) => (r.ok ? r.json() : [])),
      ]).catch(() => [[], []]);
      if (cancelled) return;
      setCategories((cats as WorkTag[]).filter((c) => c.isActive));
      setBrands((brs as WorkTag[]).filter((b) => b.isActive));
      await loadActive();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadActive]);

  // Live clock.
  useEffect(() => {
    if (active?.status !== "running") return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active?.status]);

  // Re-sync when the tab regains focus or every 2 min (other device / other tab).
  useEffect(() => {
    const onFocus = () => loadActive();
    window.addEventListener("focus", onFocus);
    const id = setInterval(loadActive, 120_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(id);
    };
  }, [loadActive]);

  const elapsed =
    active?.status === "running"
      ? baselineRef.current.seconds + Math.floor((Date.now() - baselineRef.current.at) / 1000)
      : (active?.elapsedSeconds ?? 0);

  async function start() {
    if (!categoryId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/work/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId, brandId: brandId || null, task: task || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Kunde inte starta");
        if (res.status === 409) loadActive();
        return;
      }
      applyActive(data as WorkSession);
      setExpanded(false);
      setTask("");
      notifyChanged();
    } finally {
      setBusy(false);
    }
  }

  async function patch(action: string, extra: Record<string, unknown> = {}) {
    if (!active || busy) return null;
    setBusy(true);
    try {
      const res = await fetch(`/api/work/sessions/${active.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Något gick fel");
        return null;
      }
      return data as WorkSession;
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    const updated = await patch(active?.status === "paused" ? "resume" : "pause");
    if (updated) {
      applyActive(updated);
      notifyChanged();
    }
  }

  function openStop() {
    if (!active) return;
    setNote("");
    setStopCategoryId(active.categoryId);
    setStopBrandId(active.brandId ?? "");
    setConfirmDiscard(false);
    setStopOpen(true);
  }

  async function confirmStop() {
    if (note.trim().length < MIN_NOTE_LENGTH) return;
    const updated = await patch("stop", {
      note: note.trim(),
      categoryId: stopCategoryId || undefined,
      brandId: stopBrandId || null,
    });
    if (updated) {
      applyActive(null);
      setStopOpen(false);
      notifyChanged();
      toast.success(`Loggat: ${formatDuration(updated.durationSeconds ?? 0)}`);
    }
  }

  async function discard() {
    if (!active) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/work/sessions/${active.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Kunde inte slänga passet");
        return;
      }
      applyActive(null);
      setStopOpen(false);
      notifyChanged();
      toast.success("Passet slängt");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  const running = active?.status === "running";
  const paused = active?.status === "paused";
  const longRun = !!active && elapsed > LONG_RUN_WARNING_SECONDS;
  const noteOk = note.trim().length >= MIN_NOTE_LENGTH;

  return (
    <>
      <div ref={dragRef} style={dragStyle} className="fixed bottom-4 right-4 z-40 print:hidden max-w-[calc(100vw-2rem)]">
        {/* ── Idle, collapsed ─────────────────────────────────────────────── */}
        {!active && !expanded && (
          <button
            {...dragHandle}
            onClick={() => {
              if (dragMoved.current) { dragMoved.current = false; return; }
              setExpanded(true);
              if (!categoryId && categories[0]) setCategoryId(categories[0].id);
            }}
            className="flex items-center gap-2 rounded-full bg-[#111827] border border-cyan-500/30 pl-2 pr-4 py-2.5 text-sm font-medium text-cyan-300 shadow-lg shadow-black/40 hover:border-cyan-400/60 hover:text-cyan-200 transition-all cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5 text-slate-500" />
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500/15">
              <Play className="h-3 w-3 fill-current" />
            </span>
            Starta timer
          </button>
        )}

        {/* ── Idle, picking what to work on ───────────────────────────────── */}
        {!active && expanded && (
          <div className="w-[336px] max-w-full rounded-xl border border-white/10 bg-[#111827] shadow-2xl shadow-black/60 overflow-hidden">
            <div {...dragHandle} className="flex items-center justify-between px-4 py-3 border-b border-white/5 cursor-grab active:cursor-grabbing select-none">
              <span className="flex items-center gap-2 text-sm font-semibold text-white"><GripVertical className="h-3.5 w-3.5 text-slate-500" />Vad jobbar du med?</span>
              <button
                onClick={() => setExpanded(false)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
                aria-label="Stäng"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 max-h-[65vh] overflow-auto">
              <TagPicker
                label="Kategori"
                tags={categories}
                value={categoryId}
                onChange={setCategoryId}
              />
              <TagPicker
                label="Varumärke"
                tags={brands}
                value={brandId}
                onChange={setBrandId}
                allowNone
                noneLabel="Inget"
              />
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                  Uppgift <span className="text-slate-600 normal-case tracking-normal">(valfritt)</span>
                </label>
                <Input
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="t.ex. Ear-lander hero"
                  className="h-9 bg-[#0a0e1a] border-white/10 text-sm text-white"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") start();
                  }}
                />
              </div>
            </div>

            <div className="px-4 py-3 border-t border-white/5">
              <button
                onClick={start}
                disabled={!categoryId || busy}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 py-2.5 text-sm font-semibold text-[#04202a] transition-colors"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                Starta
              </button>
            </div>
          </div>
        )}

        {/* ── Running / paused ────────────────────────────────────────────── */}
        {active && (
          <div
            className={cn(
              "w-[336px] max-w-full rounded-xl border bg-[#111827] shadow-2xl shadow-black/60 overflow-hidden transition-colors",
              running && "border-emerald-500/30",
              paused && "border-yellow-500/30"
            )}
          >
            <div className="px-4 pt-3.5 pb-3">
              <div {...dragHandle} className="flex items-center gap-2 mb-2.5 flex-wrap cursor-grab active:cursor-grabbing select-none">
                <span className="relative flex h-2 w-2 shrink-0">
                  {running && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={cn(
                      "relative inline-flex rounded-full h-2 w-2",
                      running ? "bg-emerald-400" : "bg-yellow-400"
                    )}
                  />
                </span>
                <Chip color={active.categoryColor} label={active.categoryName ?? "Okänd"} />
                {active.brandName && <Chip color={active.brandColor} label={active.brandName} />}
                <GripVertical className="ml-auto h-3.5 w-3.5 text-slate-600" />
              </div>

              <div
                className={cn(
                  "font-mono text-4xl font-bold tracking-wider tabular-nums",
                  running ? "text-emerald-400" : "text-yellow-400"
                )}
              >
                {formatClock(elapsed)}
              </div>

              {active.task && (
                <div className="mt-1 text-xs text-slate-400 truncate">{active.task}</div>
              )}

              {longRun && (
                <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-2 text-[11px] text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>Timern har gått i {formatDuration(elapsed)}. Glömde du stoppa?</span>
                </div>
              )}

              {/* The pause button existed but nobody had been told to use it, so
                  breaks were being logged as work. State the rule where it is
                  actually read: next to the running clock. */}
              {running && !longRun && (
                <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
                  <Coffee className="mt-px h-3 w-3 shrink-0" />
                  <span>Pausa vid toa, kaffe eller rast — tiden ska spegla arbete.</span>
                </p>
              )}

              {paused && (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-yellow-300">
                  <Coffee className="mt-px h-3 w-3 shrink-0" />
                  <span>Pausad — ingen tid räknas. Tryck Fortsätt när du är tillbaka.</span>
                </p>
              )}
            </div>

            <div className="flex gap-2 px-4 pb-3.5">
              <button
                onClick={togglePause}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-40 transition-colors"
              >
                {paused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5" />}
                {paused ? "Fortsätt" : "Pausa"}
              </button>
              <button
                onClick={openStop}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-rose-500/90 hover:bg-rose-500 py-2 text-xs font-semibold text-white disabled:opacity-40 transition-colors"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Stoppa
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Stop dialog — the comment is the whole point ───────────────────── */}
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TimerIcon className="h-4 w-4 text-cyan-400" />
              Vad fick du gjort?
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-white tabular-nums">
                {formatClock(elapsed)}
              </span>
              <span className="text-xs text-slate-500">loggas på det här passet</span>
            </div>

            <TagPicker label="Kategori" tags={categories} value={stopCategoryId} onChange={setStopCategoryId} />
            <TagPicker
              label="Varumärke"
              tags={brands}
              value={stopBrandId}
              onChange={setStopBrandId}
              allowNone
              noneLabel="Inget"
            />

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
                Kommentar <span className="text-rose-400">*</span>
              </label>
              <Textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="t.ex. Skrev 3 hooks + body till ear-angle, klar för editor"
                className="min-h-[88px] bg-[#0a0e1a] border-white/10 text-sm text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && noteOk) confirmStop();
                }}
              />
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-slate-600">Konkret vad du gjorde — inte bara kategorin igen.</span>
                <span className={cn("tabular-nums", noteOk ? "text-emerald-400" : "text-slate-500")}>
                  {note.trim().length}/{MIN_NOTE_LENGTH}
                </span>
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
            <button
              onClick={discard}
              disabled={busy}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
                confirmDiscard
                  ? "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                  : "text-slate-500 hover:text-rose-400"
              )}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmDiscard ? "Säker? Klicka igen" : "Släng passet"}
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setStopOpen(false)}
                className="rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-white transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={confirmStop}
                disabled={!noteOk || busy}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 px-4 py-2 text-xs font-semibold text-[#04202a] transition-colors"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Spara & stoppa
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Identity comes from the coloured dot beside the text, never from colouring
 * the text — a light categorical hue is illegible as type on this surface.
 */
export function Chip({ color, label }: { color: string | null; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px] font-medium text-slate-300">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color ?? "#94a3b8" }} />
      {label}
    </span>
  );
}

export function TagPicker({
  label,
  tags,
  value,
  onChange,
  allowNone = false,
  noneLabel = "Ingen",
}: {
  label: string;
  tags: WorkTag[];
  value: string;
  onChange: (id: string) => void;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
              value === ""
                ? "border-white/25 bg-white/10 text-white"
                : "border-white/5 bg-white/[0.03] text-slate-500 hover:text-slate-300"
            )}
          >
            {noneLabel}
          </button>
        )}
        {tags.map((tag) => {
          const selected = value === tag.id;
          return (
            <button
              key={tag.id}
              type="button"
              onClick={() => onChange(tag.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                selected
                  ? "border-white/25 bg-white/10 text-white"
                  : "border-white/5 bg-white/[0.03] text-slate-400 hover:text-slate-200"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
