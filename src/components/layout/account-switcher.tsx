"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KNOWN_PIXELS } from "@/lib/meta/pixels";

interface Connection {
  id: number;
  adAccounts: Array<{ id: string; name: string; currency: string }>;
  activeAdAccountId: string | null;
  pixelId: string | null;
  isActive: boolean;
}

const act = (id: string | null | undefined) => (!id ? "" : id.startsWith("act_") ? id : `act_${id}`);

/**
 * Sidebar switcher for the active ad account + pixel. One choice per brand
 * ("DogDivaCOmain · LowTide"), plus every other ad account on its own (keeps
 * the current pixel). Admins only — the connection API answers 403 to others
 * and then nothing renders. Applies to everyone using the app, like Settings.
 */
export function AccountSwitcher() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/meta/connection")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setConn(d?.connections?.find((c: Connection) => c.isActive) ?? null))
      .catch(() => {});
  }, []);

  if (!conn || !conn.adAccounts?.length) return null;

  const options: Array<{ value: string; label: string; adAccountId: string; pixelId?: string }> = [];
  for (const a of conn.adAccounts) {
    const presets = KNOWN_PIXELS.filter((p) => act(p.adAccountId) === act(a.id));
    if (presets.length) for (const p of presets) options.push({ value: `${act(a.id)}|${p.id}`, label: `${a.name} · ${p.label}`, adAccountId: a.id, pixelId: p.id });
    else options.push({ value: `${act(a.id)}|`, label: `${a.name} (${a.currency})`, adAccountId: a.id });
  }
  const current =
    options.find((o) => act(o.adAccountId) === act(conn.activeAdAccountId) && o.pixelId === conn.pixelId) ??
    options.find((o) => act(o.adAccountId) === act(conn.activeAdAccountId) && !o.pixelId);
  const currentValue = current?.value ?? "";

  const choose = async (value: string | null) => {
    const opt = options.find((o) => o.value === value);
    if (!opt || opt.value === currentValue) return;
    setSaving(true);
    try {
      const res = await fetch("/api/meta/connection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: conn.id, activeAdAccountId: opt.adAccountId, ...(opt.pixelId ? { pixelId: opt.pixelId } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not switch");
      toast.success(`Switched to ${opt.label}`);
      window.location.reload(); // every page reloads its campaigns/ad sets for the new account
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not switch");
      setSaving(false);
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        Ad account {saving && <Loader2 className="h-3 w-3 animate-spin text-cyan-400" />}
      </div>
      <Select value={currentValue} onValueChange={(v) => choose(v as string | null)} disabled={saving}>
        <SelectTrigger className="h-8 w-full bg-white/5 border-white/10 text-xs">
          <SelectValue placeholder="Choose ad account…">{current?.label ?? "Choose ad account…"}</SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-[#111827] border-white/10">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
