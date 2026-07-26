import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ── batches (select via argv[2]) ──
const BATCHES = {
  batch9: {
    dir: "C:/Users/krill/Downloads/Batch 9 USA-20260710T203834Z-2-001/Batch 9 USA",
    adset: "USA Florencio Jul9 - #1 - VSL - PP - Evergreen - MIX - Oskar",
    tag: "batch9",
  },
  diva13: {
    dir: "C:/Users/krill/Downloads/DIVA 13-20260710T203929Z-2-001/DIVA 13",
    adset: "USA Fervin Jul13 - #1 - VSL - PP - Evergreen - MIX - Oskar",
    tag: "diva13",
  },
  diva16: {
    dir: "C:/Users/krill/Downloads/DIVA 16-20260713T203437Z-2-001/DIVA 16",
    adset: "USA Fervin Jul16 - #1 -  - PP - Evergreen - Longevity - Oskar",
    tag: "diva16",
  },
  diva22: {
    dir: "C:/Users/krill/Downloads/DIVA 22-20260716T203602Z-1-001/DIVA 22",
    adset: "USA Fervin Jul22 - #1 - UGC - pp - Evergreen - Scratching - Oskar",
    tag: "diva22",
    page: "111818175275493", // Dr. Kathrina Lindley ("Dr. Kathlin")
  },
  diva151: {
    dir: "C:/Users/krill/Downloads/DIVA 15.1-20260716T203611Z-1-001/DIVA 15.1",
    adset: "USA Fervin Jul15.1 - #1 - UGC - PP - Evergreen - MIX - Krille",
    tag: "diva151",
    page: "111818175275493", // Dr. Kathrina Lindley
  },
  diva19: {
    dir: "C:/Users/krill/Downloads/DIVA 19-20260716T203623Z-1-001/DIVA 19",
    adset: "USA Fervin Jul19 - #1 - VSL - PP - Evergreen - Scratching - Oskar",
    tag: "diva19",
    page: "111818175275493", // Dr. Kathrina Lindley
  },
  batch14: {
    dir: "C:/Users/krill/Downloads/Batch 14 USA -20260716T203731Z-1-001/Batch 14 USA",
    adset: "USA Florencio Jul14 - #1 - UGC - PP+LP - Evergr", // filename minus H{n}; link goes to PP only
    tag: "batch14",
    page: "1290404807478582", // Josephine Hart
  },
  batch17: {
    dir: "C:/Users/krill/Downloads/BATCH 17-20260716T203714Z-1-001/BATCH 17",
    adset: "USA Justine Jul17 - #1 - UGC - PP+LP - Evergreen - Scratching - Krille", // filename minus H{n}; link goes to PP only
    tag: "batch17",
    page: "1290404807478582", // Josephine Hart
  },
};
const which = process.argv[2];
const B = BATCHES[which];
if (!B) { console.error("Usage: node publish-dd-batch.mjs <batch9|diva13|diva16|diva22>"); process.exit(1); }

// ── shared config (same as DIVA 12 launch) ──
const ACT = "act_2277004866371824";      // DogDivaCOmain
const CAMP = "120251818258290782";        // DivaDigest // CBO
const PAGE = B.page ?? "1216938401498787"; // per-batch page override (default Dogdivaco page)
const PIXEL = "3401593933335351";         // DogDivaCO pixel
const TEMPLATE_ID = 20;                    // Diva Digest LP + PP
const LP = "https://www.dogdivaco.com/products/diva-digest";
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";
const ADSET_NAME = B.adset;
const STATE_FILE = `C:/Users/krill/AppData/Local/Temp/claude/C--Users-krill/be6dfdfd-cd71-46fb-af73-96feaa27a868/scratchpad/dd-${B.tag}-state.json`;

// discover videos, derive hook + clean ad name (H{n} + adset name)
const files = readdirSync(B.dir).filter((f) => /\.mp4$/i.test(f));
const VIDEOS = files.map((f) => {
  const m = f.match(/^(H\d+)/i);
  return { hook: (m ? m[1] : f).toUpperCase(), file: f };
}).sort((a, b) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b.hook.slice(1)) || 0));
const adName = (v) => `${v.hook} ${ADSET_NAME}`;
console.log(`Batch ${B.tag}: ${VIDEOS.length} videos →`, VIDEOS.map((v) => v.hook).join(", "));
console.log("Ad set:", ADSET_NAME);

// ── env + token ──
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);
const tpl = (await sql`SELECT headlines, primary_texts FROM templates WHERE id=${TEMPLATE_ID}`)[0];
const HEADLINES = tpl.headlines.slice(0, 2);
const TEXTS = tpl.primary_texts.slice(0, 2);

// ── graph + r2 ──
const BASE = "https://graph.facebook.com/v25.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retry on transient failures: HTML error pages (non-JSON), 5xx, 429, and Meta
// transient codes (1,2,4,17,341). Real API errors throw immediately.
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
      if (retryable && i < tries - 1) { lastErr = new Error(`${label}: ` + JSON.stringify(j.error)); await sleep(Math.min(2000 * 2 ** i, 20000)); continue; }
      const e = new Error(`${label}: ` + JSON.stringify(j.error)); e.meta = j.error; throw e;
    }
    return j;
  }
  throw lastErr || new Error(`${label}: failed after ${tries} tries`);
}
const gGet = (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); return reqJson(`GET ${p}`, () => fetch(u)); };
const gPostJson = (p, body) => reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }));
const gPostForm = (p, form) => { form.append("access_token", TOKEN); return reqJson(`POST ${p}`, () => fetch(`${BASE}${p}`, { method: "POST", body: form })); };
const R2_ACCOUNT = clean(process.env.R2_ACCOUNT_ID);
const r2 = new S3Client({ region: "auto", endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`, credentials: { accessKeyId: clean(process.env.R2_ACCESS_KEY_ID), secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY) }, forcePathStyle: true });
const R2_BUCKET = clean(process.env.R2_BUCKET_NAME);
const R2_PUBLIC = clean(process.env.R2_PUBLIC_URL).replace(/\/$/, "");

let state = { videos: {}, adsetId: null, ads: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

async function uploadVideo(v) {
  if (state.videos[v.hook]?.videoId) { console.log(`  ${v.hook}: already uploaded`); return; }
  const path = `${B.dir}/${v.file}`;
  const buf = readFileSync(path);
  console.log(`  ${v.hook}: uploading ${(statSync(path).size / 1024 / 1024).toFixed(0)}MB to R2...`);
  const key = `${B.tag}/${Date.now()}-${v.hook}.mp4`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "video/mp4" }));
  const publicUrl = `${R2_PUBLIC}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const up = await gPostJson(`/${ACT}/advideos`, { file_url: publicUrl, title: adName(v) });
  console.log(`  ${v.hook}: video_id=${up.id} — processing...`);
  const start = Date.now(); let iv = 5000, ready = false;
  while (Date.now() - start < 600000) { // up to 10 min for large VSLs
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
  const r = await gPostJson(`/${ACT}/adsets`, {
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
  });
  state.adsetId = r.id; save();
  console.log("✓ Ad set:", r.id, "—", ADSET_NAME);
}

async function createAd(v) {
  if (state.ads[v.hook]?.adId) { console.log(`  ${v.hook}: exists`); return; }
  const vid = state.videos[v.hook];
  const name = adName(v);
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

console.log("\n── Phase 1: videos ──");
for (const v of VIDEOS) await uploadVideo(v);
console.log("\n── Phase 2: ad set ──");
await createAdSet();
console.log("\n── Phase 3: ads ──");
for (const v of VIDEOS) { try { await createAd(v); } catch (e) { console.error(`  ✗ ${v.hook}: ${e.message}`); } }

console.log("\n── SUMMARY ──");
console.log("Ad set:", state.adsetId, "—", ADSET_NAME);
for (const v of VIDEOS) console.log(`  ${v.hook}: ${state.ads[v.hook]?.adId || "—"}  ${adName(v)}`);
console.log(`\nAds Manager: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ACT.replace("act_", "")}&selected_adset_ids=${state.adsetId}`);
