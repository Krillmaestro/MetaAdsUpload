import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ── SmallDogCO Scratching — Fervin Jul1.V2 ───────────────────────────────────
// 1 ad set into "SmallDogCO Itch Relief // ABO" at $35/day. 3 hooks × 2 landing
// pages (PP + ITCH2) = 6 ads. Same pipeline as publish-smdco-fervin-jul14.mjs
// (US/CA/AU, 18-65, advantage audience, mobile FB+IG, 7d-click/1d-view/1d-EV),
// Josephine Hart page, Itch template 21. ITCH2-url verifierad mot Fervin Jul13.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_2277004866371824";        // DogDivaCOmain (hosts SmallDogCO)
const CAMP = "120252346982420782";          // SmallDogCO Itch Relief // ABO
const PIXEL = "3401593933335351";           // SMDCO pixel
const PAGE = "111818175275493";             // Dr. Kathrina Lindley
const TEMPLATE_ID = 21;                     // SmallDogCO Allergy & Itch (Itch-templaten)
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";                    // launch live, som vanligt
const DAILY_BUDGET = 3500;                  // $35.00/day (cents)
const URL_TAGS = "utm_source=fb&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const SRC_DIR = "/Users/kristoffermacbook/Downloads/SMALL DOG 14";
// Filnamnens "TBD"-slot ersätts med LP-nyckeln per annons (PP/ITCH2), som Fervin Jul13.
const ADSET_NAME = "USA Fervin Jul14 - #1 - VSL - LP1 + ITCH - Evergreen - Scratching - Oskar";
const AD_NAME = (hook, lp) => `${hook} USA Fervin Jul14 - #1 - VSL - ${lp} - Evergreen - Scratching - Oskar`;
const EDITOR_NAME = "Fervin";
const BATCH_NUMBER = "Jul14";

const LINKS = [
  { key: "LP1", url: "https://thesmalldogco.com/pages/listicle1" },
  { key: "ITCH", url: "https://thesmalldogco.com/pages/itch2" },
];

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/6dfe89ce-88a6-4638-a275-2d2a5326d193/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/smdco-fervin-jul14-state.json`;

// ── env + token ──────────────────────────────────────────────────────────────
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const TOKEN = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0].access_token;
const tpl = (await sql`SELECT name, headlines, primary_texts FROM templates WHERE id=${TEMPLATE_ID}`)[0];
const HEADLINES = (tpl.headlines || []).filter(Boolean).slice(0, 2);
const TEXTS = (tpl.primary_texts || []).filter(Boolean).slice(0, 2);
if (!HEADLINES.length || !TEXTS.length) throw new Error(`Template ${TEMPLATE_ID} saknar copy`);

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
});
const R2_BUCKET = clean(process.env.R2_BUCKET_NAME);
const R2_PUBLIC = clean(process.env.R2_PUBLIC_URL).replace(/\/$/, "");

// ── state ────────────────────────────────────────────────────────────────────
let state = { videos: {}, adsetId: null, ads: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── discovery ────────────────────────────────────────────────────────────────
const videos = readdirSync(SRC_DIR)
  .filter((f) => /\.(mp4|mov)$/i.test(f) && !f.startsWith("."))
  .map((f) => ({ hook: (f.match(/^(H\d+)/i)?.[1] || f).toUpperCase(), file: f }))
  .sort((a, b) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b.hook.slice(1)) || 0));
if (!videos.length) throw new Error(`Inga videor i ${SRC_DIR}`);

// ── steps ────────────────────────────────────────────────────────────────────
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
    console.log(`  ${v.hook}: laddar upp ${(size / 1024 / 1024).toFixed(0)}MB till R2...`);
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: createReadStream(path),
      ContentLength: size,
      ContentType: /\.mov$/i.test(v.file) ? "video/quicktime" : "video/mp4",
    }));
    state.videos[v.hook] = { r2Key: key, r2Url: publicUrl, fileSize: size }; save();

    const head = await fetch(publicUrl, { method: "HEAD" });
    if (!head.ok) throw new Error(`${v.hook}: R2-objektet är inte publikt läsbart (${head.status}) — Meta kan inte hämta det`);
    console.log(`  ${v.hook}: R2 ok → ${publicUrl}`);

    try {
      await sql`INSERT INTO creatives (name, type, source, r2_key, r2_url, file_size, editor_name, batch_number, status)
                VALUES (${v.file}, 'video', 'r2', ${key}, ${publicUrl}, ${size}, ${EDITOR_NAME}, ${BATCH_NUMBER}, 'uploaded')`;
    } catch (e) { console.warn(`  ${v.hook}: kunde inte skriva creatives-rad (icke-kritiskt): ${e.message}`); }
  }

  const up = await gPostJson(`/${ACT}/advideos`, { file_url: publicUrl, title: v.file.replace(/\.[^.]+$/, "") });
  state.videos[v.hook].videoId = up.id; save();
  console.log(`  ${v.hook}: video_id=${up.id} — bearbetas...`);

  const start = Date.now();
  let iv = 5000, ready = false;
  while (Date.now() - start < 900000) {
    const r = await gGet(`/${up.id}`, { fields: "status" });
    const st = r.status?.video_status;
    if (st === "ready") { ready = true; break; }
    if (st === "error") throw new Error(`${v.hook}: Meta misslyckades bearbeta videon`);
    await sleep(iv); iv = Math.min(iv * 1.4, 15000);
  }

  let thumb = null;
  try {
    const t = await gGet(`/${up.id}/thumbnails`);
    if (t.data?.length) thumb = (t.data.find((x) => x.is_preferred) || t.data[0]).uri;
    if (!thumb) thumb = (await gGet(`/${up.id}`, { fields: "picture" })).picture || null;
  } catch {}
  state.videos[v.hook].thumbnailUrl = thumb;
  state.videos[v.hook].ready = ready; save();

  try {
    await sql`UPDATE creatives SET meta_video_id=${up.id}, thumbnail_url=${thumb}
              WHERE r2_key=${state.videos[v.hook].r2Key}`;
  } catch {}

  console.log(`  ${v.hook}: ${ready ? "klar" : "timeout — fortsätter ändå"}, thumbnail=${thumb ? "ja" : "nej"}`);
}

async function createAdSet() {
  if (state.adsetId) { console.log(`  ad set finns redan: ${state.adsetId}`); return; }
  const r = await gPostJson(`/${ACT}/adsets`, {
    campaign_id: CAMP,
    name: ADSET_NAME,
    daily_budget: DAILY_BUDGET,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    promoted_object: { pixel_id: PIXEL, custom_event_type: "PURCHASE" },
    attribution_spec: [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
      { event_type: "ENGAGED_VIDEO_VIEW", window_days: 1 },
    ],
    targeting: {
      age_min: 18,
      age_max: 65,
      geo_locations: { countries: ["US", "CA", "AU"], location_types: ["home", "recent"] },
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ["facebook", "instagram"],
      device_platforms: ["mobile"],
    },
    status: STATUS,
  });
  state.adsetId = r.id; save();
  console.log(`  ✓ ad set: ${r.id} — ${ADSET_NAME}`);
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
              VALUES (${v.file}, 'video', 'completed', 4, 4, 'Klar!', ${vid.r2Key}, ${vid.r2Url}, ${CAMP},
                      ${state.adsetId}, ${r.id}, ${vid.videoId},
                      ${JSON.stringify({ adName: name, adCopy: { headlines: HEADLINES, primaryTexts: TEXTS, linkUrl: link.url, ctaType: CTA }, pageId: PAGE, pixelId: PIXEL, adAccountId: ACT, source: "publish-smdco-fervin-jul14" })}::jsonb,
                      now())`;
  } catch (e) { console.warn(`    (upload_jobs-rad misslyckades, icke-kritiskt: ${e.message})`); }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`\n=== SmallDogCO Fervin Jul14 ${DRY ? "(DRY RUN — inga skrivningar)" : "LIVE LAUNCH"} ===`);
console.log(`Kampanj: SmallDogCO Itch Relief // ABO (${CAMP})  |  konto ${ACT}`);
console.log(`Template ${TEMPLATE_ID}: ${tpl.name}  |  sida ${PAGE} (Dr. Kathrina Lindley)  |  pixel ${PIXEL}`);
console.log(`Ad set: ${ADSET_NAME}`);
console.log(`Budget: $${(DAILY_BUDGET / 100).toFixed(2)}/dag  |  US+CA+AU, 18-65, mobil FB+IG  |  status ${STATUS}`);
console.log(`Headlines: ${JSON.stringify(HEADLINES)}`);
console.log(`Primärtexter: ${TEXTS.length} st (${TEXTS.map((t) => t.length + " tecken").join(", ")})`);
console.log(`\n${videos.length} videor × ${LINKS.length} landningssidor = ${videos.length * LINKS.length} annonser:`);
for (const v of videos) {
  const mb = (statSync(`${SRC_DIR}/${v.file}`).size / 1024 / 1024).toFixed(0);
  console.log(`  ${v.hook} (${mb}MB) ${v.file}`);
  for (const l of LINKS) console.log(`     → ${AD_NAME(v.hook, l.key)}  →  ${l.url}`);
}

if (DRY) { console.log("\n(dry run — inget skickat)"); process.exit(0); }

console.log("\n── videor ──");
for (const v of videos) await uploadVideo(v);
console.log("── ad set ──");
await createAdSet();
console.log("── annonser ──");
for (const v of videos) for (const link of LINKS) {
  try { await createAd(v, link); }
  catch (e) { console.error(`    ✗ ${v.hook}|${link.key}: ${e.message}`); }
}

const made = Object.keys(state.ads).length;
console.log(`\nSUMMERING: ad set ${state.adsetId} — ${made}/${videos.length * LINKS.length} annonser`);
console.log(`Ads Manager: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ACT.replace("act_", "")}&selected_adset_ids=${state.adsetId}`);
