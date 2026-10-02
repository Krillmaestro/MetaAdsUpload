"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Plus, Save, X, Eye, Pencil } from "lucide-react";
import { toast } from "sonner";
import { TEMPLATE_FIELDS, fillTemplate } from "@/lib/butiker/status";

export type MailTemplate = {
  id: string; name: string; subject: string; body: string; version: number;
  state: string; notes: string | null; updatedBy: string | null; createdAt: string; updatedAt: string;
};
type Usage = { templateId: string; templateVersion: number | null; sent: number; shops: number; lastSentAt: string | null };

const STATES: Record<string, { label: string; cls: string }> = {
  aktiv: { label: "Aktiv", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  utkast: { label: "Utkast", cls: "bg-amber-500/10 text-amber-300 border-amber-500/20" },
  arkiverad: { label: "Arkiverad", cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
};
const timeSv = (s: string) => new Date(s).toLocaleString("sv-SE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const empty = { name: "", subject: "", body: "", notes: "", state: "utkast" };

/** The mail templates used for the shops: what we say, which version, and how many got it. */
export function MallarView({ example }: { example: { name: string; city: string | null; localCustomers?: number | null } | null }) {
  const [templates, setTemplates] = useState<MailTemplate[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // template id, or "new"
  const [draft, setDraft] = useState(empty);
  const [preview, setPreview] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/butiker/mallar", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte läsa mallarna");
      setTemplates(json.templates); setUsage(json.usage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte läsa mallarna");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const usageFor = useMemo(() => {
    const m = new Map<string, Usage[]>();
    for (const u of usage) m.set(u.templateId, [...(m.get(u.templateId) ?? []), u]);
    return m;
  }, [usage]);

  function startEdit(t: MailTemplate | null) {
    setEditing(t ? t.id : "new");
    setDraft(t ? { name: t.name, subject: t.subject, body: t.body, notes: t.notes ?? "", state: t.state } : empty);
  }

  async function save() {
    if (!draft.name.trim() || !draft.subject.trim() || !draft.body.trim()) { toast.error("Mallen behöver namn, ämne och text"); return; }
    setSaving(true);
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/butiker/mallar" : `/api/butiker/mallar/${editing}`, {
        method: isNew ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Kunde inte spara");
      toast.success(isNew ? "Mallen är skapad" : `Sparad som version ${json.template.version}`);
      setEditing(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Kunde inte spara");
    } finally {
      setSaving(false);
    }
  }

  const input = "bg-[#0a0e1a] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40";
  const sorted = [...templates].sort((a, b) => (a.state === "aktiv" ? -1 : 0) - (b.state === "aktiv" ? -1 : 0));

  const editor = (
    <div className="rounded-xl border border-cyan-500/20 bg-[#111827] p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-2">
        <input className={input} placeholder="Mallens namn, t.ex. Kallt mejl – fristående butiker" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <select className={input} value={draft.state} onChange={(e) => setDraft({ ...draft, state: e.target.value })}>
          {Object.entries(STATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>
      <input className={`${input} w-full`} placeholder="Ämnesrad" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
      <textarea className={`${input} w-full font-mono leading-relaxed`} rows={18} placeholder="Mejlets text" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      <input className={`${input} w-full`} placeholder="Anteckning (varför den här versionen, vad som ändrats)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span>Fält som fylls i per butik: {TEMPLATE_FIELDS.map((f) => <code key={f.token} className="text-cyan-400 mx-1">{f.token}</code>)}</span>
        <span>{words(draft.body)} ord i texten</span>
        {editing !== "new" && <span>Ändrar du ämne eller text sparas det som en ny version. Mejl som redan är skickade påverkas inte.</span>}
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 text-sm flex items-center gap-2 disabled:opacity-50">
          <Save className="h-4 w-4" /> Spara mallen
        </button>
        <button onClick={() => setEditing(null)} className="px-3 py-2 rounded-lg text-slate-400 border border-white/10 hover:bg-white/[0.03] text-sm flex items-center gap-2">
          <X className="h-4 w-4" /> Avbryt
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500 max-w-2xl">
          Här ligger texterna vi mejlar butikerna. Varje skickat mejl sparas ordagrant på butiken, med vilken mall och version det kom från.
        </p>
        {editing === null && (
          <button onClick={() => startEdit(null)} className="px-3 py-2 rounded-lg text-sm text-slate-300 border border-white/10 hover:bg-white/[0.03] flex items-center gap-2">
            <Plus className="h-4 w-4" /> Ny mall
          </button>
        )}
      </div>

      {editing === "new" && editor}
      {loading && <div className="text-sm text-slate-500">Laddar mallarna …</div>}
      {!loading && templates.length === 0 && editing === null && (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
          Inga mallar än. Klicka på ”Ny mall” för att lägga in den första.
        </div>
      )}

      {sorted.map((t) => {
        if (editing === t.id) return <div key={t.id}>{editor}</div>;
        const st = STATES[t.state] ?? STATES.utkast;
        const u = usageFor.get(t.id) ?? [];
        const sent = u.reduce((n, x) => n + x.sent, 0);
        const showPreview = !!preview[t.id] && !!example;
        const subject = showPreview && example ? fillTemplate(t.subject, example) : t.subject;
        const body = showPreview && example ? fillTemplate(t.body, example) : t.body;
        return (
          <div key={t.id} className="rounded-xl border border-white/5 bg-[#111827] overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-white/5 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <FileText className="h-4 w-4 text-cyan-400" />
                  <span className="text-white font-medium">{t.name}</span>
                  <span className={`text-[11px] rounded-md border px-2 py-0.5 ${st.cls}`}>{st.label}</span>
                  <span className="text-[11px] text-slate-500">version {t.version}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Senast ändrad {timeSv(t.updatedAt)}{t.updatedBy ? ` av ${t.updatedBy}` : ""} · {words(t.body)} ord
                  {" · "}{sent ? `skickad ${sent} gånger` : "inte skickad än"}
                  {u.length > 1 && ` (${u.sort((a, b) => (a.templateVersion ?? 0) - (b.templateVersion ?? 0)).map((x) => `v${x.templateVersion}: ${x.sent}`).join(", ")})`}
                </div>
                {t.notes && <div className="text-xs text-slate-400 mt-1">{t.notes}</div>}
              </div>
              <div className="flex gap-2">
                {example && (
                  <button onClick={() => setPreview({ ...preview, [t.id]: !preview[t.id] })}
                    className={`px-2.5 py-1.5 rounded-lg text-xs border flex items-center gap-1.5 ${showPreview ? "border-cyan-500/30 text-cyan-300" : "border-white/10 text-slate-400 hover:bg-white/[0.03]"}`}>
                    <Eye className="h-3.5 w-3.5" /> {showPreview ? `Som ${example.name}` : "Förhandsvisa"}
                  </button>
                )}
                <button onClick={() => startEdit(t)} className="px-2.5 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400 hover:bg-white/[0.03] flex items-center gap-1.5">
                  <Pencil className="h-3.5 w-3.5" /> Ändra
                </button>
              </div>
            </div>
            <div className="px-4 py-4 space-y-3">
              <div className="text-sm"><span className="text-slate-500">Ämne: </span><span className="text-white">{subject}</span></div>
              <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed max-w-3xl">{body}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
