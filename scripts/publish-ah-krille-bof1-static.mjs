import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// ── ApotekHunden Probiotika BOF — Krille BOF1 (statiska bilder) ──────────────
// 3 PNG → /adimages (base64) → 3 ads i BEFINTLIGA ad set:et i
// "ProBiotics // BOF SALE // CBO" (döps om till "BOF1").
// Template 28 "PP + LP12 nya Primärtexterna" men ENDAST PP-länken.
// Båda primärtexterna + båda headlines som Flexible Ads. Krille = editor/creator.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";           // Glimmora (ApotekHunden)
const CAMP = "120254640675650350";            // ProBiotics // BOF SALE // CBO
const ADSET_ID = "120254640676180350";        // befintligt (tomt) BOF-ad set → döps om
const ADSET_NAME = "BOF1";
const PAGE = "265790413295490";               // Apotek Hunden
const TEMPLATE_ID = 28;                       // "PP + LP12 nya Primärtexterna"
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";
const LINK = "https://www.apotekhunden.se/products/apotekhunden-probiotika"; // endast PP
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const SRC_DIR = "/Users/kristoffermacbook/Downloads/SE BOF 1 - BELÖNINGSPÅSAR";
const HOOKS = ["H1", "H2", "H3", "H4"];
const AD_NAME = (hook) => `${hook} SE Krille BOF1 - #1 - STATIC - PP - Evergreen - Belöningspåsar - Krille`;
const EDITOR_NAME = "Krille";
const BATCH_NUMBER = "BOF1";

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/95207984-1a3d-405d-9d68-d2147dec1f74/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-krille-bof1-static-state.json`;

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
const gPostForm = (p, form) => {
  form.append("access_token", TOKEN);
  return reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, { method: "POST", body: form }));
};

// ── state ────────────────────────────────────────────────────────────────────
let state = { renamed: false, images: {}, ads: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── steps ────────────────────────────────────────────────────────────────────
async function renameAdset() {
  if (state.renamed) { console.log(`  ad set redan omdöpt till ${ADSET_NAME}`); return; }
  const form = new FormData();
  form.append("name", ADSET_NAME);
  await gPostForm(`/${ADSET_ID}`, form);
  state.renamed = true; save();
  console.log(`  ✓ ad set ${ADSET_ID} omdöpt till "${ADSET_NAME}"`);
}

async function uploadImage(hook) {
  if (state.images[hook]?.hash) { console.log(`  ${hook}: redan uppladdad (${state.images[hook].hash})`); return; }
  const path = `${SRC_DIR}/${hook}.png`;
  const b64 = readFileSync(path).toString("base64");
  const form = new FormData();
  form.append("bytes", b64); // Meta /adimages vill ha base64-sträng, inte binär Blob
  form.append("name", `${hook} SE Krille BOF1.png`);
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
  // Flexible Ads med bild: object_story_spec MÅSTE ha link_data som matchar
  // första asseten i gruppen (annars fel 2061015/3858355). Exakt samma fält
  // som appens createAdWithTextOptions i src/lib/meta/ads.ts.
  const storySpec = {
    page_id: PAGE,
    link_data: {
      link: LINK,
      image_hash: hash,
      call_to_action: { type: CTA },
    },
  };

  const form = new FormData();
  form.append("adset_id", ADSET_ID);
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
              VALUES (${hook + ".png"}, 'image', 'completed', 3, 3, 'Klar!', ${CAMP}, ${ADSET_ID}, ${r.id},
                      ${JSON.stringify({ adName: name, adCopy: { headlines: HEADLINES, primaryTexts: TEXTS, linkUrl: LINK, ctaType: CTA }, pageId: PAGE, adAccountId: ACT, imageHash: hash, source: "publish-ah-krille-bof1-static" })}::jsonb,
                      now())`;
  } catch (e) { console.warn(`    (upload_jobs-rad misslyckades, icke-kritiskt: ${e.message})`); }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`\n=== ApotekHunden BOF1 Belöningspåsar (statiska) ${DRY ? "(DRY RUN)" : "LIVE LAUNCH"} ===`);
console.log(`Kampanj: ProBiotics // BOF SALE // CBO (${CAMP})  |  ad set: "${ADSET_NAME}" (${ADSET_ID})`);
console.log(`Template ${TEMPLATE_ID}: ${tpl.name}  |  ENDAST PP-länk: ${LINK}`);
console.log(`Sida: ${PAGE} (Apotek Hunden)  |  CTA ${CTA}  |  status ${STATUS}`);
console.log(`Headlines: ${JSON.stringify(HEADLINES)}`);
console.log(`Primärtexter: ${TEXTS.length} st`);
console.log(`\n3 bilder → 3 annonser (OBS: H1 och H2 är identiska filer — launchas ändå på Kristoffers begäran):`);
for (const h of HOOKS) console.log(`  ${h}.png → ${AD_NAME(h)}`);

if (DRY) { console.log("\n(dry run — inget skickat)"); process.exit(0); }

console.log("\n── ad set ──");
await renameAdset();
console.log("── bilder ──");
for (const h of HOOKS) await uploadImage(h);
console.log("── annonser ──");
for (const h of HOOKS) await createAd(h);
console.log(`\n=== KLART: ad set ${ADSET_ID} ("${ADSET_NAME}"), ${Object.keys(state.ads).length} annonser ===`);
