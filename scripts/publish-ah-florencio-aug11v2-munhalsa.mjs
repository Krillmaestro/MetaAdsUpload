import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ── ApotekHunden Munhälsa — Florencio Aug11.V2 (MUNHALSA 22) ───────────────────────
// 1 ad set into "Munhälsa // CBO" (CBO → ingen ad set-budget). 3 hooks × 2 LPs
// (PP + 5R från template 14 "Munhälsa 5R + PP") = 6 ads. SE, 18-65, advantage
// audience, alla placeringar, attribution 7d-klick + 1d-view (kampanjens stil),
// default-exkludering av audience 120250065842190350. Sida: Josephine Hart.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";          // Glimmora (ApotekHunden)
const CAMP = "120248826608070350";           // Munhälsa // CBO
const PIXEL = "1485774658810931";            // ApotekHunden-pixeln
const PAGE = "1290404807478582";              // Josephine Hart
const TEMPLATE_ID = 14;                      // "Munhälsa 5R + PP"
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";                     // launch live, som vanligt
const EXCLUDED_AUDIENCES = ["120250065842190350"]; // default_exclusions för kontot
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const SRC_DIR = "/Users/kristoffermacbook/Downloads/Munhälsa launch/BATCH 11.V2 SWEDISH";
const ADSET_NAME = "SE Florencio Aug11.V2 - #0 - UGC - PP + 5R - Evergreen - OralHealth - Oskar";
const AD_NAME = (hook, lp) => `${hook} SE Florencio Aug11.V2 - #0 - UGC - ${lp} - Evergreen - OralHealth - Oskar`;
const EDITOR_NAME = "Florencio";
const BATCH_NUMBER = "Aug11.V2";

const LINKS = [
  { key: "PP", url: "https://www.apotekhunden.se/products/munhalsa" },
  { key: "5R", url: "https://www.apotekhunden.se/pages/munhalsa-5-tecken" },
];

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/95207984-1a3d-405d-9d68-d2147dec1f74/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-flo11v2-aug11v2-munhalsa-state.json`;

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
// Sanity: LP-URL:erna i scriptet ska matcha templatens landing_pages
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
// Uppfarten stallar på långa överföringar → korta socket-timeouts så en död
// part avbryts och görs om, i stället för att hänga för evigt.
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
  // CBO-kampanj → INGEN daily_budget och ingen bid_strategy på ad set-nivå.
  // Ingen destination_type — speglar kampanjens befintliga ad sets (UNDEFINED).
  const r = await gPostJson(`/${ACT}/adsets`, {
    campaign_id: CAMP,
    name: ADSET_NAME,
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
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
                      ${JSON.stringify({ adName: name, adCopy: { headlines: HEADLINES, primaryTexts: TEXTS, linkUrl: link.url, ctaType: CTA }, pageId: PAGE, pixelId: PIXEL, adAccountId: ACT, source: "publish-ah-flo11v2-aug11v2-munhalsa" })}::jsonb,
                      now())`;
  } catch (e) { console.warn(`    (upload_jobs-rad misslyckades, icke-kritiskt: ${e.message})`); }
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log(`\n=== ApotekHunden Munhälsa Florencio Aug11.V2 ${DRY ? "(DRY RUN — inga skrivningar)" : "LIVE LAUNCH"} ===`);
console.log(`Kampanj: Munhälsa // CBO (${CAMP})  |  konto ${ACT} (Glimmora)`);
console.log(`Template ${TEMPLATE_ID}: ${tpl.name}  |  sida ${PAGE} (Josephine Hart)  |  pixel ${PIXEL}`);
console.log(`Ad set: ${ADSET_NAME}`);
console.log(`CBO — ingen ad set-budget  |  SE, 18-65, advantage audience, alla placeringar  |  attribution 7d-klick + 1d-view  |  status ${STATUS}`);
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

console.log("\n── videor ──");
for (const v of videos) await uploadVideo(v);
console.log("── ad set ──");
await createAdSet();
console.log("── annonser ──");
for (const v of videos) for (const link of LINKS) {
  await createAd(v, link);
}
console.log(`\n=== KLART: ad set ${state.adsetId}, ${Object.keys(state.ads).length} annonser ===`);
