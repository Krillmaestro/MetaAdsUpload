// ─── Bonus tiers (single source of truth) ───────────────────────────────────
// A video editor earns a one-time bonus per ad based on the ad's LIFETIME
// cumulative spend + ROAS. An ad qualifies for the highest tier whose BOTH
// thresholds it meets. Tiers are total amounts (not additive): an ad at the
// $50 tier earns $50 total, not $50 on top of $30.
//
//   $10 — $500+ spend  @ 2.5+ ROAS
//   $20 — $1,000+ spend @ 2.5+ ROAS
//   $30 — $3,750+ spend @ 2.0+ ROAS
//   $50 — $7,500+ spend @ 2.0+ ROAS
//
// NOTE: this module is intentionally pure (no DB / no server imports) so it can
// be imported from both client components and API routes.

export interface BonusTier {
  minSpend: number;
  minRoas: number;
  bonus: number;
}

/** Ordered high → low so the first match is the highest qualifying tier. */
export const BONUS_TIERS: BonusTier[] = [
  { minSpend: 7500, minRoas: 2.0, bonus: 50 },
  { minSpend: 3750, minRoas: 2.0, bonus: 30 },
  { minSpend: 1000, minRoas: 2.5, bonus: 20 },
  { minSpend: 500, minRoas: 2.5, bonus: 10 },
];

export interface BonusResult {
  bonus: number;
  tier: number; // the bonus value doubles as the tier id (0 | 10 | 20 | 30 | 50)
  label: string | null;
}

/** Highest tier this (spend, roas) qualifies for. Returns bonus 0 if none. */
export function calculateBonus(spend: number, roas: number, tiers: BonusTier[] = BONUS_TIERS): BonusResult {
  // Evaluate highest-bonus first so the first match is the best tier.
  const ordered = [...tiers].sort((a, b) => b.bonus - a.bonus);
  for (const t of ordered) {
    if (spend >= t.minSpend && roas >= t.minRoas) {
      return {
        bonus: t.bonus,
        tier: t.bonus,
        label: `$${t.bonus} ($${t.minSpend.toLocaleString("en-US")}+ spend, ${t.minRoas}+ ROAS)`,
      };
    }
  }
  return { bonus: 0, tier: 0, label: null };
}

export interface NextTierProgress {
  /** The tier the ad is working toward, or null if already at the top. */
  next: BonusTier | null;
  /** Current locked bonus value. */
  current: number;
  /** Spend progress toward the next tier, 0–1. */
  spendProgress: number;
  /** Whether the ROAS requirement for the next tier is currently met. */
  roasMet: boolean;
  /** Human hint, e.g. "$220 / $500 spend · ROAS 2.6x ✓". */
  hint: string;
}

/**
 * Progress toward the next bonus tier above the current locked one.
 * Used to render the "X to next bonus" bar on the editor dashboard.
 */
export function nextTierProgress(spend: number, roas: number, lockedBonus = 0, tiers: BonusTier[] = BONUS_TIERS): NextTierProgress {
  const current = Math.max(lockedBonus, calculateBonus(spend, roas, tiers).bonus);
  const candidates = tiers.filter((t) => t.bonus > current);

  if (candidates.length === 0) {
    return { next: null, current, spendProgress: 1, roasMet: true, hint: "Top tier reached 🎉" };
  }

  // Pick the most ACHIEVABLE next tier, not just the next-highest payout.
  // A "slow winner" at 2.0–2.4 ROAS can't reach $10/$20 (need 2.5) but is on
  // track for $30/$50 (need 2.0). Prefer tiers whose ROAS is already met
  // (reachable by spend alone), nearest by spend; otherwise the tier with the
  // smallest ROAS gap.
  const met = candidates.filter((t) => roas >= t.minRoas).sort((a, b) => a.minSpend - b.minSpend);
  const next = met.length
    ? met[0]
    : [...candidates].sort((a, b) => a.minRoas - b.minRoas || a.minSpend - b.minSpend)[0];

  const spendProgress = Math.min(spend / next.minSpend, 1);
  const roasMet = roas >= next.minRoas;
  const hint = `$${Math.round(spend).toLocaleString("en-US")} / $${next.minSpend.toLocaleString(
    "en-US"
  )} spend · ROAS ${roas.toFixed(2)}x ${roasMet ? "✓" : `(needs ${next.minRoas}x)`}`;

  return { next, current, spendProgress, roasMet, hint };
}

export interface BonusReadiness extends NextTierProgress {
  /** Ranking score — higher is closer to earning. See `bonusReadiness`. */
  score: number;
  /** What is actually standing in the way. */
  blocker: "none" | "spend" | "roas" | "both";
  /** One short line in Swedish: what it takes from here. */
  requirement: string;
  /** Spend still needed for the next tier, 0 when already past it. */
  spendGap: number;
}

/**
 * How close an ad set is to its next bonus, and what is missing.
 *
 * Ranking rule that matters: an ad set whose ROAS requirement is ALREADY MET
 * only needs more spend — that is money almost in hand, and delivery alone
 * gets it there. It must always outrank a high-spend ad set sitting at 0.8
 * ROAS, which cannot reach the tier at all without the campaign turning
 * around. Sorting on spend alone (the old behaviour) buried the first group
 * beneath the second.
 *
 * So every ROAS-met ad set scores above every ROAS-short one, and within each
 * group the nearest by spend comes first.
 */
export function bonusReadiness(
  spend: number,
  roas: number,
  lockedBonus = 0,
  tiers: BonusTier[] = BONUS_TIERS
): BonusReadiness {
  const prog = nextTierProgress(spend, roas, lockedBonus, tiers);

  if (!prog.next) {
    return { ...prog, score: Number.MAX_SAFE_INTEGER, blocker: "none", requirement: "Högsta nivån nådd 🎉", spendGap: 0 };
  }

  const spendGap = Math.max(0, prog.next.minSpend - spend);
  const spendMet = spendGap === 0;
  const blocker: BonusReadiness["blocker"] =
    prog.roasMet && spendMet ? "none" : prog.roasMet ? "spend" : spendMet ? "roas" : "both";

  const money = (n: number) => `$${Math.round(n).toLocaleString("sv-SE")}`;
  const requirement =
    blocker === "none"
      ? "Kvalificerad — låses vid nästa uppdatering"
      : blocker === "spend"
        ? `Behöver ${money(spendGap)} mer spend — ROAS klar`
        : blocker === "roas"
          ? `Spend klar — behöver ROAS ${prog.next.minRoas}x (nu ${roas.toFixed(2)}x)`
          : `Behöver ${money(spendGap)} mer spend och ROAS ${prog.next.minRoas}x (nu ${roas.toFixed(2)}x)`;

  // Two bands that never overlap: ROAS-met ad sets occupy 1000+, the rest stay
  // below it however much they have spent.
  const score = prog.roasMet
    ? 1000 + prog.spendProgress * 1000
    : prog.spendProgress * 100 * Math.min(roas / prog.next.minRoas, 1);

  return { ...prog, score, blocker, requirement, spendGap };
}

/** Sort helper: closest to a bonus first. */
export function byBonusReadiness<T>(
  get: (item: T) => { spend: number; roas: number; locked?: number },
  tiers: BonusTier[] = BONUS_TIERS
) {
  return (a: T, b: T) => {
    const A = get(a), B = get(b);
    return (
      bonusReadiness(B.spend, B.roas, B.locked ?? 0, tiers).score -
      bonusReadiness(A.spend, A.roas, A.locked ?? 0, tiers).score
    );
  };
}

/** Tailwind classes for a bonus badge by tier value. Matches the existing palette. */
export function bonusTierColor(bonus: number): string {
  if (bonus >= 50) return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  if (bonus >= 30) return "bg-purple-500/10 text-purple-400 border-purple-500/20";
  if (bonus >= 20) return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (bonus >= 10) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  return "bg-white/5 text-slate-400 border-white/10";
}

/** Convert a display name to a URL-safe public slug (e.g. "Fervin Berg" → "fervin-berg"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[åä]/g, "a") // å ä
    .replace(/ö/g, "o") // ö
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip remaining combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
