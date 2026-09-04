"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { BreakdownRow } from "@/lib/learning-loop/rows";
import { fmtMoney, fmtNum, fmtPct, fmtX } from "./format";

const DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: "productLine", label: "Produkt" },
  { key: "editorName", label: "Editor" },
  { key: "strategistName", label: "Strateg" },
  { key: "format", label: "Format" },
  { key: "problem", label: "Problem" },
  { key: "angle", label: "Angle" },
  { key: "landing", label: "Landing" },
  { key: "roleLabel", label: "Lager" },
  { key: "adType", label: "Ideation/Iteration" },
];

/**
 * "What is working" — the Evolve hit-rate sheet, but computed from tags and
 * numbers instead of typed in. One tab per dimension; rows sorted by spend
 * because spend is where the account's real bets are.
 */
export function Breakdowns({ breakdowns, currency, targetRoas }: { breakdowns: Record<string, BreakdownRow[]>; currency: string; targetRoas: number }) {
  const [dim, setDim] = useState("productLine");
  const rows = (breakdowns[dim] ?? []).filter((r) => r.tests > 0);
  const maxSpend = Math.max(1, ...rows.map((r) => r.spend));

  return (
    <div className="rounded-xl border border-white/5 bg-[#111827]">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/5 px-3 py-2">
        <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Vad funkar</span>
        {DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDim(d.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              dim === d.key ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/20" : "text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent",
            )}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 text-left font-medium">{DIMENSIONS.find((d) => d.key === dim)?.label}</th>
              <th className="px-2 py-2 text-right font-medium">Tester</th>
              <th className="px-2 py-2 text-right font-medium">Live</th>
              <th className="px-2 py-2 text-right font-medium">Bedömda</th>
              <th className="px-2 py-2 text-right font-medium">Vinnare</th>
              <th className="px-2 py-2 text-right font-medium">Losers</th>
              <th className="px-2 py-2 text-left font-medium w-40">Hit rate</th>
              <th className="px-2 py-2 text-left font-medium w-44">Spend</th>
              <th className="px-2 py-2 text-right font-medium">Köp</th>
              <th className="px-2 py-2 text-right font-medium">ROAS</th>
              <th className="px-3 py-2 text-right font-medium">CPA</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-600">Ingen data</td></tr>
            ) : rows.map((r) => (
              <tr key={r.key} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                <td className={cn("px-3 py-1.5 font-medium", r.key === "—" ? "text-slate-600" : "text-slate-200")}>{r.key === "—" ? "Otaggat" : r.label}</td>
                <td className="px-2 py-1.5 text-right text-slate-300">{r.tests}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{r.live}</td>
                <td className="px-2 py-1.5 text-right text-slate-400">{r.judged}</td>
                <td className="px-2 py-1.5 text-right text-emerald-400">{r.winners}</td>
                <td className="px-2 py-1.5 text-right text-red-400/80">{r.losers}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div className={cn("h-full rounded-full", r.hitRate >= 30 ? "bg-emerald-500" : r.hitRate >= 15 ? "bg-amber-500" : "bg-red-500/70")} style={{ width: `${Math.min(100, r.hitRate)}%` }} />
                    </div>
                    <span className="w-10 text-right text-slate-300">{r.judged > 0 ? fmtPct(r.hitRate, 0) : "–"}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-cyan-500/70" style={{ width: `${(r.spend / maxSpend) * 100}%` }} />
                    </div>
                    <span className="w-20 text-right text-slate-300">{fmtMoney(r.spend, currency)}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-right text-slate-300">{fmtNum(r.purchases)}</td>
                <td className={cn("px-2 py-1.5 text-right font-medium", r.roas >= targetRoas ? "text-emerald-400" : r.roas > 0 ? "text-amber-300" : "text-slate-600")}>{fmtX(r.roas)}</td>
                <td className="px-3 py-1.5 text-right text-slate-300">{r.cpa > 0 ? fmtMoney(r.cpa, currency) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
