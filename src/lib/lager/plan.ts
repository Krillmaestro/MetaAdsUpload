/**
 * Expected demand on top of the normal daily rate. Sales history cannot see a campaign
 * that has not happened yet, so the planned ones are written down here and the forecast
 * multiplies the daily rate with them. Edit this list when the campaign calendar changes.
 */
export type DemandWindow = { from: string; to: string; factor: number; label: string; codes?: string[] };

export const DEMAND_PLAN: DemandWindow[] = [
  { from: "2026-11-18", to: "2026-11-26", factor: 1.25, label: "Tidig Black Week" },
  { from: "2026-11-27", to: "2026-12-01", factor: 2.5, label: "Black Friday–Cyber Monday" },
  // The lamp is a free gift at three jars until 4 January; after that only paid sales remain.
  { from: "2027-01-05", to: "2099-12-31", factor: 0.1, label: "LED-gåvan slutar 4 jan", codes: ["LED"] },
];

export const HORIZON_DAYS = 540;
const DAY = 86400_000;

export const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function demandFactor(code: string, day: string): number {
  const w = DEMAND_PLAN.find((x) => day >= x.from && day <= x.to && (!x.codes || x.codes.includes(code)));
  return w?.factor ?? 1;
}

/** cum[n] = expected units leaving during the next n days, starting today. */
export function cumulativeDemand(code: string, rate: number, today: string, days = HORIZON_DAYS): number[] {
  const cum = [0];
  for (let i = 0; i < days; i++) cum.push(cum[i] + rate * demandFactor(code, addDays(today, i)));
  return cum;
}

/**
 * The day index on which stock runs out, or null when it lasts the whole horizon.
 * Arrivals count from their own day, so an open order only helps once it has landed.
 */
export function stockoutDay(cum: number[], supply: number, arrivals: { day: number; units: number }[] = []): number | null {
  for (let i = 1; i < cum.length; i++) {
    const landed = arrivals.reduce((n, a) => (a.day <= i - 1 ? n + a.units : n), 0);
    if (cum[i] > supply + landed) return i - 1;
  }
  return null;
}
