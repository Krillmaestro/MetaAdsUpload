import { PAYLOAD_VERSION, type LogRocketPayload } from "./logrocket-types";

// Seed snapshot — LogRocket pull for SmallDogCO (thesmalldogco.com) taken from
// org `jwaz0o` / project `smalldogco` on 2026-07-26.
//
// FALLBACK ONLY. Once a snapshot exists in `logrocket_snapshots` the page reads
// the newest row instead. Do not edit this to "update the numbers" — post a new
// snapshot, or the version history loses the change.
//
// `days` holds every dimension LogRocket can break out daily, which is what
// lets the page total an arbitrary date range. `period` holds the aggregates it
// cannot (clicked elements, FAQ opens, issues) — those are labelled in the UI
// as covering the whole window, never a slice of it.
//
// THREE CAVEATS GOVERN EVERY NUMBER:
//  1. Recording started 2026-07-21. Anything before that is empty, not zero.
//  2. Shopify checkout is off-domain and NOT recorded — "0 conversions" is a
//     measurement artefact. Purchases are verified in Shopify/Meta.
//  3. Network/element filters only collect going forward, so historical
//     add-to-cart rates cannot be recovered.

export const SEED_PAYLOAD: LogRocketPayload = {
  version: PAYLOAD_VERSION,

  source: {
    project: "jwaz0o / smalldogco",
    site: "thesmalldogco.com",
    windowStart: "2026-07-21",
    windowEnd: "2026-07-26",
  },

  caveats: [
    {
      title: "Datan börjar 21 juli",
      body: "LogRocket började spela in 21/7. Väljer du en period före det är den tom — det betyder “inte inspelat”, inte “noll trafik”.",
    },
    {
      title: "Checkout spelas inte in",
      body: "Shopify-checkout ligger på annan domän. LogRocket kan aldrig se ett köp — “0 konverteringar” är mätartefakt. Köp verifieras i Shopify/Meta.",
    },
    {
      title: "Sessioner ≠ besökare",
      body: "En stor del av Chrome/Windows-trafiken är bottar och Metas link-crawlers. Läs aldrig en rå sessionssiffra som antal kunder.",
    },
  ],

  days: [
    {
      date: "2026-07-21",
      sessions: 48,
      browsers: { Chrome: 24, Facebook: 15, "Mobile Safari": 4, Instagram: 2, "": 1, Edge: 1, "Samsung Internet": 1 },
      operatingSystems: { iOS: 15, Android: 6, Windows: 22, "Mac OS": 3 },
      duration: { lt5: 27, s5to30: 12, s30to120: 9, gt120: 0 },
      pages: {
        "/products/small-dog-co-itch-relief": 11,
        "/pages/listicle1": 0,
        "/pages/itch2": 0,
        "/pages/ears1": 0,
        "/cart": 5,
      },
    },
    {
      date: "2026-07-22",
      sessions: 77,
      browsers: {
        Facebook: 42, Chrome: 19, Instagram: 5, "": 2, "Mobile Safari": 2,
        "Samsung Internet": 2, WeChat: 2, Edge: 1, Opera: 1, Yandex: 1,
      },
      operatingSystems: { iOS: 34, Android: 19, Windows: 21, "Mac OS": 1 },
      duration: { lt5: 24, s5to30: 24, s30to120: 21, gt120: 8 },
      pages: {
        "/products/small-dog-co-itch-relief": 27,
        "/pages/listicle1": 0,
        "/pages/itch2": 0,
        "/pages/ears1": 0,
        "/cart": 1,
      },
    },
    {
      date: "2026-07-23",
      sessions: 117,
      browsers: {
        Facebook: 60, Chrome: 43, "": 5, "Mobile Safari": 5,
        Instagram: 1, Safari: 1, "Samsung Internet": 1, Yandex: 1,
      },
      operatingSystems: { iOS: 54, Android: 21, Windows: 24, "Mac OS": 8, Linux: 2 },
      duration: { lt5: 32, s5to30: 36, s30to120: 33, gt120: 16 },
      pages: {
        "/products/small-dog-co-itch-relief": 66,
        "/pages/listicle1": 12,
        "/pages/itch2": 0,
        "/pages/ears1": 0,
        "/cart": 0,
      },
    },
    {
      date: "2026-07-24",
      sessions: 181,
      browsers: {
        Facebook: 87, Chrome: 49, Instagram: 20, "Mobile Safari": 17,
        "": 4, Safari: 2, Edge: 1, "Samsung Internet": 1,
      },
      operatingSystems: { iOS: 90, Android: 45, Windows: 30, "Mac OS": 7, Linux: 4 },
      duration: { lt5: 51, s5to30: 69, s30to120: 50, gt120: 11 },
      pages: {
        "/products/small-dog-co-itch-relief": 29,
        "/pages/listicle1": 68,
        "/pages/itch2": 17,
        "/pages/ears1": 21,
        "/cart": 1,
      },
    },
    {
      date: "2026-07-25",
      sessions: 116,
      browsers: {
        Facebook: 58, Chrome: 28, "Mobile Safari": 9, "": 7,
        Instagram: 6, Firefox: 3, Safari: 3, IE: 1, "Samsung Internet": 1,
      },
      operatingSystems: { iOS: 59, Android: 19, Windows: 22, "Mac OS": 8, Linux: 1 },
      duration: { lt5: 39, s5to30: 32, s30to120: 39, gt120: 6 },
      pages: {
        "/products/small-dog-co-itch-relief": 18,
        "/pages/listicle1": 37,
        "/pages/itch2": 19,
        "/pages/ears1": 14,
        "/cart": 0,
      },
    },
    {
      date: "2026-07-26",
      sessions: 36,
      partial: true,
      browsers: { Facebook: 16, Chrome: 12, "": 3, "Mobile Safari": 3, Instagram: 2 },
      operatingSystems: { iOS: 16, Android: 6, Windows: 8, "Mac OS": 2, Linux: 1 },
      duration: { lt5: 13, s5to30: 9, s30to120: 12, gt120: 2 },
      pages: {
        "/products/small-dog-co-itch-relief": 8,
        "/pages/listicle1": 11,
        "/pages/itch2": 5,
        "/pages/ears1": 2,
        "/cart": 0,
      },
    },
  ],

  period: {
    pages: [
      {
        path: "/products/small-dog-co-itch-relief",
        role: "PDP",
        clickSessions: 60,
        ctaClicks: 35,
        status: "good",
        note: "Starkaste sidan vi har — men den var ensam om trafiken 21–23/7. Jämför bara mot dagar då båda fick trafik.",
      },
      {
        path: "/pages/listicle1",
        role: "Listicle",
        clickSessions: 44,
        ctaClicks: 6,
        status: "warning",
        note: "Fick trafik först 23/7. Håller uppmärksamhet men läcker till CTA — de klickar på texten, inte på knappen.",
      },
      {
        path: "/pages/itch2",
        role: "Symptomdörr",
        clickSessions: null,
        ctaClicks: null,
        status: "neutral",
        note: "Live sedan 24/7. För lite volym för slutsats.",
      },
      {
        path: "/pages/ears1",
        role: "Symptomdörr",
        clickSessions: null,
        ctaClicks: null,
        status: "critical",
        note: "Live sedan 24/7 och tekniskt trasig — produktformulär och cart initieras aldrig. Pausa spend.",
      },
      {
        path: "/cart",
        role: "Varukorg",
        clickSessions: null,
        ctaClicks: null,
        status: "neutral",
        note: "7 sessioner totalt, 5 av dem 21/7 (troligen egna tester). Sista steget före checkout, som inte spelas in.",
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
          "Product-form, cart-drawer, quick-add och variant-picker initieras aldrig. Sidan har fått trafik sedan 24/7 utan att kunna sälja. Pausa spend tills det är fixat.",
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
  },

  conclusions: [
    {
      heading: "Bygg för webviewen, inte för webben",
      body: "Över hälften av trafiken lämnar aldrig Facebooks eller Instagrams inbyggda browser. Det är inte en fotnot — det är designparametern. Tunga JS-arkitekturer (samma modulsystem som redan brakat på ears1) och Shop Pay-beroenden är sårbara precis där majoriteten av kunderna står.",
    },
    {
      heading: "Första skärmen är sidan",
      body: "Ungefär två tredjedelar är borta inom 30 sekunder. Hela erbjudandet — löfte, storleksbevis, pris, CTA — måste bäras ovanför vecket. Samma sak som 6:e-klass-regeln säger, nu med beteendedata bakom.",
    },
    {
      heading: "Sidorna startade inte samtidigt",
      body: "PDP:n var ensam om trafiken 21–23/7. Listicle1 kom 23/7, itch2 och ears1 den 24/7. Jämför aldrig deras totaler rakt av — välj en period där båda fick trafik, annars mäter du exponeringstid och inte kvalitet.",
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
