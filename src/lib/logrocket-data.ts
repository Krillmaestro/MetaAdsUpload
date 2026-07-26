// LogRocket behaviour analysis for SmallDogCO (thesmalldogco.com).
//
// Pulled from LogRocket org `jwaz0o` / project `smalldogco` on 2026-07-26.
// Everything here is observed data — no estimates, no modelled numbers. When a
// figure could not be measured, the field says so rather than carrying a guess.
//
// THREE CAVEATS GOVERN EVERY NUMBER BELOW. They are rendered at the top of the
// page for a reason; without them the data reads as the opposite of the truth:
//
//  1. Recording started 2026-07-21. "Last 30 days" is really 6 days.
//  2. Shopify checkout is off-domain and is NOT recorded. LogRocket can never
//     see a purchase — "0 conversions" is a measurement artefact, not a result.
//     Purchases are verified in Shopify/Meta.
//  3. Network- and element-based filters only collect going forward, so
//     historical add-to-cart rates cannot be recovered retroactively.
//
// Session totals disagree between LogRocket's own aggregates (528/533/555/720
// for the same window) and a meaningful share of Chrome/Windows traffic is bots
// and Meta link-crawlers. Never read a raw session count as "visitors".

export const SOURCE = {
  project: "jwaz0o / smalldogco",
  site: "thesmalldogco.com",
  pulledAt: "2026-07-26",
  windowStart: "2026-07-21",
  windowEnd: "2026-07-26",
  recordedDays: 6,
} as const;

export const CAVEATS: { title: string; body: string }[] = [
  {
    title: "Datan börjar 21 juli",
    body: "LogRocket började spela in 21/7. “Senaste 30 dagarna” är i praktiken 6 dagar. Jämför aldrig mot en period som saknar data.",
  },
  {
    title: "Checkout spelas inte in",
    body: "Shopify-checkout ligger på annan domän. LogRocket kan aldrig se ett köp — “0 konverteringar” är mätartefakt. Köp verifieras i Shopify/Meta.",
  },
  {
    title: "Sessioner ≠ besökare",
    body: "Aggregaten spretar (528–720 för samma period) och en stor del av Chrome/Windows-trafiken är bottar och Metas link-crawlers.",
  },
];

/* ── Volume ─────────────────────────────────────────────────────────────── */

export type DayPoint = { day: string; label: string; sessions: number; partial?: boolean };

export const SESSIONS_PER_DAY: DayPoint[] = [
  { day: "2026-07-21", label: "21/7", sessions: 48 },
  { day: "2026-07-22", label: "22/7", sessions: 77 },
  { day: "2026-07-23", label: "23/7", sessions: 117 },
  { day: "2026-07-24", label: "24/7", sessions: 181 },
  { day: "2026-07-25", label: "25/7", sessions: 116 },
  { day: "2026-07-26", label: "26/7", sessions: 31, partial: true },
];

/* ── Environment ────────────────────────────────────────────────────────── */

export type Row = { label: string; value: number; note?: string };

/** Three groups, so the stacked bar stays inside the all-pairs-validated set. */
export const ENVIRONMENT_GROUPS: Row[] = [
  { label: "In-app (Facebook + Instagram)", value: 313 },
  { label: "Riktig webbläsare", value: 220 },
  { label: "Ej identifierad", value: 22 },
];

export const BROWSERS: Row[] = [
  { label: "Facebook in-app", value: 277 },
  { label: "Chrome", value: 158, note: "mycket bot" },
  { label: "Mobile Safari", value: 39 },
  { label: "Instagram in-app", value: 36 },
  { label: "Ej identifierad", value: 22 },
  { label: "Övriga", value: 23, note: "Safari, Samsung, Firefox, Edge m.fl." },
];

export const OPERATING_SYSTEMS: Row[] = [
  { label: "iOS", value: 266 },
  { label: "Android", value: 115 },
  { label: "Windows", value: 111 },
  { label: "Mac OS", value: 28 },
  { label: "Linux", value: 8 },
];

/* ── Attention ──────────────────────────────────────────────────────────── */

/** Ordered bins — an ordinal ramp is the correct encoding here, not categorical. */
export const SESSION_LENGTH: Row[] = [
  { label: "under 5 sek", value: 170 },
  { label: "5–30 sek", value: 180 },
  { label: "30–120 sek", value: 163 },
  { label: "över 120 sek", value: 42 },
];

/* ── Pages ──────────────────────────────────────────────────────────────── */

export type PageRow = {
  path: string;
  role: string;
  sessions: number;
  clickSessions: number | null;
  ctaClicks: number | null;
  /** Share of click-sessions that pressed the page's main CTA. */
  ctaShare: number | null;
  status: "good" | "warning" | "critical" | "neutral";
  note: string;
};

export const PAGES: PageRow[] = [
  {
    path: "/products/small-dog-co-itch-relief",
    role: "PDP",
    sessions: 158,
    clickSessions: 60,
    ctaClicks: 35,
    ctaShare: 35 / 60,
    status: "good",
    note: "Starkaste sidan vi har. 58 % av klickande sessioner trycker huvud-CTA:n.",
  },
  {
    path: "/pages/listicle1",
    role: "Listicle",
    sessions: 126,
    clickSessions: 44,
    ctaClicks: 6,
    ctaShare: 6 / 44,
    status: "warning",
    note: "Håller uppmärksamhet men läcker till CTA — de klickar på texten, inte på knappen.",
  },
  {
    path: "/pages/itch2",
    role: "Symptomdörr",
    sessions: 41,
    clickSessions: null,
    ctaClicks: null,
    ctaShare: null,
    status: "neutral",
    note: "För lite volym för slutsats.",
  },
  {
    path: "/pages/ears1",
    role: "Symptomdörr",
    sessions: 37,
    clickSessions: null,
    ctaClicks: null,
    ctaShare: null,
    status: "critical",
    note: "Tekniskt trasig — produktformulär och cart initieras aldrig. Pausa spend.",
  },
];

/* ── Clicks ─────────────────────────────────────────────────────────────── */

export const CLICKS_SITEWIDE: Row[] = [
  { label: "CALM MY DOG'S ITCH", value: 79, note: "huvud-CTA" },
  { label: "TRY IT TODAY", value: 34, note: "sekundär CTA" },
  { label: "Small-Dog Health · 5 min read…", value: 22 },
  { label: "MADE ONLY FOR DOGS 2–25 LBS…", value: 18 },
  { label: "1-Month Itch Relief 34% OFF…", value: 13 },
  { label: "FROM NEVER-ENDING ITCHING TO…", value: 13 },
];

export const CLICKS_PDP: Row[] = [
  { label: "CALM MY DOG'S ITCH", value: 35, note: "huvud-CTA" },
  { label: "TRY IT TODAY", value: 11, note: "sekundär CTA" },
  { label: "MADE ONLY FOR DOGS 2–25 LBS…", value: 6 },
  { label: "FAQ: Apoquel/Cytopoint", value: 4 },
  { label: "FAQ: förvaring", value: 4 },
  { label: "FAQ: prenumerationsfälla", value: 4 },
  { label: "FAQ: jäst", value: 4 },
];

export const CLICKS_LISTICLE: Row[] = [
  { label: "Rubrik: 7 Reasons…", value: 20, note: "brödtext" },
  { label: "“Starts in Her Gut, Not Her Skin”", value: 12, note: "brödtext" },
  { label: "“You've tried the shampoos…”", value: 12, note: "brödtext" },
  { label: "“one formula for a Great Dane…”", value: 11, note: "brödtext" },
  { label: "“Her gut? … the whole game →”", value: 10, note: "länk" },
  { label: "Get Her the Right-Size Chew", value: 9, note: "CTA" },
  { label: "CALM MY DOG'S ITCH", value: 6, note: "huvud-CTA" },
];

/* ── Voice of customer ──────────────────────────────────────────────────── */

/** FAQ accordions people actually opened on the PDP — the real objections. */
export const OBJECTIONS: (Row & { kind: "förtroende" | "produkt" })[] = [
  { label: "Kan jag ge det ihop med Apoquel/Cytopoint?", value: 4, kind: "förtroende" },
  { label: "Är prenumerationen en fälla?", value: 4, kind: "förtroende" },
  { label: "Behöver den kylas? Hur förvarar jag den?", value: 4, kind: "produkt" },
  { label: "Är inte jäst det hunden kämpar mot?", value: 4, kind: "produkt" },
  { label: "Är den säker för valpar och seniorer?", value: 3, kind: "produkt" },
  { label: "Tänk om hon vägrar äta den? Hon är kräsen.", value: 3, kind: "produkt" },
];

/* ── Technical blockers ─────────────────────────────────────────────────── */

export type Blocker = {
  title: string;
  where: string;
  events: number;
  severity: "critical" | "serious" | "warning" | "good";
  verdict: string;
  eatsMoney: boolean;
};

export const BLOCKERS: Blocker[] = [
  {
    title: "@theme/component — modulfel, importmap saknas",
    where: "/pages/ears1",
    events: 32,
    severity: "critical",
    verdict:
      "Product-form, cart-drawer, quick-add och variant-picker initieras aldrig. Förklarar 37 sessioner och noll signal. Pausa spend tills det är fixat.",
    eatsMoney: true,
  },
  {
    title: "429 rate limit på köpvägen",
    where: "cart/add.js · accelerated_checkout · PDP",
    events: 27,
    severity: "critical",
    verdict: "Kunden trycker köp och får ingenting. Enda felkategorin som direkt dödar ett köp.",
    eatsMoney: true,
  },
  {
    title: "401 på Shop Pay-session",
    where: "shop.app/pay/session · sf_private_access_tokens",
    events: 64,
    severity: "serious",
    verdict: "Shop Pay express-knappen fallerar — i webview är den ofta en stor del av mobil-checkout.",
    eatsMoney: true,
  },
  {
    title: "requestIdleCallback saknas",
    where: "PDP, gamla webviews",
    events: 98,
    severity: "warning",
    verdict: "Bryter predictive-search. Irriterande, inte dödligt.",
    eatsMoney: false,
  },
  {
    title: "_AutofillCallbackHandler",
    where: "/pages/ears1 · /pages/listicle1",
    events: 49,
    severity: "good",
    verdict: "Ren FB/IG-webview-artefakt. Ignorera.",
    eatsMoney: false,
  },
];

export const FRUSTRATION = {
  rageClicks: 0,
  deadClicks: 0,
  verdict: "Inga döda knappar någonstans — friktionen är teknisk och strukturell, inte UX-mässig.",
} as const;

/* ── Conclusions ────────────────────────────────────────────────────────── */

export const CONCLUSIONS: { heading: string; body: string }[] = [
  {
    heading: "Bygg för webviewen, inte för webben",
    body: "56 % av trafiken lämnar aldrig Facebooks eller Instagrams inbyggda browser. Det är inte en fotnot — det är designparametern. Tunga JS-arkitekturer (samma modulsystem som redan brakat på ears1) och Shop Pay-beroenden är sårbara precis där majoriteten av kunderna står.",
  },
  {
    heading: "Första skärmen är sidan",
    body: "Med 63 % borta inom 30 sekunder måste hela erbjudandet — löfte, storleksbevis, pris, CTA — bäras ovanför vecket. Samma sak som 6:e-klass-regeln säger, nu med beteendedata bakom.",
  },
  {
    heading: "PDP-first som standarddestination",
    body: "Den enkla sidan får 58 % CTA-genomslag; den långa listiclen 14 %. Message-match-testet PP vs LP har ett tidigt svar, och det pekar mot PDP:n.",
  },
  {
    heading: "Skriv mot de faktiska invändningarna",
    body: "Apoquel-kompatibilitet och prenumerationsrädsla är bekräftade blockerare — två av topp fyra öppnade FAQ:er är förtroendefrågor, inte produktfrågor. De hör hemma i hooks och i buy-boxen, inte nedgrävda i ett dragspel.",
  },
];

export const NEXT_TESTS: { title: string; body: string }[] = [
  {
    title: "Flytta upp de två förtroendeinvändningarna",
    body: "“Works alongside Apoquel” + “Cancel anytime, no trap” som synliga rader i buy-boxen på PDP, mot dagens nedgrävda FAQ. Bekräftade blockerare, billigaste fixen.",
  },
  {
    title: "CTA-täthet på listicle1",
    body: "CALM MY DOG'S ITCH efter varje reason-block istället för bara i slutet. Läsengagemanget finns redan (20 klick på rubriken) — det saknas bara utgångar. Mät mot dagens 6 av 44.",
  },
  {
    title: "Apoquel-arcen som hook",
    body: "Ett script där hela ingången är “vad man faktiskt gör när hunden redan står på Apoquel” — nu med beteendebevis, inte bara research. Josephine Hart som avsändare (civil röst, personlig historia).",
  },
];
