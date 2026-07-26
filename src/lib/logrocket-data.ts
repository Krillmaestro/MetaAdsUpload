import type { LogRocketPayload } from "./logrocket-types";

// Seed snapshot — the first LogRocket pull for SmallDogCO (thesmalldogco.com),
// taken from org `jwaz0o` / project `smalldogco` on 2026-07-26.
//
// This is the FALLBACK only. Once a snapshot exists in `logrocket_snapshots`
// the page reads the newest row instead; this constant exists so the page still
// renders on a fresh database and so the first row has something to seed from.
// Do not edit it to "update the numbers" — post a new snapshot instead, or the
// version history loses the change.
//
// THREE CAVEATS GOVERN EVERY NUMBER BELOW. They render at the top of the page
// for a reason; without them the data reads as the opposite of the truth:
//
//  1. Recording started 2026-07-21. "Last 30 days" is really 6 days.
//  2. Shopify checkout is off-domain and is NOT recorded. LogRocket can never
//     see a purchase — "0 conversions" is a measurement artefact, not a result.
//  3. Network- and element-based filters only collect going forward, so
//     historical add-to-cart rates cannot be recovered retroactively.

export const SEED_PAYLOAD: LogRocketPayload = {
  source: {
    project: "jwaz0o / smalldogco",
    site: "thesmalldogco.com",
    windowStart: "2026-07-21",
    windowEnd: "2026-07-26",
    recordedDays: 6,
  },

  caveats: [
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
  ],

  sessionsPerDay: [
    { day: "2026-07-21", label: "21/7", sessions: 48 },
    { day: "2026-07-22", label: "22/7", sessions: 77 },
    { day: "2026-07-23", label: "23/7", sessions: 117 },
    { day: "2026-07-24", label: "24/7", sessions: 181 },
    { day: "2026-07-25", label: "25/7", sessions: 116 },
    { day: "2026-07-26", label: "26/7", sessions: 31, partial: true },
  ],

  // Three groups, so the stacked bar stays inside the all-pairs-validated slots.
  environmentGroups: [
    { label: "In-app (Facebook + Instagram)", value: 313 },
    { label: "Riktig webbläsare", value: 220 },
    { label: "Ej identifierad", value: 22 },
  ],

  browsers: [
    { label: "Facebook in-app", value: 277 },
    { label: "Chrome", value: 158, note: "mycket bot" },
    { label: "Mobile Safari", value: 39 },
    { label: "Instagram in-app", value: 36 },
    { label: "Ej identifierad", value: 22 },
    { label: "Övriga", value: 23, note: "Safari, Samsung, Firefox, Edge m.fl." },
  ],

  operatingSystems: [
    { label: "iOS", value: 266 },
    { label: "Android", value: 115 },
    { label: "Windows", value: 111 },
    { label: "Mac OS", value: 28 },
    { label: "Linux", value: 8 },
  ],

  // Ordered bins — an ordinal ramp is the correct encoding, not categorical.
  sessionLength: [
    { label: "under 5 sek", value: 170 },
    { label: "5–30 sek", value: 180 },
    { label: "30–120 sek", value: 163 },
    { label: "över 120 sek", value: 42 },
  ],

  pages: [
    {
      path: "/products/small-dog-co-itch-relief",
      role: "PDP",
      sessions: 158,
      clickSessions: 60,
      ctaClicks: 35,
      status: "good",
      note: "Starkaste sidan vi har. 58 % av klickande sessioner trycker huvud-CTA:n.",
    },
    {
      path: "/pages/listicle1",
      role: "Listicle",
      sessions: 126,
      clickSessions: 44,
      ctaClicks: 6,
      status: "warning",
      note: "Håller uppmärksamhet men läcker till CTA — de klickar på texten, inte på knappen.",
    },
    {
      path: "/pages/itch2",
      role: "Symptomdörr",
      sessions: 41,
      clickSessions: null,
      ctaClicks: null,
      status: "neutral",
      note: "För lite volym för slutsats.",
    },
    {
      path: "/pages/ears1",
      role: "Symptomdörr",
      sessions: 37,
      clickSessions: null,
      ctaClicks: null,
      status: "critical",
      note: "Tekniskt trasig — produktformulär och cart initieras aldrig. Pausa spend.",
    },
  ],

  clicksSitewide: [
    { label: "CALM MY DOG'S ITCH", value: 79, note: "huvud-CTA" },
    { label: "TRY IT TODAY", value: 34, note: "sekundär CTA" },
    { label: "Small-Dog Health · 5 min read…", value: 22 },
    { label: "MADE ONLY FOR DOGS 2–25 LBS…", value: 18 },
    { label: "1-Month Itch Relief 34% OFF…", value: 13 },
    { label: "FROM NEVER-ENDING ITCHING TO…", value: 13 },
  ],

  clicksPdp: [
    { label: "CALM MY DOG'S ITCH", value: 35, note: "huvud-CTA" },
    { label: "TRY IT TODAY", value: 11, note: "sekundär CTA" },
    { label: "MADE ONLY FOR DOGS 2–25 LBS…", value: 6 },
    { label: "FAQ: Apoquel/Cytopoint", value: 4 },
    { label: "FAQ: förvaring", value: 4 },
    { label: "FAQ: prenumerationsfälla", value: 4 },
    { label: "FAQ: jäst", value: 4 },
  ],

  clicksListicle: [
    { label: "Rubrik: 7 Reasons…", value: 20, note: "brödtext" },
    { label: "“Starts in Her Gut, Not Her Skin”", value: 12, note: "brödtext" },
    { label: "“You've tried the shampoos…”", value: 12, note: "brödtext" },
    { label: "“one formula for a Great Dane…”", value: 11, note: "brödtext" },
    { label: "“Her gut? … the whole game →”", value: 10, note: "länk" },
    { label: "Get Her the Right-Size Chew", value: 9, note: "CTA" },
    { label: "CALM MY DOG'S ITCH", value: 6, note: "huvud-CTA" },
  ],

  // FAQ accordions people actually opened on the PDP — the real objections.
  objections: [
    { label: "Kan jag ge det ihop med Apoquel/Cytopoint?", value: 4, kind: "förtroende" },
    { label: "Är prenumerationen en fälla?", value: 4, kind: "förtroende" },
    { label: "Behöver den kylas? Hur förvarar jag den?", value: 4, kind: "produkt" },
    { label: "Är inte jäst det hunden kämpar mot?", value: 4, kind: "produkt" },
    { label: "Är den säker för valpar och seniorer?", value: 3, kind: "produkt" },
    { label: "Tänk om hon vägrar äta den? Hon är kräsen.", value: 3, kind: "produkt" },
  ],

  blockers: [
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
  ],

  frustration: {
    rageClicks: 0,
    deadClicks: 0,
    verdict: "Inga döda knappar någonstans — friktionen är teknisk och strukturell, inte UX-mässig.",
  },

  conclusions: [
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
  ],

  nextTests: [
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
  ],
};
