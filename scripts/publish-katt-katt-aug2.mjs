import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ── ApotekHunden Probiotika — Fervin Aug2 (BATCH 29.V6) ─────────────────────
// NY standard (Kristoffer 2026-08-16): Probiotika launchas i "Probiotika // ABO"
// med 300 kr/dag per ad set. Kampanjen skapas här om den inte finns.
// 4 hooks × 2 LPs (PP + 7R från template 28 "PP + 7R nya Primärtexterna")
// = 8 ads. SE, 18-65, advantage audience, alla placeringar, attribution
// 7d-klick + 1d-view (Probiotika-husstilen), default-exkludering. Sida: Apotek Hunden.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";          // Glimmora (ApotekHunden)
const CAMPAIGN_NAME = "KattMunhälsa // ABO"; // befintlig kampanj 120254747446630350
const PIXEL = "1485774658810931";            // ApotekHunden-pixeln
const PAGE = "265790413295490";              // Apotek Hunden
const TEMPLATE_ID = 29;                      // "PP + 7R nya Primärtexterna"
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";                     // launch live, som vanligt
const DAILY_BUDGET = 35000;                  // 300 kr/dag i öre (ABO — budget på ad set)
const EXCLUDED_AUDIENCES = ["120250065842190350"]; // default_exclusions för kontot
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const SRC_DIR = "/Users/kristoffermacbook/Downloads/CAT MUNHALSA 2";
// Filnamnens LP-slot är tom → fylls med PP/LP12 per annons.
const ADSET_NAME = "SE Fervin Aug2 - #0 - VSL - PP + 7R - Evergreen - MIX - Oskar";
const AD_NAME = (hook, lp) => `${hook} SE Fervin Aug2 - #0 - VSL - ${lp} - Evergreen - MIX - Oskar`;
const EDITOR_NAME = "Fervin";
const BATCH_NUMBER = "Aug2";

const LINKS = [
  { key: "PP", url: "https://www.apotekhunden.se/products/munhalsa-for-katter" },
  { key: "7R", url: "https://www.apotekhunden.se/pages/7-skal-till-att-det-har-tandvardspulvret-ersatter-borstning" },
];

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/95207984-1a3d-405d-9d68-d2147dec1f74/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-fervin-katt-aug2-probiotika-state.json`;

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
for (const l of LINKS) {
  if (!(tpl.landing_pages || []).includes(l.url)) throw new Error(`LP ${l.key} (${l.url}) finns inte i templatens landing_pages`);
}

// ── graph helpers ────────────────────────────────────────────────────────────
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
const gGet = (p, q = {}) => {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  return reqJson(`GET ${p}`, () => fetch(u));
};
const gPostJson = (p, body) => reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
}));
const gPostForm = (p, form) => {
  form.append("access_token", TOKEN);
  return reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, { method: "POST", body: form }));
};

// ── r2 ───────────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${clean(process.env.R2_ACCOUNT_ID)}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: clean(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY),
  },
  forcePathStyle: true,
  maxAttempts: 8,
  requestHandler: new NodeHttpHandler({ connectionTimeout: 10000, socketTimeout: 90000 }),
});
const R2_BUCKET = clean(process.env.R2_BUCKET_NAME);
const R2_PUBLIC = clean(process.env.R2_PUBLIC_URL).replace(/\/$/, "");

// ── state ────────────────────────────────────────────────────────────────────
let state = { campaignId: null, videos: {}, adsetId: null, ads: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── discovery ────────────────────────────────────────────────────────────────
const videos = readdirSync(SRC_DIR)
  .filter((f) => /\.(mp4|mov)$/i.test(f) && !f.startsWith("."))
  .map((f) => ({ hook: (f.match(/^(H\d+)/i)?.[1] || f).toUpperCase(), file: f }))
  .sort((a, b) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b.hook.slice(1)) || 0));
if (!videos.length) throw new Error(`Inga videor i ${SRC_DIR}`);

// ── steps ────────────────────────────────────────────────────────────────────
async function ensureCampaign() {
  if (state.campaignId) { console.log(`  kampanj finns redan i state: ${state.campaignId}`); return; }
  // Återanvänd befintlig kampanj med exakt samma namn om den finns
  const existing = await gGet(`/${ACT}/campaigns`, { fields: "name,effective_status", limit: "200" });
  const hit = (existing.data || []).find((c) => c.name === CAMPAIGN_NAME);
  if (hit) {
    state.campaignId = hit.id; save();
    console.log(`  ✓ återanvänder kampanj: ${hit.id} — ${CAMPAIGN_NAME} (${hit.effective_status})`);
    return;
  }
  const r = await gPostJson(`/${ACT}/campaigns`, {
    name: CAMPAIGN_NAME,
    objective: "OUTCOME_SALES",
    buying_type: "AUCTION",
    special_ad_categories: [],
    status: STATUS,
    // ABO — ingen kampanjbudget; budgeten ligger på ad set-nivå.
    // false = strikt 300 kr per ad set, ingen 20%-delning mellan ad sets.
    is_adset_budget_sharing_enabled: false,
  });
  state.campaignId = r.id; save();
  console.log(`  ✓ kampanj skapad: ${r.id} — ${CAMPAIGN_NAME}`);
}

async function uploadVideo(v) {
  if (state.videos[v.hook]?.videoId) {
    console.log(`  ${v.hook}: redan uppladdad (${state.videos[v.hook].videoId})`);
    return;
  }
  const path = `${SRC_DIR}/${v.file}`;
  const size = statSync(path).size;

  const sanitized = v.file.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = state.videos[v.hook]?.r2Key || `library/${Date.now()}-${sanitized}`;
  const publicUrl = `${R2_PUBLIC}/${key}`;

  if (!state.videos[v.hook]?.r2Key) {
    console.log(`  ${v.hook}: laddar upp ${(size / 1024 / 1024).toFixed(0)}MB till R2 (multipart)...`);
    const up = new Upload({
      client: r2,
      params: {
        Bucket: R2_BUCKET,
        Key: key,
        Body: createReadStream(path),
        ContentType: /\.mov$/i.test(v.file) ? "video/quicktime" : "video/mp4",
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 1,
      leavePartsOnError: false,
    });
    let lastPct = -3;
    const t0 = Date.now();
    up.on("httpUploadProgress", (p) => {
      const loaded = p.loaded || 0;
      const pct = Math.floor((loaded / size) * 100);
      if (pct >= lastPct + 3) {
        lastPct = pct;
        const mbps = loaded / 1048576 / ((Date.now() - t0) / 1000);
        const etaMin = mbps > 0 ? ((size - loaded) / 1048576 / mbps / 60).toFixed(0) : "?";
        console.log(`  ${v.hook}: ${pct}%  (${(loaded / 1048576).toFixed(0)}/${(size / 1048576).toFixed(0)} MB, ${(mbps * 8).toFixed(1)} Mbit/s, ~${etaMin} min kvar på filen)`);
      }
    });
    await up.done();
    state.videos[v.hook] = { r2Key: key, r2Url: publicUrl, fileSize: size }; save();

    const head = await fetch(publicUrl, { method: "HEAD" });
    if (!head.ok) throw new Error(`${v.hook}: R2-objektet är inte publikt läsbart (${head.status}) — Meta kan inte hämta det`);
    console.log(`  ${v.hook}: R2 ok → ${publicUrl}`);

    try {
      await sql`INSERT INTO creatives (name, type, source, r2_key, r2_url, file_size, editor_name, batch_number, status)
                VALUES (${v.file}, 'video', 'r2', ${key}, ${publicUrl}, ${size}, ${EDITOR_NAME}, ${BATCH_NUMBER}, 'uploaded')`;
    } catch (e) { console.warn(`  ${v.hook}: kunde inte skriva creatives-rad (icke-kritiskt): ${e.message}`); }
  }

  const up2 = await gPostJson(`/${ACT}/advideos`, { file_url: publicUrl, title: v.file.replace(/\.[^.]+$/, "") });
  state.videos[v.hook].videoId = up2.id; save();
  console.log(`  ${v.hook}: video_id=${up2.id} — bearbetas...`);

  const start = Date.now();
  let iv = 5000, ready = false;
  while (Date.now() - start < 900000) {
    const r = await gGet(`/${up2.id}`, { fields: "status" });
    const st = r.status?.video_status;
    if (st === "ready") { ready = true; break; }
    if (st === "error") throw new Error(`${v.hook}: Meta misslyckades bearbeta videon`);
    await sleep(iv); iv = Math.min(iv * 1.4, 15000);
  }

  let thumb = null;
  try {
    const t = await gGet(`/${up2.id}/thumbnails`);
    if (t.data?.length) thumb = (t.data.find((x) => x.is_preferred) || t.data[0]).uri;
    if (!thumb) thumb = (await gGet(`/${up2.id}`, { fields: "picture" })).picture || null;
  } catch {}
  state.videos[v.hook].thumbnailUrl = thumb;
  state.videos[v.hook].ready = ready; save();

  try {
    await sql`UPDATE creatives SET meta_video_id=${up2.id}, thumbnail_url=${thumb}
              WHERE r2_key=${state.videos[v.hook].r2Key}`;
  } catch {}

  console.log(`  ${v.hook}: ${ready ? "klar" : "timeout — fortsätter ändå"}, thumbnail=${thumb ? "ja" : "nej"}`);
}

async function createAdSet() {
  if (state.adsetId) { console.log(`  ad set finns redan: ${state.adsetId}`); return; }
  // ABO — daily_budget på ad set-nivå (300 kr/dag enligt Kristoffers standard)
  const r = await gPostJson(`/${ACT}/adsets`, {
    campaign_id: state.campaignId,
    name: ADSET_NAME,
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
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ["SE"], location_types: ["home", "recent"] },
      targeting_automation: { advantage_audience: 1 },
      excluded_custom_audiences: EXCLUDED_AUDIENCES.map((id) => ({ id })),
    },
    status: STATUS,
  });
  state.adsetId = r.id; save();
  console.log(`  ✓ ad set: ${r.id} — ${ADSET_NAME} (${(DAILY_BUDGET / 100).toFixed(0)} kr/dag)`);
}

async function createAd(v, link) {
  const adKey = `${v.hook}|${link.key}`;
  if (state.ads[adKey]?.adId) { console.log(`    ${adKey}: finns redan (${state.ads[adKey].adId})`); return; }
  const vid = state.videos[v.hook];
  const name = AD_NAME(v.hook, link.key);

  const texts = [
    ...TEXTS.map((text) => ({ text, text_type: "primary_text" })),
    ...HEADLINES.map((text) => ({ text, text_type: "headline" })),
  ];
  const group = {
    texts,
    call_to_action: { type: CTA, value: { link: link.url } },
    videos: [{ video_id: vid.videoId, ...(vid.thumbnailUrl ? { thumbnail_url: vid.thumbnailUrl } : {}) }],
  };
  const storySpec = {
    page_id: PAGE,
    video_data: {
      video_id: vid.videoId,
      message: TEXTS[0],
      title: HEADLINES[0],
      link_description: HEADLINES[0],
      ...(vid.thumbnailUrl ? { image_url: vid.thumbnailUrl } : {}),
      call_to_action: { type: CTA, value: { link: link.url } },
    },
  };

  const form = new FormData();
  form.append("adset_id", state.adsetId);
  form.append("name", name);
  form.append("status", STATUS);
  form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
  form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));

  const r = await gPostForm(`/${ACT}/ads`, form);
  state.ads[adKey] = { adId: r.id, name, link: link.url }; save();
  console.log(`    ✓ ${adKey}: ${r.id}  "${name}"`);

  try {
    await sql`INSERT INTO upload_jobs (filename, media_type, status, total_steps, current_step, step_label,
                                       r2_key, r2_url, campaign_id, adset_id, ad_id, video_id, config, completed_at)
              VALUES (${v.file}, 'video', 'completed', 4, 4, 'Klar!', ${vid.r2Key}, ${vid.r2Url}, ${state.campaignId},
                      ${state.adsetId}, ${r.id}, ${vid.videoId},
                      ${JSON.stringify({ adName: name, adCopy: { headlines: HEADLINES, primaryTexts: TEXTS, linkUrl: link.url, ctaType: CTA }, pageId: PAGE, pixelId: PIXEL, adAccountId: ACT, source: "publish-ah-fervin-katt-aug2-probiotika" })}::jsonb,
                      now())`;
  } catch (e) { console.warn(`    (upload_jobs-rad misslyckades, icke-kritiskt: ${e.message})`); }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`\n=== ApotekHunden Probiotika Fervin Aug2 ${DRY ? "(DRY RUN — inga skrivningar)" : "LIVE LAUNCH"} ===`);
console.log(`Kampanj: ${CAMPAIGN_NAME} (skapas om den inte finns)  |  konto ${ACT} (Glimmora)`);
console.log(`Template ${TEMPLATE_ID}: ${tpl.name}  |  sida ${PAGE} (Apotek Hunden)  |  pixel ${PIXEL}`);
console.log(`Ad set: ${ADSET_NAME}`);
console.log(`ABO — ${(DAILY_BUDGET / 100).toFixed(0)} kr/dag på ad set  |  SE, 18-65, advantage audience, alla placeringar  |  attribution 7d-klick + 1d-view  |  status ${STATUS}`);
console.log(`Exkluderade audiences: ${EXCLUDED_AUDIENCES.join(", ")}`);
console.log(`Headlines: ${JSON.stringify(HEADLINES)}`);
console.log(`Primärtexter: ${TEXTS.length} st (${TEXTS.map((t) => t.length + " tecken").join(", ")})`);
console.log(`\n${videos.length} videor × ${LINKS.length} landningssidor = ${videos.length * LINKS.length} annonser:`);
for (const v of videos) {
  const mb = (statSync(`${SRC_DIR}/${v.file}`).size / 1024 / 1024).toFixed(0);
  console.log(`  ${v.hook} (${mb}MB) ${v.file}`);
  for (const l of LINKS) console.log(`     → ${AD_NAME(v.hook, l.key)}  →  ${l.url}`);
}

if (DRY) { console.log("\n(dry run — inget skickat)"); process.exit(0); }

console.log("\n── kampanj ──");
await ensureCampaign();
console.log("── videor ──");
for (const v of videos) await uploadVideo(v);
console.log("── ad set ──");
await createAdSet();
console.log("── annonser ──");
for (const v of videos) for (const link of LINKS) {
  await createAd(v, link);
}
console.log(`\n=== KLART: kampanj ${state.campaignId}, ad set ${state.adsetId}, ${Object.keys(state.ads).length} annonser ===`);
