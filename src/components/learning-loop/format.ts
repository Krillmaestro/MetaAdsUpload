// Number formatting shared by the Learning Loop UI. Money follows the ad
// account's currency (SEK for Glimmora, USD for DogDivaCO).

export function fmtMoney(n: number, currency: string, digits = 0): string {
  if (!Number.isFinite(n)) return "–";
  const cur = currency || "SEK";
  try {
    return new Intl.NumberFormat(cur === "SEK" ? "sv-SE" : "en-US", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: digits,
      minimumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString("sv-SE")} ${cur}`;
  }
}

export function fmtNum(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return "–";
  return n.toLocaleString("sv-SE", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtX(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "–";
  return `${n.toFixed(2)}x`;
}

export function fmtPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  return `${n.toFixed(digits)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "–" : d.toLocaleDateString("sv-SE");
}

export const VERDICT_CONFIG: Record<string, { label: string; short: string; color: string; bg: string; border: string }> = {
  confirmed_winner: { label: "Vinnare", short: "W", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
  loser: { label: "Loser", short: "L", color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  iterate: { label: "Iterera", short: "I", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  inconclusive: { label: "Oklart", short: "?", color: "text-slate-400", bg: "bg-white/5", border: "border-white/10" },
};

export const OUTCOME_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  winner: { label: "Vinnare", color: "text-emerald-400", bg: "bg-emerald-500/10" },
  loser: { label: "Loser", color: "text-red-400", bg: "bg-red-500/10" },
  judged: { label: "Bedömd", color: "text-blue-400", bg: "bg-blue-500/10" },
  learning: { label: "Lär sig", color: "text-slate-400", bg: "bg-white/5" },
};

export const ROLE_CONFIG: Record<string, { color: string; bg: string }> = {
  testing: { color: "text-cyan-300", bg: "bg-cyan-500/10" },
  scaling: { color: "text-violet-300", bg: "bg-violet-500/10" },
  bof: { color: "text-amber-300", bg: "bg-amber-500/10" },
  graveyard: { color: "text-slate-400", bg: "bg-white/5" },
  other: { color: "text-slate-500", bg: "bg-white/5" },
};

export const AWARENESS_LEVELS: Array<{ value: string; label: string }> = [
  { value: "unaware", label: "Unaware" },
  { value: "problem_aware", label: "Problem aware" },
  { value: "solution_aware", label: "Solution aware" },
  { value: "product_aware", label: "Product aware" },
  { value: "most_aware", label: "Most aware" },
];

export const STATUS_LABEL: Record<string, string> = {
  draft: "Utkast",
  ready_for_editing: "Redo för klipp",
  editing_now: "Klipps",
  ready_for_review: "Granskning",
  revision: "Revision",
  ready_for_posting: "Redo att posta",
  posted: "Postad",
};
