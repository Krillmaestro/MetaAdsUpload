import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// ── Gene Statics #3/#4/#9/#10/#11 → Allergi & Klåda // ABO (Kristoffer 2026-09-03)
// 5 ad sets × 3 hookbilder × 2 landers (PP + LP1) = 30 ads. 300 kr/dag, copy ur README.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";
const CAMPAIGN_ID = "120254782838750350"; // Allergi & Klåda // ABO
const PIXEL = "1485774658810931";
const PAGE = "265790413295490";
const STATUS = "ACTIVE";
const DAILY_BUDGET = 30000;
const EXCLUDED_AUDIENCES = ["120242809727280350", "120250065842190350"];
const URL_TAGS = "utm_source=fb&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";
const ROOT = "/Users/kristoffermacbook/Desktop/creative-strategist/Ad statics/ApotekHunden";

const LINKS = [
  { key: "PP",  url: "https://www.apotekhunden.se/products/klada-allergi", cta: "SHOP_NOW" },
  { key: "LP1", url: "https://www.apotekhunden.se/pages/allergi-och-klada1?_ab=0&key=1776797690955", cta: "LEARN_MORE" },
];

const SETS = [
  {
    dir: "2026-09-01 - Statics #3 - Allergi KLIAR",
    adset: "SE Gene Sep1 - Statics #3 - KLIAR - ALLERGI - 399 - Scratching",
    pts: [
`Klockan 3 på natten. Du hör det igen. Slick. Slick. Slick.

Du har provat schampon, foderbyten och salvor. Det hjälper i några dagar – sen är klådan tillbaka.

Det beror på att klådan sällan börjar i huden. Den börjar inifrån: i immunförsvarets överreaktion, i inflammationen och i tarmen som påverkar båda.

Klåda & Allergi är en mjuk tugga om dagen med 13 aktiva ingredienser (630 mg): quercetin, boswellia, alg-omega (DHA), MSM, kolostrum, gurkmeja, GLA och sex till. Varje ingrediens står med exakt mängd på burken.

Utan kyckling, spannmål och soja. Alg-omega i stället för fiskolja.

399 kr (ord. 499). 30 dagars nöjdhetsgaranti.`,
`Provat allt mot klådan?

Kliar sig. Slickar tassarna. Röda fläckar i ljumskarna. Öron som luktar.

Fyra symptom – en orsak. När immunförsvaret överreagerar syns det överallt på en gång.

Klåda & Allergi jobbar inifrån: 13 aktiva ingredienser i en mjuk tugga om dagen. Quercetin och boswellia för immunbalansen, alg-omega och GLA för hudbarriären, kolostrum och MSM som stöd.

✅ 399 kr (ord. 499)
✅ 30 dagars nöjdhetsgaranti
✅ Varje ingrediens med exakt mängd på burken`],
    heads: ["Har din hund problem med klåda?", "13 aktiva ingredienser – 30 dagars garanti"],
    desc: "Mjuk tugga om dagen. 399 kr. Pengarna tillbaka om du inte ser skillnad.",
  },
  {
    dir: "2026-09-01 - Statics #4 - Allergi CHATT",
    adset: "SE Gene Sep1 - Statics #4 - CHATT - ALLERGI - 399 - Skeptic",
    pts: [
`"Men hur vet man ens att sånt här gör någon nytta?"

Rimlig fråga. Vi får den ofta.

Så här: varje ingrediens i Klåda & Allergi står med exakt mängd på burken. 13 stycken, 630 mg per tugga. Inga "proprietära blandningar" där du inte vet vad du betalar för.

Och om du efter 30 dagar inte ser någon skillnad på kliandet, tassarna eller huden – får du pengarna tillbaka. Utan tjafs.

Det är så vi tycker att ett tillskott ska bevisa sig.

399 kr (ord. 499).`,
`"Vi har testat allt. Varför skulle det här vara annorlunda?"

För att det inte jobbar på huden – det jobbar inifrån.

Schampon och salvor lugnar ytan. Klåda & Allergi ger kroppen det den behöver för att inte överreagera: quercetin, boswellia, alg-omega, MSM, kolostrum och åtta till. En mjuk tugga om dagen.

Utan kyckling, spannmål och soja. Alg-omega i stället för fiskolja.

30 dagars nöjdhetsgaranti. 399 kr (ord. 499).`],
    heads: ["Funkar det inte på 30 dagar får du pengarna tillbaka", "13 ingredienser. Exakt mängd på burken."],
    desc: "Klåda & Allergi – mjuk tugga, 630 mg aktiva per dag.",
  },
  {
    dir: "2026-09-01 - Statics #9 - Allergi KLADKARTAN",
    adset: "SE Gene Sep1 - Statics #9 - KLADKARTAN - ALLERGI - 399 - Scratching",
    pts: [
`Tassarna. Ljumskarna. Armhålorna. Öronen. Svansroten.

Klådan flyttar runt – men orsaken sitter kvar.

När immunförsvaret överreagerar syns det överallt på en gång. Därför hjälper det bara tillfälligt att behandla ett ställe i taget.

Klåda & Allergi jobbar inifrån: 13 aktiva ingredienser (630 mg) i en mjuk tugga om dagen. Quercetin, boswellia, alg-omega, MSM, kolostrum, gurkmeja, GLA och sex till – varje med exakt mängd på burken.

399 kr (ord. 499). 30 dagars nöjdhetsgaranti.`,
`Här kliar det oftast: tassarna, ljumskarna, öronen.

Fem ställen. En orsak.

Du jagar symptomet med schampo, salva och öronrens. Vi jobbar med orsaken – inifrån.

13 aktiva ingredienser i en mjuk tugga om dagen. Utan kyckling, spannmål och soja.

✅ 399 kr (ord. 499)
✅ 30 dagars nöjdhetsgaranti`],
    heads: ["Klådan flyttar runt. Orsaken sitter kvar.", "13 aktiva ingredienser – 399 kr"],
    desc: "Jobbar inifrån. 30 dagars nöjdhetsgaranti.",
  },
  {
    dir: "2026-09-01 - Statics #10 - Allergi DARFOR",
    adset: "SE Gene Sep1 - Statics #10 - DARFOR - ALLERGI - 399 - Skeptic",
    pts: [
`De flesta klådatillskott fungerar inte. Här är varför.

De jobbar på en sak. Många innehåller bara ett par ingredienser. Men klåda har flera orsaker på en gång: ett immunförsvar som överreagerar, en hudbarriär som läcker, inflammation och en tarm som påverkar alltihop.

Klåda & Allergi har 13 aktiva ingredienser som jobbar brett: quercetin och boswellia för immunbalansen, alg-omega (DHA) och GLA för hudbarriären, MSM, kolostrum, gurkmeja och sex till.

Varje ingrediens står med exakt mängd på burken. En mjuk tugga om dagen.

399 kr (ord. 499). 30 dagars nöjdhetsgaranti.`,
`Fiskolja var aldrig hela svaret.

Det är där de flesta börjar – och slutar. Klåda & Allergi använder alg-omega (DHA) direkt från källan, och lägger till tolv ingredienser till: quercetin, boswellia, MSM, kolostrum, GLA, gurkmeja…

Ett tillskott. Ett symptom. Det räcker inte. Tretton som jobbar brett – det är skillnaden.

Utan kyckling, spannmål och soja.

✅ 399 kr (ord. 499)
✅ 30 dagars nöjdhetsgaranti`],
    heads: ["Därför funkar inte de flesta klådatillskott", "13 aktiva – exakt mängd på burken"],
    desc: "Alg-omega i stället för fiskolja. 30 dagars garanti.",
  },
  {
    dir: "2026-09-01 - Statics #11 - Allergi SOK",
    adset: "SE Gene Sep1 - Statics #11 - SOK - ALLERGI - 399 - Search",
    pts: [
`Du har googlat det. Klockan 23.40, med en hund som slickar tassarna bredvid dig.

"bästa medel mot klåda hund". "hund kliar sig inga loppor". "hund slickar tassarna hela natten".

Svaren du får är schampon, salvor och "byt foder". De jobbar på ytan. Klådan börjar inifrån.

Klåda & Allergi: 13 aktiva ingredienser i en mjuk tugga om dagen. Quercetin, boswellia, alg-omega, MSM, kolostrum och åtta till – varje med exakt mängd på burken.

399 kr (ord. 499). 30 dagars nöjdhetsgaranti – ser du ingen skillnad får du pengarna tillbaka.`,
`Sluta googla. Börja inifrån.

Kliar sig. Slickar tassarna. Röda fläckar. Öron som luktar. Samma sak – immunförsvaret överreagerar.

13 aktiva ingredienser i en mjuk tugga om dagen. Utan kyckling, spannmål och soja.

✅ 399 kr (ord. 499)
✅ 30 dagars nöjdhetsgaranti`],
    heads: ["Har din hund problem med klåda?", "13 aktiva ingredienser – 30 dagars garanti"],
    desc: "Mjuk tugga om dagen. 399 kr.",
  },
];

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-gene-statics-allergi-state.json`;

const env = readFileSync("/Users/kristoffermacbook/Desktop/namnlös mapp/MetaAdsUpload-fresh/.env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const TOKEN = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0].access_token;

const BASE = "https://graph.facebook.com/v25.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function reqJson(label, mkFetch, tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let res, text;
    try { res = await mkFetch(); text = await res.text(); }
    catch (e) { lastErr = e; await sleep(Math.min(2000 * 2 ** i, 20000)); continue; }
    let j;
    try { j = JSON.parse(text); }
    catch { lastErr = new Error(`${label}: non-JSON (status ${res.status})`); await sleep(Math.min(2000 * 2 ** i, 20000)); continue; }
    if (!res.ok) {
      const code = j.error?.code;
      const retryable = res.status >= 500 || res.status === 429 || [1, 2, 4, 17, 341].includes(code);
      if (retryable && i < tries - 1) { lastErr = new Error(`${label}: ${JSON.stringify(j.error)}`); await sleep(Math.min(2000 * 2 ** i, 20000)); continue; }
      const e = new Error(`${label}: ${JSON.stringify(j.error)}`); e.meta = j.error; throw e;
    }
    return j;
  }
  throw lastErr || new Error(`${label}: failed after ${tries} tries`);
}
const gGet = (p, q = {}) => {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  return reqJson(`GET ${p}`, () => fetch(u));
};
const gPostJson = (p, body) => reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
}));
const gPostForm = (p, form) => { form.append("access_token", TOKEN); return reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, { method: "POST", body: form })); };

let state = { sets: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

console.log(`\n=== Gene Statics Allergi #3/#4/#9/#10/#11 → Allergi & Klåda // ABO ${DRY ? "(DRY RUN)" : "LIVE"} ===`);
console.log(`Landers: PP (SHOP_NOW) + LP1 advertorial (LEARN_MORE) | 300 kr/dag | destination_type WEBSITE\n`);
for (const s of SETS) console.log(`AD SET: ${s.adset}  (H1/H2/H3 × PP+LP1 = 6 ads)`);

console.log("\n── preflight ──");
for (const l of LINKS) {
  const r = await fetch(l.url, { method: "HEAD", redirect: "manual" });
  console.log(`  ${l.key}: HTTP ${r.status} ${r.status === 200 ? "✓" : "⚠️"}`);
  if (r.status !== 200) throw new Error(`Lander ${l.key} svarar ${r.status}`);
}
try {
  const pdp = await (await fetch(LINKS[0].url)).text();
  const hit = /30\s*dagars?\s*nöjdhetsgaranti/i.test(pdp);
  console.log(`  garantitext "30 dagars nöjdhetsgaranti" på PDP: ${hit ? "✓" : "⚠️ HITTAS INTE — verifiera manuellt (README #4-kravet)"}`);
} catch (e) { console.log(`  (garantikoll misslyckades: ${e.message})`); }
for (const s of SETS) for (const h of ["H1", "H2", "H3"]) {
  if (!existsSync(`${ROOT}/${s.dir}/${h}.png`)) throw new Error(`${s.dir}/${h}.png saknas`);
}
console.log("  alla 15 bilder finns ✓");
const existing = await gGet(`/${CAMPAIGN_ID}/adsets`, { fields: "name", limit: "500" });
const existingNames = new Set((existing.data || []).map((a) => a.name));
console.log(`  dublettkontroll: ${existingNames.size} befintliga ad sets`);
for (const s of SETS) if (existingNames.has(s.adset)) throw new Error(`DUBBLETT: "${s.adset}" finns redan`);
console.log("  inga namnkrockar ✓");

if (DRY) { console.log("\n(dry run — inget skickat)"); process.exit(0); }

for (const s of SETS) {
  console.log(`\n══ ${s.adset} ══`);
  const st = (state.sets[s.adset] ||= { images: {}, adsetId: null, ads: {} });

  for (const h of ["H1", "H2", "H3"]) {
    if (st.images[h]) { console.log(`  ${h}: hash finns (${st.images[h]})`); continue; }
    const bytes = readFileSync(`${ROOT}/${s.dir}/${h}.png`).toString("base64");
    const form = new FormData();
    form.append("bytes", bytes);
    const r = await gPostForm(`/${ACT}/adimages`, form);
    const img = Object.values(r.images || {})[0];
    if (!img?.hash) throw new Error(`${h}: ingen hash`);
    st.images[h] = img.hash; save();
    console.log(`  ${h}: image_hash=${img.hash}`);
  }

  if (!st.adsetId) {
    const r = await gPostJson(`/${ACT}/adsets`, {
      campaign_id: CAMPAIGN_ID,
      name: s.adset,
      daily_budget: DAILY_BUDGET,
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      destination_type: "WEBSITE",
      promoted_object: { pixel_id: PIXEL, custom_event_type: "PURCHASE" },
      attribution_spec: [
        { event_type: "CLICK_THROUGH", window_days: 7 },
        { event_type: "VIEW_THROUGH", window_days: 1 },
      ],
      targeting: {
        age_min: 18, age_max: 65,
        geo_locations: { countries: ["SE"], location_types: ["home", "recent"] },
        targeting_automation: { advantage_audience: 1 },
        excluded_custom_audiences: EXCLUDED_AUDIENCES.map((id) => ({ id })),
      },
      status: STATUS,
    });
    st.adsetId = r.id; save();
    console.log(`  ✓ ad set ${r.id}`);
  } else console.log(`  ad set i state: ${st.adsetId}`);

  for (const h of ["H1", "H2", "H3"]) for (const link of LINKS) {
    const adKey = `${h}|${link.key}`;
    if (st.ads[adKey]?.adId) { console.log(`    ${adKey}: finns redan`); continue; }
    const hash = st.images[h];
    const name = `${h} ${s.adset} [${link.key}]`;
    const group = {
      texts: [
        ...s.pts.map((text) => ({ text, text_type: "primary_text" })),
        ...s.heads.map((text) => ({ text, text_type: "headline" })),
      ],
      call_to_action: { type: link.cta, value: { link: link.url } },
      images: [{ hash }],
    };
    const storySpec = {
      page_id: PAGE,
      link_data: {
        link: link.url,
        image_hash: hash,
        message: s.pts[0],
        name: s.heads[0],
        description: s.desc,
        call_to_action: { type: link.cta, value: { link: link.url } },
      },
    };
    const form = new FormData();
    form.append("adset_id", st.adsetId);
    form.append("name", name);
    form.append("status", STATUS);
    form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
    form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));
    const r = await gPostForm(`/${ACT}/ads`, form);
    st.ads[adKey] = { adId: r.id, name }; save();
    console.log(`    ✓ ${adKey}: ${r.id}`);
    try {
      await sql`INSERT INTO upload_jobs (filename, media_type, status, total_steps, current_step, step_label, campaign_id, adset_id, ad_id, config, completed_at)
                VALUES (${s.dir + "/" + h + ".png"}, 'image', 'completed', 3, 3, 'Klar!', ${CAMPAIGN_ID}, ${st.adsetId}, ${r.id},
                        ${JSON.stringify({ adName: name, adCopy: { headlines: s.heads, primaryTexts: s.pts, description: s.desc, linkUrl: link.url, ctaType: link.cta }, pageId: PAGE, pixelId: PIXEL, adAccountId: ACT, source: "publish-ah-gene-statics-allergi" })}::jsonb, now())`;
    } catch (e) { console.warn(`    (upload_jobs: ${e.message})`); }
  }
}
const total = Object.values(state.sets).reduce((n, b) => n + Object.keys(b.ads).length, 0);
console.log(`\n=== KLART: 5 ad sets, ${total} annonser i Allergi & Klåda // ABO ===`);
