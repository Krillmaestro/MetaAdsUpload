"use client";

import { useState } from "react";
import { Loader2, Info, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { payloadSchema, type Snapshot } from "@/lib/logrocket-types";

/**
 * Saves a new LogRocket version.
 *
 * Why this is a paste box and not a "fetch now" button: LogRocket publishes no
 * REST API for querying sessions, metrics or issues. What exists is the MCP
 * server (OAuth through claude.ai, so unreachable from a server), the Highlights
 * API (per-identified-user AI summaries only) and Streaming Data Export (a paid
 * add-on that pushes raw events to a warehouse on an hourly schedule). None of
 * them answers "give me this project's aggregates on demand".
 *
 * So the pull runs in a Gene session against the MCP server, and its result is
 * POSTed here — either by Gene directly or pasted below. The moment Streaming
 * Data Export lands in this app's Postgres, this dialog gets a real fetch button
 * and the paste box becomes the fallback.
 */

const CURL_HINT = `POST /api/logrocket/snapshots
{ "label": "...", "source": "mcp", "payload": { ... } }`;

export function SnapshotImportDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (snapshot: Snapshot) => void;
}) {
  const [label, setLabel] = useState("");
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function save() {
    setProblems([]);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      setProblems(["Texten är inte giltig JSON."]);
      return;
    }

    // Accept both a bare payload and a full { payload } envelope.
    const candidate =
      parsedJson && typeof parsedJson === "object" && "payload" in parsedJson
        ? (parsedJson as { payload: unknown }).payload
        : parsedJson;

    const check = payloadSchema.safeParse(candidate);
    if (!check.success) {
      setProblems(
        check.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(rot)"} — ${i.message}`)
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/logrocket/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined, source: "manual", payload: check.data }),
      });
      const body = await res.json();
      if (!res.ok) {
        setProblems([body?.error ?? "Kunde inte spara versionen."]);
        return;
      }
      toast.success("Ny version sparad");
      setRaw("");
      setLabel("");
      onSaved(body as Snapshot);
    } catch {
      setProblems(["Nätverksfel — versionen sparades inte."]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl border-white/10 bg-[#111827] text-slate-200">
        <DialogHeader>
          <DialogTitle className="text-white">Hämta ny data</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="text-[11px] leading-relaxed text-slate-300">
            <p className="font-semibold text-white">LogRocket har inget API att hämta det här ifrån.</p>
            <p className="mt-1 text-slate-400">
              Det finns ingen endpoint för att fråga ut sessioner, mätvärden eller issues. MCP-servern kräver
              inloggning via claude.ai, Highlights-API:t ger bara sammanfattningar per identifierad användare, och
              Streaming Data Export är ett betalt tillägg som pushar råa events till ett datalager en gång i timmen.
            </p>
            <p className="mt-1.5 text-slate-400">
              Så hämtningen körs i en Gene-session och resultatet sparas här. Säg{" "}
              <span className="font-medium text-slate-200">“uppdatera LogRocket”</span> så postar Gene en ny version
              direkt — eller klistra in den nedan.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="lr-label" className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Namn på versionen (valfritt)
            </label>
            <Input
              id="lr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="t.ex. efter ears1-fixen"
              className="mt-1.5 border-white/10 bg-white/5 text-sm text-white placeholder:text-slate-600"
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="lr-json" className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Payload (JSON)
              </label>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(CURL_HINT);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex items-center gap-1 text-[10px] text-slate-500 transition-colors hover:text-slate-300"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                kopiera endpoint
              </button>
            </div>
            <textarea
              id="lr-json"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              spellCheck={false}
              rows={12}
              placeholder='{ "source": { "project": "jwaz0o / smalldogco", … }, "sessionsPerDay": [ … ] }'
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0f1629] p-3 font-mono text-[11px] leading-relaxed text-slate-200 outline-none placeholder:text-slate-700 focus-visible:ring-1 focus-visible:ring-cyan-400"
            />
            <p className="mt-1.5 text-[10px] text-slate-600">
              Både en ren payload och ett helt {"{ payload: … }"}-objekt fungerar. Inget skrivs över — varje sparning
              blir en ny version.
            </p>
          </div>

          {problems.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3">
              {problems.map((p) => (
                <li key={p} className="font-mono text-[11px] leading-relaxed text-red-300">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !raw.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-[#04202a] transition-colors hover:bg-cyan-400 disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Spara som ny version
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
