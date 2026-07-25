"use client";

import { useState } from "react";
import { Plus, EyeOff, Eye, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { WorkTag } from "@/lib/work-types";

const PALETTE = [
  "#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fb923c", "#facc15",
  "#22d3ee", "#f87171", "#4ade80", "#60a5fa", "#c084fc", "#94a3b8",
];

/** Manage the category / brand lists without leaving the page. */
export function TaxonomyDialog({
  open,
  onOpenChange,
  categories,
  brands,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: WorkTag[];
  brands: WorkTag[];
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"categories" | "brands">("categories");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Kategorier & varumärken</DialogTitle>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-white/5 p-1">
          {(["categories", "brands"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === key ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
              )}
            >
              {key === "categories" ? "Kategorier" : "Varumärken"}
            </button>
          ))}
        </div>

        <TagList
          endpoint={tab === "categories" ? "categories" : "brands"}
          tags={tab === "categories" ? categories : brands}
          onChanged={onChanged}
        />
      </DialogContent>
    </Dialog>
  );
}

function TagList({
  endpoint,
  tags,
  onChanged,
}: {
  endpoint: "categories" | "brands";
  tags: WorkTag[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/work/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Kunde inte skapa");
        return;
      }
      setName("");
      setColor(PALETTE[(tags.length + 1) % PALETTE.length]);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/work/${endpoint}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Kunde inte uppdatera");
      return;
    }
    onChanged();
  }

  async function remove(id: string) {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    const res = await fetch(`/api/work/${endpoint}/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "Kunde inte radera");
      setConfirmId(null);
      return;
    }
    setConfirmId(null);
    onChanged();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent p-1"
          aria-label="Färg"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={endpoint === "categories" ? "Ny kategori" : "Nytt varumärke"}
          className="h-9 bg-[#0a0e1a] border-white/10 text-sm text-white"
          onKeyDown={(e) => {
            if (e.key === "Enter") create();
          }}
        />
        <button
          onClick={create}
          disabled={!name.trim() || busy}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 px-3 text-xs font-semibold text-[#04202a] transition-colors"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Lägg till
        </button>
      </div>

      <div className="divide-y divide-white/5 rounded-lg border border-white/5">
        {tags.map((tag) => (
          <div
            key={tag.id}
            className={cn("flex items-center gap-2.5 px-3 py-2", !tag.isActive && "opacity-50")}
          >
            <input
              type="color"
              value={tag.color}
              onChange={(e) => patch(tag.id, { color: e.target.value })}
              className="h-5 w-5 shrink-0 cursor-pointer rounded border border-white/10 bg-transparent p-0"
              aria-label={`Färg för ${tag.name}`}
            />
            <span className="flex-1 truncate text-sm text-slate-200">{tag.name}</span>
            {!tag.isActive && <span className="text-[10px] uppercase text-slate-500">dold</span>}
            <button
              onClick={() => patch(tag.id, { isActive: !tag.isActive })}
              className="rounded p-1 text-slate-500 hover:text-slate-200 transition-colors"
              title={tag.isActive ? "Dölj (behåll historiken)" : "Visa igen"}
            >
              {tag.isActive ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => remove(tag.id)}
              className={cn(
                "rounded p-1 transition-colors",
                confirmId === tag.id ? "text-rose-400" : "text-slate-500 hover:text-rose-400"
              )}
              title={confirmId === tag.id ? "Klicka igen för att radera" : "Radera"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {tags.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-slate-500">Inget upplagt än</div>
        )}
      </div>

      <p className="text-[11px] text-slate-500">
        Dölj hellre än radera — dolda taggar försvinner ur väljaren men historiken behålls.
      </p>
    </div>
  );
}
