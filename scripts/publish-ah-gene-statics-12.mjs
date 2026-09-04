import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// ── Gene Statics #1/#2 → ProBiotics // ABO (Kristoffer 2026-09-04) ───────────
// Override: ALLA ads går mot 7R (LEARN_MORE) + PP (SHOP_NOW).
// 2 ad sets × 3 hookbilder × 2 landers = 12 ads. 300 kr/dag, copy ur artifact-korten.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";
const CAMPAIGN_ID = "120229285210840350"; // ProBiotics // ABO
const PIXEL = "1485774658810931";
const PAGE = "265790413295490";
const STATUS = "ACTIVE";
const DAILY_BUDGET = 30000;
const EXCLUDED_AUDIENCES = ["120242809727280350", "120250065842190350"];
const URL_TAGS = "utm_source=fb&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";
const ROOT = "/Users/kristoffermacbook/Desktop/creative-strategist/Ad statics/ApotekHunden";

const LINKS = [
  { key: "7R", url: "https://www.apotekhunden.se/pages/7-skal-los-mage-tassar-oron-samma-problem", cta: "LEARN_MORE" },
  { key: "PP", url: "https://www.apotekhunden.se/products/apotekhunden-probiotika", cta: "SHOP_NOW" },
];

const SETS = [
  {
    dir: "2026-09-01 - Statics #1 - Probiotika 8TECKEN",
    adset: "SE Gene Sep1 - Statics #1 - 8TECKEN - PROBIOTIKA - 399 - MIX",
    pts: [
`Slickar tassarna på kvällen. Äter gräs på promenaden. Öronen luktar lite unket. Magen är lös då och då.

Det ser ut som fyra olika småproblem. Oftast är det ett – tarmfloran är i obalans.

Hundens tarm styr mer än magen. Hudens klåda, öronens jästbalans och hur väl maten tas upp hänger ihop med bakterierna där nere.

3-i-1 Probiotika är en mjuk tugga om dagen med sporbildande probiotika (ett skyddande skal så att bakterierna kommer fram till tarmen), prebiotika som matar de goda bakterierna och omega-3.

399 kr (ord. 449). 30 dagars nöjdhetsgaranti – ser du ingen skillnad får du pengarna tillbaka.`,
`Tre vanor. Ett problem.

Slickar tassarna. Äter gräs. Kliar sig utan loppor.

De flesta hundägare behandlar dem som tre olika saker. Men de pekar ofta på samma ställe – tarmen.

En mjuk tugga om dagen: sporbildande probiotika + prebiotika + omega-3. Tre saker i en.

✅ 399 kr (ord. 449)
✅ 30 dagars nöjdhetsgaranti
✅ Svenskt lager, snabb leverans`],
    heads: ["Slickar, kliar, äter gräs? Samma orsak.", "3-i-1 Probiotika – 399 kr, 30 dagars garanti"],
    desc: "Sporbildande probiotika + prebiotika + omega-3 i en mjuk tugga.",
  },
  {
    dir: "2026-09-01 - Statics #2 - Probiotika URSAKT",
    adset: "SE Gene Sep1 - Statics #2 - URSAKT - PROBIOTIKA - 399 - Skeptic",
    pts: [
`Till dig som redan gett din hund probiotika – utan att märka någon skillnad.

Du gjorde inget fel. Många probiotika är känsliga bakterier som har svårt att klara magsäckens sura miljö. De kommer helt enkelt inte fram till tarmen, och då spelar det ingen roll vad etiketten lovar.

Vår stam är sporbildande. Den har ett skyddande skal som håller tills den är framme där den ska verka. I samma tugga finns prebiotika (mat åt de goda bakterierna) och omega-3.

Ge det 30 dagar. Ser du ingen skillnad på mage, tassar eller päls får du pengarna tillbaka.

399 kr (ord. 449).`,
`Vi ber om ursäkt – å hela kategorins vägnar.

Om du köpt probiotika till hunden och ingenting hände, är det troligen inte hunden det är fel på. Det är ofta att bakterierna inte klarar resan genom magsäcken.

3-i-1 Probiotika: sporbildande probiotika med skyddande skal + prebiotika + omega-3. En mjuk tugga om dagen som hunden tar som godis.

30 dagars nöjdhetsgaranti. 399 kr (ord. 449).`],
    heads: ["Redan testat probiotika utan resultat?", "Sporbildande – kommer fram till tarmen"],
    desc: "3-i-1: probiotika + prebiotika + omega-3. 30 dagars garanti.",
  },
];

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-gene-statics-12-state.json`;

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

console.log(`\n=== Gene Statics #1/#2 → ProBiotics // ABO ${DRY ? "(DRY RUN)" : "LIVE"} ===`);
console.log(`Landers: 7R (LEARN_MORE) + PP (SHOP_NOW) | 300 kr/dag\n`);

console.log("── preflight ──");
for (const l of LINKS) {
  const r = await fetch(l.url, { method: "HEAD", redirect: "manual" });
  console.log(`  ${l.key}: HTTP ${r.status} ${r.status === 200 ? "✓" : "⚠️"}`);
  if (r.status !== 200) throw new Error(`Lander ${l.key} svarar ${r.status}`);
}
for (const s of SETS) for (const h of ["H1", "H2", "H3"]) {
  if (!existsSync(`${ROOT}/${s.dir}/${h}.png`)) throw new Error(`${s.dir}/${h}.png saknas`);
}
console.log("  alla 6 bilder finns ✓");
const existing = await gGet(`/${CAMPAIGN_ID}/adsets`, { fields: "name", limit: "500" });
const existingNames = new Set((existing.data || []).map((a) => a.name));
console.log(`  dublettkontroll: ${existingNames.size} befintliga ad sets`);
for (const s of SETS) if (existingNames.has(s.adset)) throw new Error(`DUBBLETT: "${s.adset}" finns redan`);
console.log("  inga namnkrockar ✓");

if (DRY) {
  for (const s of SETS) { console.log(`\nAD SET: ${s.adset}`); for (const h of ["H1","H2","H3"]) for (const l of LINKS) console.log(`   ${h} [${l.key}]`); }
  console.log("\n(dry run — inget skickat)"); process.exit(0);
}

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
    if (!img?.hash) throw new Error(`${h}: ingen hash i svaret`);
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
                        ${JSON.stringify({ adName: name, adCopy: { headlines: s.heads, primaryTexts: s.pts, description: s.desc, linkUrl: link.url, ctaType: link.cta }, pageId: PAGE, pixelId: PIXEL, adAccountId: ACT, source: "publish-ah-gene-statics-12" })}::jsonb, now())`;
    } catch (e) { console.warn(`    (upload_jobs: ${e.message})`); }
  }
}
const total = Object.values(state.sets).reduce((n, b) => n + Object.keys(b.ads).length, 0);
console.log(`\n=== KLART: 2 ad sets, ${total} annonser ===`);
