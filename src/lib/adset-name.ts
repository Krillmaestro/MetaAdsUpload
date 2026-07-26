// Ad-set name parser.
//
// The team names ad sets to a convention:
//
//   {LAND} {Editor} {Batch} - #{v} - {FORMAT} - {LANDING} - {OFFER} - {PROBLEM} - {STRATEGIST}
//   e.g. "SE Krille Jun23 - #0 - STATIC - LP1 + LP3 - Evergreen - ItchySkin - Krille"
//
// Real names drift from it constantly — missing country, doubled spaces, a
// stray "– kopia" suffix, "PP+LP" without spaces, one-off names like
// "Native #3 PP" or "Jethro Test Task LP1 + PP". So this parses defensively:
// every field is independently optional, and a field is only returned when the
// name actually supports it. Guessing an editor is worse than returning null,
// because a wrong auto-assignment silently pays the wrong person.
//
// Editor vs strategist is the one genuinely ambiguous part — "Krille" and
// "Oskar" appear in both roles. The convention puts the EDITOR in the first
// segment (right after the country code) and the STRATEGIST last, so position
// decides, never a bare name match.

export type AdFormat = "VSL" | "UGC" | "STATIC" | "ANIME" | "NON_NARRATED";

export const AD_FORMATS: { key: AdFormat; label: string; patterns: RegExp }[] = [
  { key: "VSL", label: "VSL", patterns: /^vsl$/i },
  { key: "UGC", label: "UGC", patterns: /^ugc$/i },
  { key: "STATIC", label: "Static", patterns: /^static$/i },
  { key: "ANIME", label: "Anime", patterns: /^anime$/i },
  { key: "NON_NARRATED", label: "Non narrated", patterns: /^non[\s-]?narrated$/i },
];

export type ParsedAdsetName = {
  country: string | null;
  /** Matched against the known-editor list — never a free-text guess. */
  editor: string | null;
  batch: string | null;
  version: number | null;
  format: AdFormat | null;
  /** Destinations in the order written: ["LP6", "LP12"], ["PP"], ["LP", "PP"]. */
  landing: string[];
  offer: string | null;
  problem: string | null;
  strategist: string | null;
  /** True when nothing beyond a bare name could be read — worth surfacing in the UI. */
  unparsed: boolean;
};

const COUNTRIES = ["USA", "US", "SE", "UK", "AU", "CA", "NZ", "BIG5"];

/** Batch token: a month abbreviation followed by digits — "Jul10", "Jun183", "Mar171". */
const BATCH = /^(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)\d+$/i;

/** Landing token: PP, LP, LP6, LP#2, 5R. */
const LANDING = /^(pp|lp#?\d*|\d+r)$/i;

const NOISE = /\s*[–—-]\s*kopia\s*/gi;

function clean(raw: string): string {
  return raw.replace(NOISE, " ").replace(/\s+/g, " ").trim();
}

/** Split on " - " / " – " separators, tolerating missing spaces around them. */
function segments(name: string): string[] {
  return name
    .split(/\s+[-–—]\s+|\s+[-–—]|[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchFormat(token: string): AdFormat | null {
  const t = token.trim();
  return AD_FORMATS.find((f) => f.patterns.test(t))?.key ?? null;
}

function landingFrom(segment: string): string[] {
  return segment
    .split(/[+,/]/)
    .map((p) => p.trim())
    .filter((p) => LANDING.test(p))
    .map((p) => p.toUpperCase().replace("#", ""));
}

/**
 * @param name       the ad set name as it appears in Meta
 * @param knownEditors editor display names to match against (case-insensitive)
 */
export function parseAdsetName(name: string, knownEditors: string[] = []): ParsedAdsetName {
  const out: ParsedAdsetName = {
    country: null, editor: null, batch: null, version: null,
    format: null, landing: [], offer: null, problem: null,
    strategist: null, unparsed: true,
  };
  if (!name?.trim()) return out;

  const cleaned = clean(name);
  const segs = segments(cleaned);
  if (segs.length === 0) return out;

  const editorLookup = new Map(knownEditors.map((e) => [e.toLowerCase(), e]));

  // ── Segment 0: [COUNTRY] EDITOR [BATCH] ──────────────────────────────────
  const head = segs[0].split(/\s+/).filter(Boolean);
  let cursor = 0;

  if (head[cursor] && COUNTRIES.includes(head[cursor].toUpperCase())) {
    out.country = head[cursor].toUpperCase() === "US" ? "USA" : head[cursor].toUpperCase();
    cursor++;
  }
  if (head[cursor]) {
    const hit = editorLookup.get(head[cursor].toLowerCase());
    if (hit) {
      out.editor = hit;
      cursor++;
    }
  }
  if (head[cursor] && BATCH.test(head[cursor])) {
    out.batch = head[cursor];
    cursor++;
  }

  // Editor not in the head (no country prefix, odd ordering) — scan the rest of
  // the head only. Never the tail: the last segment is the strategist, and the
  // same person can hold both roles.
  if (!out.editor) {
    for (const token of head) {
      const hit = editorLookup.get(token.toLowerCase());
      if (hit) { out.editor = hit; break; }
    }
  }
  if (!out.batch) {
    const b = head.find((t) => BATCH.test(t));
    if (b) out.batch = b;
  }

  // ── Remaining segments, matched by shape rather than fixed position ───────
  const rest = segs.slice(1);
  const consumed = new Set<number>();

  rest.forEach((seg, i) => {
    const v = seg.match(/^#(\d+)$/);
    if (v && out.version === null) {
      out.version = Number(v[1]);
      consumed.add(i);
      return;
    }
    const f = matchFormat(seg);
    if (f && !out.format) {
      out.format = f;
      consumed.add(i);
      return;
    }
    const land = landingFrom(seg);
    if (land.length && out.landing.length === 0) {
      out.landing = land;
      consumed.add(i);
    }
  });

  // Whatever is left, in order: offer, problem, strategist. The strategist is
  // the last leftover only when it names someone we know; otherwise that slot
  // was never written and the value belongs to problem.
  const leftovers = rest.map((s, i) => ({ s, i })).filter(({ i }) => !consumed.has(i)).map(({ s }) => s);

  if (leftovers.length) {
    const last = leftovers[leftovers.length - 1];
    const isPerson = editorLookup.has(last.toLowerCase()) || /^[A-Za-zÅÄÖåäö]+$/.test(last);
    if (leftovers.length >= 3 && isPerson) {
      out.offer = leftovers[0];
      out.problem = leftovers[leftovers.length - 2];
      out.strategist = last;
    } else if (leftovers.length === 2) {
      out.offer = leftovers[0];
      out.problem = leftovers[1];
    } else if (leftovers.length === 1) {
      out.problem = leftovers[0];
    } else {
      out.offer = leftovers[0];
      out.problem = leftovers[1];
      out.strategist = last;
    }
  }

  // One-off names carry no " - " separators at all ("Native #3 PP",
  // "Jemar Test LP1 + LP3"), so everything landed in the head. Sweep the whole
  // name for the two fields that are unambiguous wherever they appear.
  if (out.landing.length === 0) {
    out.landing = landingFrom(cleaned.replace(/\s+/g, " ").split(/\s+/).join(" + "));
  }
  if (!out.format) {
    for (const token of cleaned.split(/\s+/)) {
      const f = matchFormat(token);
      if (f) { out.format = f; break; }
    }
  }

  out.unparsed = !out.editor && !out.format && out.landing.length === 0 && !out.problem;
  return out;
}

/** Human-readable summary for the UI — only the fields that were actually read. */
export function describeParse(p: ParsedAdsetName): string {
  const bits: string[] = [];
  if (p.editor) bits.push(p.editor);
  if (p.format) bits.push(AD_FORMATS.find((f) => f.key === p.format)?.label ?? p.format);
  if (p.problem) bits.push(p.problem);
  if (p.landing.length) bits.push(p.landing.join(" + "));
  return bits.join(" · ") || "kunde inte tolkas";
}
