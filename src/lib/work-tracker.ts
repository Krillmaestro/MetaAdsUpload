import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { Session } from "next-auth";

/** A stop comment shorter than this is rejected — the whole point is knowing what got done. */
export const MIN_NOTE_LENGTH = 10;
export const MAX_NOTE_LENGTH = 2000;
/** Sanity ceiling for a single session (manual entries + forgotten timers). */
export const MAX_SESSION_SECONDS = 24 * 3600;

export type WorkSessionStatus = "running" | "paused" | "done";

export interface WorkSessionRow {
  status: string;
  accumulatedSeconds: number;
  segmentStartedAt: Date | null;
  durationSeconds: number | null;
}

/**
 * Server-authoritative elapsed time. The clock lives in the DB, so a refresh,
 * a second device, or a closed laptop never loses or double-counts time.
 */
export function elapsedSeconds(row: WorkSessionRow, now: Date = new Date()): number {
  if (row.status === "done") return row.durationSeconds ?? row.accumulatedSeconds ?? 0;
  const base = row.accumulatedSeconds ?? 0;
  if (row.status === "running" && row.segmentStartedAt) {
    return base + Math.max(0, Math.floor((now.getTime() - new Date(row.segmentStartedAt).getTime()) / 1000));
  }
  return base;
}

/** Guard for every /api/work route — only flagged founders get in. */
export async function guardFounder(): Promise<
  { session: Session; error: null } | { session: null; error: NextResponse }
> {
  const session = (await auth()) as Session | null;
  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!session.user.isFounder) {
    return { session: null, error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Accepts an ISO string / epoch and returns a Date, or null when unusable. */
export function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}
