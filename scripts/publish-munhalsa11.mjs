import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CAMPAIGN_ID = "120248826608070350"; // Munhälsa // CBO
const TEMPLATE_ID = 14;                    // "Munhälsa 5R + PP"
const AD_ACCOUNT = "act_261297039993717";  // Glimmora
const PAGE_ID = "483622214837771";
const PIXEL_ID = "1485774658810931";
const ADSET_NAME = "SE Fervin Jun11 - #0 - UGC - PP + 5R - Evergreen - OralHealth - Krille";
const STATUS = "ACTIVE";
const VIDEO_DIR = "C:/Users/krill/Downloads/MUNHALSA 11-20260710T105236Z-2-001/MUNHALSA 11";
const STATE_FILE = "C:/Users/krill/AppData/Local/Temp/claude/C--Users-krill/3790fc75-c98f-4e85-866c-d93d63404fd2/scratchpad/munhalsa11-state.json";
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

// 4 hooks. filename = the PP ad name + ".mp4"
const HOOKS = ["H1", "H2", "H3", "H4"];
const fileFor = (h) => `${h} SE Fervin Jun11 - #0 - UGC - PP - Evergreen - OralHealth - Krille.mp4`;
// Landing pages come from the template. Which name-token maps to which LP url:
// "PP" -> product page ; "5R" -> 5-tecken page
const LP_TOKENS = ["PP", "5R"];

// ─────────────────────────────────────────────────────────────────────────────
// env + token
// ─────────────────────────────────────────────────────────────────────────────
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const PREFIX = "enc:v1:";
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {}
  return createHash("sha256").update(raw).digest();
}
function decryptSecret(value) {
  if (!value.startsWith(PREFIX)) return value;
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
}
const sql = neon(process.env.DATABASE_URL);
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active = true LIMIT 1`;
const TOKEN = decryptSecret(cr[0].access_token);

// template
const tr = await sql`SELECT headlines, primary_texts, cta_type, landing_pages FROM templates WHERE id = ${TEMPLATE_ID}`;
const tpl = tr[0];
const HEADLINES = tpl.headlines;
const TEXTS = tpl.primary_texts;
const CTA = tpl.cta_type || "SHOP_NOW";
// map LP token -> url from the template's landing_pages
const lpUrls = tpl.landing_pages;
const url5R = lpUrls.find((u) => /munhalsa-5-tecken|5-tecken|pages\//.test(u));
const urlPP = lpUrls.find((u) => /products\/munhalsa/.test(u));
const LP_URL = { "PP": urlPP, "5R": url5R };
if (!LP_URL.PP || !LP_URL["5R"]) throw new Error("Could not resolve PP/5R landing pages from template: " + JSON.stringify(lpUrls));

console.log("Template:", { headlines: HEADLINES.length, texts: TEXTS.length, cta: CTA });
console.log("LP PP :", LP_URL.PP);
console.log("LP 5R :", LP_URL["5R"]);
console.log("Headlines:", HEADLINES);

// ─────────────────────────────────────────────────────────────────────────────
// Graph helpers
// ─────────────────────────────────────────────────────────────────────────────
const V = "v25.0";
const BASE = `https://graph.facebook.com/${V}`;
async function fbGet(path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", TOKEN);
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok) throw new Error(`GET ${path}: ${JSON.stringify(j.error)}`);
  return j;
}
async function fbPostJson(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) { const e = new Error(`POST ${path}: ${JSON.stringify(j.error)}`); e.meta = j.error; throw e; }
  return j;
}
async function fbPostForm(path, form) {
  form.append("access_token", TOKEN);
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form });
  const j = await res.json();
  if (!res.ok) { const e = new Error(`POST ${path}: ${JSON.stringify(j.error)}`); e.meta = j.error; throw e; }
  return j;
}

// ─────────────────────────────────────────────────────────────────────────────
// state (resumable)
// ─────────────────────────────────────────────────────────────────────────────
let state = { videos: {}, adsetId: null, ads: {} };
if (existsSync(STATE_FILE)) {
  try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {}
}
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ─────────────────────────────────────────────────────────────────────────────
// R2 (upload video -> public url -> Meta pulls it server-side)
// ─────────────────────────────────────────────────────────────────────────────
// .env.local stores some values with a literal "\n" escape inside the quotes
// (dotenv would expand+trim it; our parser doesn't) — strip it defensively.
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const R2_ACCOUNT = clean(process.env.R2_ACCOUNT_ID);
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: clean(process.env.R2_ACCESS_KEY_ID),
    secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY),
  },
  forcePathStyle: true,
});
const R2_BUCKET = clean(process.env.R2_BUCKET_NAME);
const R2_PUBLIC = clean(process.env.R2_PUBLIC_URL).replace(/\/$/, "");
console.log("R2 endpoint:", `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`, "| bucket:", R2_BUCKET, "| public:", R2_PUBLIC);

async function uploadToR2(key, buf) {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "video/mp4" }));
  return `${R2_PUBLIC}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1: upload videos
// ─────────────────────────────────────────────────────────────────────────────
async function uploadVideo(hook) {
  if (state.videos[hook]?.videoId) {
    console.log(`  ${hook}: already uploaded (${state.videos[hook].videoId})`);
    return;
  }
  const path = `${VIDEO_DIR}/${fileFor(hook)}`;
  const buf = readFileSync(path);
  const sizeMB = (statSync(path).size / 1024 / 1024).toFixed(0);
  console.log(`  ${hook}: uploading ${sizeMB}MB to R2 ...`);
  const key = `munhalsa11/${Date.now()}-${hook}.mp4`;
  const publicUrl = await uploadToR2(key, buf);
  console.log(`  ${hook}: R2 ok — telling Meta to pull ${publicUrl.slice(0, 60)}...`);
  const up = await fbPostJson(`/${AD_ACCOUNT}/advideos`, { file_url: publicUrl, title: fileFor(hook).replace(/\.mp4$/, "") });
  console.log(`  ${hook}: video_id=${up.id} — waiting for processing...`);
  // wait for ready
  const start = Date.now();
  let interval = 5000;
  let ready = false;
  while (Date.now() - start < 180000) {
    const r = await fbGet(`/${up.id}`, { fields: "status" });
    const st = r.status?.video_status;
    if (st === "ready") { ready = true; break; }
    if (st === "error") throw new Error(`${hook}: video processing failed`);
    await new Promise((r) => setTimeout(r, interval));
    interval = Math.min(interval * 1.4, 15000);
  }
  // thumbnail
  let thumb = null;
  try {
    const t = await fbGet(`/${up.id}/thumbnails`);
    if (t.data?.length) thumb = (t.data.find((x) => x.is_preferred) || t.data[0]).uri;
    if (!thumb) { const v = await fbGet(`/${up.id}`, { fields: "picture" }); thumb = v.picture || null; }
  } catch {}
  state.videos[hook] = { videoId: up.id, thumbnailUrl: thumb, ready };
  saveState();
  console.log(`  ${hook}: ${ready ? "ready" : "proceeding (status lagging)"}, thumb=${thumb ? "yes" : "no"}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: ad set
// ─────────────────────────────────────────────────────────────────────────────
async function createAdSet() {
  if (state.adsetId) { console.log(`Ad set already created: ${state.adsetId}`); return; }
  const body = {
    campaign_id: CAMPAIGN_ID,
    name: ADSET_NAME,
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    destination_type: "WEBSITE",
    promoted_object: { pixel_id: PIXEL_ID, custom_event_type: "PURCHASE" },
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
    },
    status: STATUS,
    // CBO campaign → no daily_budget / bid_strategy on the ad set
  };
  const r = await fbPostJson(`/${AD_ACCOUNT}/adsets`, body);
  state.adsetId = r.id;
  saveState();
  console.log(`Ad set created: ${r.id}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3: ads (flexible video ad = creative_asset_groups_spec)
// ─────────────────────────────────────────────────────────────────────────────
function adName(hook, lpToken) {
  // PP name = filename; 5R name = swap the " - PP - " token
  const base = `${hook} SE Fervin Jun11 - #0 - UGC - PP - Evergreen - OralHealth - Krille`;
  return lpToken === "PP" ? base : base.replace(" - PP - ", ` - ${lpToken} - `);
}

async function createAd(hook, lpToken) {
  const key = `${hook}-${lpToken}`;
  if (state.ads[key]?.adId) { console.log(`  ${key}: already created (${state.ads[key].adId})`); return; }
  const v = state.videos[hook];
  const linkUrl = LP_URL[lpToken];
  const name = adName(hook, lpToken);

  const texts = [
    ...TEXTS.map((text) => ({ text, text_type: "primary_text" })),
    ...HEADLINES.map((text) => ({ text, text_type: "headline" })),
  ];
  const group = {
    texts,
    call_to_action: { type: CTA, value: { link: linkUrl } },
    videos: [{ video_id: v.videoId, ...(v.thumbnailUrl ? { thumbnail_url: v.thumbnailUrl } : {}) }],
  };
  const storySpec = {
    page_id: PAGE_ID,
    video_data: {
      video_id: v.videoId,
      message: TEXTS[0] || "",
      title: HEADLINES[0] || "",
      link_description: HEADLINES[0] || "",
      ...(v.thumbnailUrl ? { image_url: v.thumbnailUrl } : {}),
      call_to_action: { type: CTA, value: { link: linkUrl } },
    },
  };
  const form = new FormData();
  form.append("adset_id", state.adsetId);
  form.append("name", name);
  form.append("status", STATUS);
  form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
  form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));

  const r = await fbPostForm(`/${AD_ACCOUNT}/ads`, form);
  state.ads[key] = { adId: r.id, name, linkUrl };
  saveState();
  console.log(`  ✓ ${key}: ${r.id}  "${name}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// RUN
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Phase 1: upload videos ──");
for (const h of HOOKS) await uploadVideo(h);

console.log("\n── Phase 2: create ad set ──");
await createAdSet();

console.log("\n── Phase 3: create 8 ads ──");
for (const lpToken of LP_TOKENS) {
  for (const h of HOOKS) {
    try {
      await createAd(h, lpToken);
    } catch (e) {
      console.error(`  ✗ ${h}-${lpToken}: ${e.message}`);
      if (e.meta?.error_subcode === 1359036) {
        console.error("     >>> AD ACCOUNT LIMIT (6000) reached — delete old ads to continue.");
      }
    }
  }
}

console.log("\n── SUMMARY ──");
console.log("Ad set:", state.adsetId, "→", ADSET_NAME);
const created = Object.entries(state.ads);
console.log(`Ads created: ${created.length}/8`);
for (const [k, a] of created) console.log(`  ${a.adId}  ${a.name}  → ${a.linkUrl}`);
console.log(`\nAds Manager: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${AD_ACCOUNT.replace("act_","")}&selected_adset_ids=${state.adsetId}`);
