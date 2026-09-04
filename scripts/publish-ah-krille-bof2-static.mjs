import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// ── ApotekHunden Probiotika BOF — Krille BOF2 (statiska bilder) ──────────────
// 3 PNG → /adimages (base64) → NYTT ad set "BOF2" i "ProBiotics // BOF SALE // CBO".
// Samma upplägg som BOF1: template 28 men ENDAST PP-länken, båda primärtexterna
// + båda headlines som Flexible Ads, Apotek Hunden-sidan. Kreativ: bundle-offer
// (2 burkar + gratis Belöningsbitar+ + e-bok, 719 kr).
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";           // Glimmora (ApotekHunden)
const CAMP = "120254640675650350";            // ProBiotics // BOF SALE // CBO
const ADSET_NAME = "BOF2";
const PAGE = "265790413295490";               // Apotek Hunden
const PIXEL = "1485774658810931";
const TEMPLATE_ID = 28;                       // "PP + LP12 nya Primärtexterna"
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";
const LINK = "https://www.apotekhunden.se/products/apotekhunden-probiotika"; // endast PP
const EXCLUDES = ["120242809727280350", "120250065842190350"]; // 180d-köpare + Återkommande Kunder (BOF-standard)
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const SRC_DIR = "/Users/kristoffermacbook/Downloads/BOF2";
const HOOKS = ["H1", "H2", "H3"];
const AD_NAME = (hook) => `${hook} SE Krille BOF2 - #1 - STATIC - PP - Evergreen - SpecialOffer - Krille`;
const EDITOR_NAME = "Krille";
const BATCH_NUMBER = "BOF2";

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/95207984-1a3d-405d-9d68-d2147dec1f74/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-krille-bof2-static-state.json`;

// ── env + token ──────────────────────────────────────────────────────────────
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const TOKEN = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0].access_token;
const tpl = (await sql`SELECT name, headlines, primary_texts, landing_pages FROM templates WHERE id=${TEMPLATE_ID}`)[0];
const HEADLINES = (tpl.headlines || []).filter(Boolean).slice(0, 2);
const TEXTS = (tpl.primary_texts || []).filter(Boolean).slice(0, 2);
if (!HEADLINES.length || !TEXTS.length) throw new Error(`Template ${TEMPLATE_ID} saknar copy`);
if (!(tpl.landing_pages || []).includes(LINK)) throw new Error(`PP-länken finns inte i templatens landing_pages`);

// ── graph helpers ────────────────────────────────────────────────────────────
const BASE = "https://graph.facebook.com/v25.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reqJson(label, mkFetch, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let res, text;
    try { res = await mkFetch(); text = await res.text(); }
    catch (e) { lastErr = e; await sleep(Math.min(2000 * 2 ** i, 20000)); continue; }
    let j;
    try { j = JSON.parse(text); }
    catch { lastErr = new Error(`${label}: non-JSON body (status ${res.status})`); await sleep(Math.min(2000 * 2 ** i, 20000)); continue; }
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
const gPostJson = (p, body) => reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
}));
const gPostForm = (p, form) => {
  form.append("access_token", TOKEN);
  return reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, { method: "POST", body: form }));
};

// ── state ────────────────────────────────────────────────────────────────────
let state = { adsetId: null, images: {}, ads: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── steps ────────────────────────────────────────────────────────────────────
async function createAdSet() {
  if (state.adsetId) { console.log(`  ad set finns redan: ${state.adsetId}`); return; }
  // CBO-kampanj → ingen budget på ad set. Samma konfig som BOF1-ad set:et.
  const r = await gPostJson(`/${ACT}/adsets`, {
    campaign_id: CAMP,
    name: ADSET_NAME,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    promoted_object: { pixel_id: PIXEL, custom_event_type: "PURCHASE" },
    attribution_spec: [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "ENGAGED_VIDEO_VIEW", window_days: 1 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
    ],
    targeting: {
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ["SE"], location_types: ["home", "recent"] },
      targeting_automation: { advantage_audience: 1 },
      excluded_custom_audiences: EXCLUDES.map((id) => ({ id })),
    },
    status: STATUS,
  });
  state.adsetId = r.id; save();
  console.log(`  ✓ ad set: ${r.id} — ${ADSET_NAME}`);
}

async function uploadImage(hook) {
  if (state.images[hook]?.hash) { console.log(`  ${hook}: redan uppladdad (${state.images[hook].hash})`); return; }
  const path = `${SRC_DIR}/${hook}.png`;
  const b64 = readFileSync(path).toString("base64");
  const form = new FormData();
  form.append("bytes", b64);
  form.append("name", `${hook} SE Krille BOF2.png`);
  const r = await gPostForm(`/${ACT}/adimages`, form);
  const img = Object.values(r.images || {})[0];
  if (!img?.hash) throw new Error(`${hook}: fick ingen image_hash tillbaka: ${JSON.stringify(r)}`);
  state.images[hook] = { hash: img.hash, url: img.url }; save();
  console.log(`  ✓ ${hook}: image_hash=${img.hash}`);

  try {
    await sql`INSERT INTO creatives (name, type, source, file_size, editor_name, batch_number, status, thumbnail_url)
              VALUES (${hook + ".png"}, 'image', 'direct', ${statSync(path).size}, ${EDITOR_NAME}, ${BATCH_NUMBER}, 'uploaded', ${img.url || null})`;
  } catch (e) { console.warn(`  ${hook}: kunde inte skriva creatives-rad (icke-kritiskt): ${e.message}`); }
}

async function createAd(hook) {
  if (state.ads[hook]?.adId) { console.log(`    ${hook}: finns redan (${state.ads[hook].adId})`); return; }
  const hash = state.images[hook].hash;
  const name = AD_NAME(hook);

  const texts = [
    ...TEXTS.map((text) => ({ text, text_type: "primary_text" })),
    ...HEADLINES.map((text) => ({ text, text_type: "headline" })),
  ];
  const group = {
    texts,
    call_to_action: { type: CTA, value: { link: LINK } },
    images: [{ hash }],
  };
  const storySpec = {
    page_id: PAGE,
    link_data: {
      link: LINK,
      image_hash: hash,
      call_to_action: { type: CTA },
    },
  };

  const form = new FormData();
  form.append("adset_id", state.adsetId);
  form.append("name", name);
  form.append("status", STATUS);
  form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
  form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));

  const r = await gPostForm(`/${ACT}/ads`, form);
  state.ads[hook] = { adId: r.id, name }; save();
  console.log(`    ✓ ${hook}: ${r.id}  "${name}"`);

  try {
    await sql`INSERT INTO upload_jobs (filename, media_type, status, total_steps, current_step, step_label,
                                       campaign_id, adset_id, ad_id, config, completed_at)
              VALUES (${hook + ".png"}, 'image', 'completed', 3, 3, 'Klar!', ${CAMP}, ${state.adsetId}, ${r.id},
                      ${JSON.stringify({ adName: name, adCopy: { headlines: HEADLINES, primaryTexts: TEXTS, linkUrl: LINK, ctaType: CTA }, pageId: PAGE, adAccountId: ACT, imageHash: hash, source: "publish-ah-krille-bof2-static" })}::jsonb,
                      now())`;
  } catch (e) { console.warn(`    (upload_jobs-rad misslyckades, icke-kritiskt: ${e.message})`); }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`\n=== ApotekHunden BOF2 SpecialOffer (statiska) ${DRY ? "(DRY RUN)" : "LIVE LAUNCH"} ===`);
console.log(`Kampanj: ProBiotics // BOF SALE // CBO (${CAMP})  |  nytt ad set: "${ADSET_NAME}"`);
console.log(`Template ${TEMPLATE_ID}: ${tpl.name}  |  ENDAST PP-länk: ${LINK}`);
console.log(`Sida: ${PAGE} (Apotek Hunden)  |  CTA ${CTA}  |  status ${STATUS}`);
console.log(`Headlines: ${JSON.stringify(HEADLINES)}  |  Primärtexter: ${TEXTS.length} st`);
console.log(`\n3 bilder → 3 annonser:`);
for (const h of HOOKS) console.log(`  ${h}.png → ${AD_NAME(h)}`);

if (DRY) { console.log("\n(dry run — inget skickat)"); process.exit(0); }

console.log("\n── ad set ──");
await createAdSet();
console.log("── bilder ──");
for (const h of HOOKS) await uploadImage(h);
console.log("── annonser ──");
for (const h of HOOKS) await createAd(h);
console.log(`\n=== KLART: ad set ${state.adsetId} ("${ADSET_NAME}"), ${Object.keys(state.ads).length} annonser ===`);
