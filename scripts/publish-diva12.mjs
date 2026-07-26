import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ── config ──
const ACT = "act_2277004866371824";        // DogDivaCOmain
const CAMP = "120251818258290782";          // DivaDigest // CBO (CBO)
const PAGE = "1216938401498787";            // Dogdivaco page
const PIXEL = "3401593933335351";           // DogDivaCO pixel
const TEMPLATE_ID = 20;                      // Diva Digest LP + PP
const ADSET_NAME = "USA Fervin Jul12 - #1 - UGC - PP - Evergreen - Scratching - Krille";
const LP = "https://www.dogdivaco.com/products/diva-digest";
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";
const VIDEO_DIR = "C:/Users/krill/Downloads/DIVA 12-20260710T195528Z-2-001/DIVA 12";
const STATE_FILE = "C:/Users/krill/AppData/Local/Temp/claude/C--Users-krill/3790fc75-c98f-4e85-866c-d93d63404fd2/scratchpad/diva12-state.json";
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const VIDEOS = [
  { hook: "H1", file: "H1 USA Fervin Jul12 - #1 - UGC - PP - Evergreen - Scratching - Krille.mp4" },
  { hook: "H2", file: "H2 USA Fervin Jul12 - #1 - UGC - PP - Evergreen - Scratching - Krille.mp4" },
  { hook: "H3", file: "H3 USA Fervin Jul12 - #1 - UGC - PP - Evergreen - Scratching - Krille_.mp4" },
];
const adName = (f) => f.replace(/\.mp4$/i, "").replace(/_+$/, "");

// ── env + token ──
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);

// template copy
const tpl = (await sql`SELECT headlines, primary_texts FROM templates WHERE id=${TEMPLATE_ID}`)[0];
const HEADLINES = tpl.headlines.slice(0, 2);
const TEXTS = tpl.primary_texts.slice(0, 2);
console.log("Headlines:", HEADLINES.length, "| Texts:", TEXTS.length, "| LP:", LP);

// ── graph + r2 ──
const BASE = "https://graph.facebook.com/v25.0";
const gGet = async (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const R = await fetch(u); const j = await R.json(); if (!R.ok) throw new Error(`GET ${p}: ` + JSON.stringify(j.error)); return j; };
const gPostJson = async (p, body) => { const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }); const j = await res.json(); if (!res.ok) { const e = new Error(`POST ${p}: ` + JSON.stringify(j.error)); e.meta = j.error; throw e; } return j; };
const gPostForm = async (p, form) => { form.append("access_token", TOKEN); const res = await fetch(`${BASE}${p}`, { method: "POST", body: form }); const j = await res.json(); if (!res.ok) { const e = new Error(`POST ${p}: ` + JSON.stringify(j.error)); e.meta = j.error; throw e; } return j; };
const R2_ACCOUNT = clean(process.env.R2_ACCOUNT_ID);
const r2 = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`, credentials: { accessKeyId: clean(process.env.R2_ACCESS_KEY_ID), secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY) }, forcePathStyle: true });
const R2_BUCKET = clean(process.env.R2_BUCKET_NAME);
const R2_PUBLIC = clean(process.env.R2_PUBLIC_URL).replace(/\/$/, "");

let state = { videos: {}, adsetId: null, ads: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

async function uploadVideo(v) {
  if (state.videos[v.hook]?.videoId) { console.log(`  ${v.hook}: already uploaded`); return; }
  const path = `${VIDEO_DIR}/${v.file}`;
  const buf = readFileSync(path);
  console.log(`  ${v.hook}: uploading ${(statSync(path).size/1024/1024).toFixed(0)}MB to R2...`);
  const key = `diva12/${Date.now()}-${v.hook}.mp4`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "video/mp4" }));
  const publicUrl = `${R2_PUBLIC}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const up = await gPostJson(`/${ACT}/advideos`, { file_url: publicUrl, title: adName(v.file) });
  console.log(`  ${v.hook}: video_id=${up.id} — processing...`);
  const start = Date.now(); let iv = 5000, ready = false;
  while (Date.now() - start < 180000) {
    const r = await gGet(`/${up.id}`, { fields: "status" });
    const st = r.status?.video_status;
    if (st === "ready") { ready = true; break; }
    if (st === "error") throw new Error(`${v.hook}: processing failed`);
    await new Promise((r) => setTimeout(r, iv)); iv = Math.min(iv * 1.4, 15000);
  }
  let thumb = null;
  try { const t = await gGet(`/${up.id}/thumbnails`); if (t.data?.length) thumb = (t.data.find((x) => x.is_preferred) || t.data[0]).uri; if (!thumb) { const vv = await gGet(`/${up.id}`, { fields: "picture" }); thumb = vv.picture || null; } } catch {}
  state.videos[v.hook] = { videoId: up.id, thumbnailUrl: thumb, ready }; save();
  console.log(`  ${v.hook}: ${ready ? "ready" : "proceeding"}, thumb=${thumb ? "yes" : "no"}`);
}

async function createAdSet() {
  if (state.adsetId) { console.log("Ad set exists:", state.adsetId); return; }
  const body = {
    campaign_id: CAMP,
    name: ADSET_NAME,
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    destination_type: "WEBSITE",
    promoted_object: { pixel_id: PIXEL, custom_event_type: "PURCHASE" },
    attribution_spec: [
      { event_type: "CLICK_THROUGH", window_days: 7 },
      { event_type: "VIEW_THROUGH", window_days: 1 },
      { event_type: "ENGAGED_VIDEO_VIEW", window_days: 1 },
    ],
    targeting: { age_min: 18, age_max: 65, geo_locations: { countries: ["US", "GB", "CA", "AU", "NZ"], location_types: ["home", "recent"] }, targeting_automation: { advantage_audience: 1 } },
    status: STATUS,
    // CBO campaign -> no daily_budget / bid_strategy
  };
  const r = await gPostJson(`/${ACT}/adsets`, body);
  state.adsetId = r.id; save();
  console.log("✓ Ad set:", r.id, "—", ADSET_NAME);
}

async function createAd(v) {
  if (state.ads[v.hook]?.adId) { console.log(`  ${v.hook}: exists`); return; }
  const vid = state.videos[v.hook];
  const name = adName(v.file);
  const texts = [
    ...TEXTS.map((text) => ({ text, text_type: "primary_text" })),
    ...HEADLINES.map((text) => ({ text, text_type: "headline" })),
  ];
  const group = { texts, call_to_action: { type: CTA, value: { link: LP } }, videos: [{ video_id: vid.videoId, ...(vid.thumbnailUrl ? { thumbnail_url: vid.thumbnailUrl } : {}) }] };
  const storySpec = { page_id: PAGE, video_data: { video_id: vid.videoId, message: TEXTS[0] || "", title: HEADLINES[0] || "", link_description: HEADLINES[0] || "", ...(vid.thumbnailUrl ? { image_url: vid.thumbnailUrl } : {}), call_to_action: { type: CTA, value: { link: LP } } } };
  const form = new FormData();
  form.append("adset_id", state.adsetId);
  form.append("name", name);
  form.append("status", STATUS);
  form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
  form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));
  const r = await gPostForm(`/${ACT}/ads`, form);
  state.ads[v.hook] = { adId: r.id, name }; save();
  console.log(`  ✓ ${v.hook}: ${r.id}  "${name}"`);
}

// ── RUN ──
console.log("\n── Phase 1: videos ──");
for (const v of VIDEOS) await uploadVideo(v);
console.log("\n── Phase 2: ad set ──");
await createAdSet();
console.log("\n── Phase 3: ads ──");
for (const v of VIDEOS) { try { await createAd(v); } catch (e) { console.error(`  ✗ ${v.hook}: ${e.message}`); } }

console.log("\n── SUMMARY ──");
console.log("Ad set:", state.adsetId, "—", ADSET_NAME);
for (const v of VIDEOS) console.log(`  ${v.hook}: ${state.ads[v.hook]?.adId || "—"}  ${adName(v.file)}`);
console.log(`\nAds Manager: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ACT.replace("act_","")}&selected_adset_ids=${state.adsetId}`);
