// Derivations from names.
//
// Meta has no "product" or "campaign role" field — the team encodes both in
// campaign and ad set names ("ProBiotics // ABO", "[GY] SE Fervin Aug22 …"),
// so this is the one place those conventions are read. Everything here is a
// pure function of strings so it can be unit-tested and reused by the sync,
// the API and the auto-linker alike.

export type CampaignRole = "testing" | "scaling" | "bof" | "graveyard" | "other";

export const CAMPAIGN_ROLE_LABEL: Record<CampaignRole, string> = {
  testing: "Testing",
  scaling: "Scaling",
  bof: "BOF",
  graveyard: "Graveyard",
  other: "Övrigt",
};

/** Which layer of the account structure an ad set lives in. */
export function campaignRole(
  campaignName: string | null | undefined,
  adsetName: string | null | undefined,
): CampaignRole {
  const a = (adsetName ?? "").trim();
  const c = campaignName ?? "";
  // Graveyard copies are prefixed in the ad set name even inside other campaigns.
  if (/^\[?gy\]?\s/i.test(a) || /^\[gy\]/i.test(a)) return "graveyard";
  if (/graveyard|zombie|cost\s?cap/i.test(c)) return "graveyard";
  if (/\bbof\b/i.test(c)) return "bof";
  if (/scaling/i.test(c)) return "scaling";
  if (/\babo\b/i.test(c)) return "testing";
  if (/\bcbo\b|bidcap|adv\+|advantage/i.test(c)) return "scaling";
  return "other";
}

const PRODUCT_RULES: Array<{ re: RegExp; name: string }> = [
  { re: /katt.?munh|munh[äa]lsa.*katt|meow/i, name: "Munhälsa Katt" },
  { re: /munh|oral|tandv|dental/i, name: "Munhälsa" },
  { re: /probiot|\bprb\b|gut ?health/i, name: "Probiotika" },
  { re: /allergi|kl[åa]da|\bitch|allergy|skin\s*&?\s*coat/i, name: "Allergi & Klåda" },
  { re: /calming|nattro|\bsleep|lugn|nightease/i, name: "Calming" },
  { re: /\bled(?:tillskott)?\b|joint/i, name: "Ledtillskott" },
  { re: /diva ?digest|digestive/i, name: "Diva Digest" },
  { re: /f[äa]sting|\btick/i, name: "Fästinghalsband" },
];

/** Product line read from the campaign name first, then the ad set name. */
export function productLine(
  campaignName: string | null | undefined,
  adsetName: string | null | undefined,
): string | null {
  for (const src of [campaignName ?? "", adsetName ?? ""]) {
    if (!src) continue;
    for (const rule of PRODUCT_RULES) if (rule.re.test(src)) return rule.name;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTH_ALIASES: Record<string, number> = { may: 4, oct: 9 };

export function monthIndex(token: string): number {
  const t = token.toLowerCase();
  if (t in MONTH_ALIASES) return MONTH_ALIASES[t];
  return MONTHS.indexOf(t);
}

export interface BatchToken {
  raw: string;
  month: number; // 0-11
  batch: number;
  sub: number | null; // "Jun49.15" → 15
  version: number | null; // "Aug14.V2" / "Aug11v3" → 2 / 3
}

const BATCH_RE = /\b(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)(\d+)(?:\.(\d+))?(?:\.?v(\d+))?/i;

/**
 * Lenient batch token reader for MATCHING (not for bonuses): accepts the
 * sub-versions the strict parser refuses — "Aug14.V2", "Apr92.2", "May154.1",
 * "Aug11v3" — because the assignment they came from still has batch 14 / 92 /
 * 154 / 11.
 */
export function extractBatchToken(name: string | null | undefined): BatchToken | null {
  if (!name) return null;
  const m = name.match(BATCH_RE);
  if (!m) return null;
  return {
    raw: m[0],
    month: monthIndex(m[1]),
    batch: Number(m[2]),
    sub: m[3] ? Number(m[3]) : null,
    version: m[4] ? Number(m[4]) : null,
  };
}

/** Map the assignment's free-text format name onto the ad-set-name parser's keys. */
export function formatKeyFromName(formatName: string | null | undefined): string | null {
  if (!formatName) return null;
  const f = formatName.toLowerCase();
  if (/static|image|bild/.test(f)) return "STATIC";
  if (/vsl/.test(f)) return "VSL";
  if (/ugc/.test(f)) return "UGC";
  if (/anime/.test(f)) return "ANIME";
  if (/non/.test(f)) return "NON_NARRATED";
  return null;
}

/** "PP + 5R" / "LP12+PP" → ["PP", "5R"] — same normalisation as the parser. */
export function landingTokens(landing: string | null | undefined): string[] {
  if (!landing) return [];
  return landing
    .split(/[+,/]/)
    .map((p) => p.trim().toUpperCase().replace("#", ""))
    .filter(Boolean);
}

export function normalizeTag(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9åäö]/g, "");
}

// ─── Creative identity ───────────────────────────────────────────────────────
// Ad names start with the hook variant ("H2 SE Fervin Aug22 - …"). H1 and H2
// are different videos, so the hook stays part of the creative's identity;
// only copy/landing-page suffixes the app or Meta append are stripped.

const HOOK_RE = /^\s*(H\d+)\b[\s:._-]*/i;

export function hookLabelFromName(name: string | null | undefined): string | null {
  const m = (name ?? "").match(HOOK_RE);
  return m ? m[1].toUpperCase() : null;
}

/** Name without the leading hook token — what the ad-set-name parser expects. */
export function stripHookLabel(name: string | null | undefined): string {
  return (name ?? "").replace(HOOK_RE, "").trim();
}

/**
 * Normalised name used to recognise the same creative across ad sets:
 * "X – kopia", "X - kopia 2", "X LP2" (the uploader's landing-page suffix)
 * all fold into "x".
 */
export function normalizeCreativeName(name: string | null | undefined): string {
  return (name ?? "")
    .replace(/\s*[–—-]\s*kopia(\s*\d+)?\s*$/gi, "")
    .replace(/\s+LP\d+\s*$/i, "")
    .replace(/\.(mp4|mov|jpg|jpeg|png|webp)$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Text for the creative's script: the brief's hook variant (by label) + body. */
export function scriptTextFor(
  script: { hooks: Array<{ id: string; label: string; eng: string; se: string }>; body: { eng: string; se: string } } | null | undefined,
  hookLabel: string | null,
): string | null {
  if (!script) return null;
  const hook = (hookLabel && script.hooks.find((h) => h.label.toUpperCase() === hookLabel.toUpperCase())) || script.hooks.find((h) => h.se || h.eng) || null;
  const parts: string[] = [];
  if (hook && (hook.se || hook.eng)) parts.push(`${hook.label}: ${hook.se || hook.eng}`);
  if (script.body.se || script.body.eng) parts.push(script.body.se || script.body.eng);
  return parts.length ? parts.join("\n\n") : null;
}

/**
 * Loose identity for matching an AD to the FILE it was made from. File names
 * are written before launch ("… - TBD - …"), ad names after (with the landing
 * page filled in), so only the parts that never change are compared: hook,
 * editor, batch token and format. Two ads of the same hook/batch/format are
 * the same video with different links.
 */
export function looseMediaKey(nameOrFilename: string | null | undefined): string | null {
  if (!nameOrFilename) return null;
  const t = nameOrFilename
    .replace(/^\d{10,}-/, "")
    .replace(/\.(mp4|mov|webm|jpg|jpeg|png|webp)$/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hook = t.match(/^(H\d+)\b/i)?.[1]?.toUpperCase() ?? "";
  const batch = t.match(/\b(jan|feb|mar|apr|maj|may|jun|jul|aug|sep|okt|oct|nov|dec)\d+(?:\.\d+)?(?:\.?v\d+)?/i)?.[0]?.toLowerCase() ?? "";
  if (!batch) return null;
  const editor = t.match(/\b(SE|USA|US|UK|AU)\s+([A-Za-zÅÄÖåäö]+)/)?.[2]?.toLowerCase() ?? t.split(" ")[1]?.toLowerCase() ?? "";
  const fmt = t.match(/\b(VSL|UGC|STATIC|ANIME|Non narrated|NON_NARRATED)\b/i)?.[1]?.toLowerCase().replace("_", " ") ?? "";
  return `${hook}|${editor}|${batch}|${fmt}`;
}
