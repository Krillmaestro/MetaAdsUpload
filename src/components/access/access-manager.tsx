"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Plus, KeyRound, Loader2, Check, RotateCcw, UserX, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AREAS, GRANTABLE_AREAS, allowedAreas, type AreaDef } from "@/lib/access";

interface Person {
  id: string; name: string; email: string; role: string; userType: string | null; slug: string | null;
  isActive: boolean; isFounder: boolean; isSuperadmin: boolean; permissions: string[] | null;
  hourlyRate: number | null; phone: string | null; createdAt: string;
}
type Draft = Pick<Person, "role" | "userType" | "isActive" | "isFounder" | "isSuperadmin" | "permissions">;

const GROUPS: AreaDef["group"][] = ["Overview", "Analyze", "Launch", "Workflow", "Team"];
const pick = (p: Person): Draft => ({ role: p.role, userType: p.userType, isActive: p.isActive, isFounder: p.isFounder, isSuperadmin: p.isSuperadmin, permissions: p.permissions ? [...p.permissions] : null });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

export function AccessManager({ currentUserId }: { currentUserId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [fresh, setFresh] = useState({ name: "", email: "", password: "", role: "editor", userType: "video_editor" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/access/users");
      if (!res.ok) throw new Error((await res.json()).error || "Failed to load");
      const list: Person[] = await res.json();
      setPeople(list);
      setDrafts(Object.fromEntries(list.map((p) => [p.id, pick(p)])));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (id: string, patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  const save = async (p: Person) => {
    const draft = drafts[p.id];
    setSaving(p.id);
    try {
      const res = await fetch(`/api/access/users/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save");
      setPeople((list) => list.map((x) => (x.id === p.id ? json : x)));
      setDrafts((d) => ({ ...d, [p.id]: pick(json) }));
      toast.success(`${json.name} saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const setPassword = async (id: string) => {
    setSaving(id);
    try {
      const res = await fetch(`/api/access/users/${id}/password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      toast.success("Password set");
      setPwFor(null); setPw("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(null);
    }
  };

  const create = async () => {
    setSaving("new");
    try {
      const res = await fetch("/api/access/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fresh) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create");
      toast.success(`${json.name} created`);
      setShowNew(false); setFresh({ name: "", email: "", password: "", role: "editor", userType: "video_editor" });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(null);
    }
  };

  const sorted = useMemo(() => [...people].sort((a, b) => Number(b.isActive) - Number(a.isActive) || Number(b.isSuperadmin) - Number(a.isSuperadmin) || (a.role === "admin" ? -1 : 1) - (b.role === "admin" ? -1 : 1) || a.name.localeCompare(b.name)), [people]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-cyan-400" /> Access</h1>
          <p className="text-sm text-slate-500 mt-0.5">Who may use which parts of the app. Changes apply on the person&apos;s next page load.</p>
        </div>
        <Button onClick={() => setShowNew((v) => !v)} className="bg-cyan-500 hover:bg-cyan-400 text-[#04202a]"><Plus className="h-4 w-4 mr-1" /> New person</Button>
      </div>

      {showNew && (
        <div className="rounded-xl border border-cyan-500/20 bg-[#111827] p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <Field label="Name"><Input value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} className="bg-[#0a0e1a] border-white/10" /></Field>
          <Field label="Email"><Input value={fresh.email} onChange={(e) => setFresh({ ...fresh, email: e.target.value })} className="bg-[#0a0e1a] border-white/10" /></Field>
          <Field label="Password" hint="8+ chars, a number, a capital"><Input value={fresh.password} onChange={(e) => setFresh({ ...fresh, password: e.target.value })} className="bg-[#0a0e1a] border-white/10 font-mono" /></Field>
          <Field label="Role">
            <select value={fresh.role} onChange={(e) => setFresh({ ...fresh, role: e.target.value })} className="h-9 w-full rounded-md bg-[#0a0e1a] border border-white/10 px-2 text-sm text-slate-200">
              <option value="editor">Editor</option><option value="admin">Admin</option>
            </select>
          </Field>
          <div className="flex gap-2">
            <Button onClick={create} disabled={saving === "new" || !fresh.name || !fresh.email || !fresh.password} className="bg-cyan-500 hover:bg-cyan-400 text-[#04202a]">{saving === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}</Button>
            <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading people…</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((p) => {
            const draft = drafts[p.id];
            if (!draft) return null;
            const dirty = !same(draft, pick(p));
            const effective = allowedAreas({ ...draft, isFounder: draft.isFounder });
            const custom = Array.isArray(draft.permissions);
            const self = p.id === currentUserId;
            return (
              <div key={p.id} className={cn("rounded-xl border bg-[#111827] p-4", p.isActive ? "border-white/10" : "border-white/5 opacity-60", dirty && "border-cyan-500/40")}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-[220px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{p.name}</span>
                      {draft.isSuperadmin && <Badge className="bg-cyan-500/15 text-cyan-300 border-cyan-500/30">superadmin</Badge>}
                      {self && <Badge variant="outline" className="text-slate-400 border-white/10">you</Badge>}
                      {!p.isActive && <Badge variant="outline" className="text-red-300 border-red-500/30">inactive</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">{p.email}{p.slug ? ` · /e/${p.slug}` : ""}</div>
                  </div>

                  <label className="text-xs text-slate-400 flex items-center gap-1.5">Role
                    <select value={draft.role} disabled={draft.isSuperadmin} onChange={(e) => update(p.id, { role: e.target.value })} className="h-8 rounded-md bg-[#0a0e1a] border border-white/10 px-2 text-sm text-slate-200 disabled:opacity-50">
                      <option value="editor">Editor</option><option value="admin">Admin</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-400 flex items-center gap-1.5">Type
                    <select value={draft.userType ?? "video_editor"} onChange={(e) => update(p.id, { userType: e.target.value })} className="h-8 rounded-md bg-[#0a0e1a] border border-white/10 px-2 text-sm text-slate-200">
                      <option value="video_editor">Video editor</option><option value="creative_strategist">Creative strategist</option><option value="editor">Editor</option>
                    </select>
                  </label>
                  <Toggle label="Founder" checked={draft.isFounder} onChange={(v) => update(p.id, { isFounder: v })} hint="Time Tracker + timer widget" />
                  <Toggle label="Superadmin" checked={draft.isSuperadmin} disabled={self} onChange={(v) => update(p.id, { isSuperadmin: v, ...(v ? { role: "admin" } : {}) })} hint="Manages people and access" />
                  <Toggle label="Active" checked={draft.isActive} disabled={self} onChange={(v) => update(p.id, { isActive: v })} icon={draft.isActive ? UserCheck : UserX} />

                  <div className="ml-auto flex items-center gap-2">
                    {pwFor === p.id ? (
                      <>
                        <Input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" className="h-8 w-44 bg-[#0a0e1a] border-white/10 font-mono text-sm" />
                        <Button size="sm" onClick={() => setPassword(p.id)} disabled={saving === p.id || pw.length < 8}>Set</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setPwFor(null); setPw(""); }}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setPwFor(p.id); setPw(""); }} title="Set a new password"><KeyRound className="h-3.5 w-3.5 mr-1" /> Password</Button>
                    )}
                    <Button size="sm" onClick={() => save(p)} disabled={!dirty || saving === p.id} className={cn(dirty ? "bg-cyan-500 hover:bg-cyan-400 text-[#04202a]" : "")}>
                      {saving === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5 mr-1" /> Save</>}
                    </Button>
                  </div>
                </div>

                {/* Areas */}
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Access</span>
                    {draft.isSuperadmin ? (
                      <span className="text-xs text-cyan-300">Everything, including this page</span>
                    ) : (
                      <div className="flex rounded-md border border-white/10 overflow-hidden text-xs">
                        <button onClick={() => update(p.id, { permissions: null })} className={cn("px-2.5 py-1", !custom ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:bg-white/5")}>Role default ({draft.role})</button>
                        <button onClick={() => update(p.id, { permissions: custom ? draft.permissions : [...effective].filter((k) => k !== "time" && k !== "access") })} className={cn("px-2.5 py-1", custom ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:bg-white/5")}>Custom</button>
                      </div>
                    )}
                    {custom && !draft.isSuperadmin && (
                      <button onClick={() => update(p.id, { permissions: null })} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"><RotateCcw className="h-3 w-3" /> back to role default</button>
                    )}
                  </div>
                  {!draft.isSuperadmin && (
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                      {GROUPS.map((g) => (
                        <div key={g}>
                          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">{g}</div>
                          <div className="space-y-1">
                            {GRANTABLE_AREAS.filter((a) => a.group === g).map((a) => {
                              const on = effective.has(a.key);
                              return (
                                <label key={a.key} className={cn("flex items-center gap-2 text-xs rounded px-1.5 py-1", custom ? "cursor-pointer hover:bg-white/5" : "cursor-default", on ? "text-slate-200" : "text-slate-500")}>
                                  <input type="checkbox" checked={on} disabled={!custom} onChange={(e) => {
                                    const next = new Set(draft.permissions ?? []);
                                    if (e.target.checked) next.add(a.key); else next.delete(a.key);
                                    update(p.id, { permissions: [...next] });
                                  }} className="accent-cyan-500" />
                                  {a.label}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {draft.isFounder && !draft.isSuperadmin && <div className="mt-2 text-[11px] text-slate-500">+ {AREAS.find((a) => a.key === "time")?.label} (founder)</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}{hint && <span className="ml-1 normal-case tracking-normal text-slate-600">({hint})</span>}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled, hint, icon: Icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <label title={hint} className={cn("flex items-center gap-1.5 text-xs select-none", disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer", checked ? "text-slate-200" : "text-slate-500")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="accent-cyan-500" />
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </label>
  );
}
