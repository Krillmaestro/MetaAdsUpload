import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ── DogDivaCo Diva Digest — Jul 18 / 21 / 22 launch ──────────────────────────
// 3 ad-sets into DivaDigest // CBO. Each video → 2 ads (Listicle LP + PDP),
// so Meta can optimise delivery across both destination pages. 3 vids × 2 = 6
// ads per ad-set (18 total). Idempotent via per-batch state file.
const DRY = process.env.DRY_RUN === "1";

// shared config
const ACT = "act_2277004866371824";       // DogDivaCOmain
const CAMP = "120251818258290782";         // DivaDigest // CBO
const PIXEL = "3401593933335351";          // DogDivaCO pixel
const TEMPLATE_ID = 20;                     // Diva Digest LP + PP (copy source)
const CTA = "SHOP_NOW";
const STATUS = "ACTIVE";                    // start LIVE per Kristoffer
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

// two destinations → 6 ads per ad-set
const LINKS = [
  { key: "Listicle", url: "https://www.dogdivaco.com/pages/diva-listicle" },
  { key: "PDP", url: "https://www.dogdivaco.com/products/diva-digest" },
];

const BATCHES = [
  {
    tag: "batch18",
    dir: "C:/Users/krill/Downloads/Batch 18 USA-20260719T103549Z-1-001/Batch 18 USA",
    adset: "USA Florencio Jul18 - #1 - VSL - PP + 10R - Evergreen",
    page: "111818175275493",  // Dr. Kathrina Lindley
    renameSEtoUSA: true,      // files say SE, launch is USA
  },
  {
    tag: "batch21",
    dir: "C:/Users/krill/Downloads/BATCH 21-20260719T103556Z-1-001/BATCH 21",
    adset: "USA Justine Jul21 - #0 - VSL - PP + 10R - Evergreen - Scratching - Oskar",
    page: "111818175275493",  // Dr. Kathrina Lindley
  },
  {
    tag: "batch22",
    dir: "C:/Users/krill/Downloads/Batch 22 USA-20260719T103552Z-1-001/Batch 22 USA",
    adset: "USA Florencio Jul22 - #1 - UGC - pp + 10R - Evergreen",
    page: "1290404807478582", // Josephine Hart
  },
];

const STATE_DIR = "C:/Users/krill/AppData/Local/Temp/claude/C--Users-krill/b973fb5c-f56c-4f69-a164-61607937b0fd/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

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

// ── per-batch helpers ──
function baseName(file, B) {
  let n = file.replace(/\.mp4$/i, "");
  if (B.renameSEtoUSA) n = n.replace(/^(H\d+)\s+SE\b/i, "$1 USA");
  n = n.replace(/\s{2,}/g, " ").replace(/\s*-\s*$/, "").trim();
  return n;
}
function discover(B) {
  const files = readdirSync(B.dir).filter((f) => /\.mp4$/i.test(f));
  return files.map((f) => {
    const m = f.match(/^(H\d+)/i);
    return { hook: (m ? m[1] : f).toUpperCase(), file: f, base: baseName(f, B) };
  }).sort((a, b) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b.hook.slice(1)) || 0));
}
const adName = (v, link) => `${v.base} [${link.key}]`;

function loadState(B) {
  const f = `${STATE_DIR}/dd-${B.tag}-state.json`;
  let s = { videos: {}, adsetId: null, ads: {} };
  if (existsSync(f)) { try { s = JSON.parse(readFileSync(f, "utf8")); } catch {} }
  return { f, s };
}

async function uploadVideo(B, v, state, save) {
  if (state.videos[v.hook]?.videoId) { console.log(`  ${v.hook}: already uploaded (${state.videos[v.hook].videoId})`); return; }
  const path = `${B.dir}/${v.file}`;
  const buf = readFileSync(path);
  console.log(`  ${v.hook}: uploading ${(statSync(path).size / 1024 / 1024).toFixed(0)}MB to R2...`);
  const key = `${B.tag}/${Date.now()}-${v.hook}.mp4`;
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: "video/mp4" }));
  const publicUrl = `${R2_PUBLIC}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const up = await gPostJson(`/${ACT}/advideos`, { file_url: publicUrl, title: v.base });
  console.log(`  ${v.hook}: video_id=${up.id} — processing...`);
  const start = Date.now(); let iv = 5000, ready = false;
  while (Date.now() - start < 600000) {
    const r = await gGet(`/${up.id}`, { fields: "status" });
    const st = r.status?.video_status;
    if (st === "ready") { ready = true; break; }
    if (st === "error") throw new Error(`${v.hook}: processing failed`);
    await sleep(iv); iv = Math.min(iv * 1.4, 15000);
  }
  let thumb = null;
  try { const t = await gGet(`/${up.id}/thumbnails`); if (t.data?.length) thumb = (t.data.find((x) => x.is_preferred) || t.data[0]).uri; if (!thumb) { const vv = await gGet(`/${up.id}`, { fields: "picture" }); thumb = vv.picture || null; } } catch {}
  state.videos[v.hook] = { videoId: up.id, thumbnailUrl: thumb, ready }; save();
  console.log(`  ${v.hook}: ${ready ? "ready" : "proceeding"}, thumb=${thumb ? "yes" : "no"}`);
}

async function createAdSet(B, state, save) {
  if (state.adsetId) { console.log("  ad set exists:", state.adsetId); return; }
  const r = await gPostJson(`/${ACT}/adsets`, {
    campaign_id: CAMP,
    name: B.adset,
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
  console.log("  ✓ ad set:", r.id, "—", B.adset);
}

async function createAd(B, v, link, state, save) {
  const adKey = `${v.hook}|${link.key}`;
  if (state.ads[adKey]?.adId) { console.log(`    ${adKey}: exists (${state.ads[adKey].adId})`); return; }
  const vid = state.videos[v.hook];
  const name = adName(v, link);
  const texts = [
    ...TEXTS.map((text) => ({ text, text_type: "primary_text" })),
    ...HEADLINES.map((text) => ({ text, text_type: "headline" })),
  ];
  const group = { texts, call_to_action: { type: CTA, value: { link: link.url } }, videos: [{ video_id: vid.videoId, ...(vid.thumbnailUrl ? { thumbnail_url: vid.thumbnailUrl } : {}) }] };
  const storySpec = { page_id: B.page, video_data: { video_id: vid.videoId, message: TEXTS[0] || "", title: HEADLINES[0] || "", link_description: HEADLINES[0] || "", ...(vid.thumbnailUrl ? { image_url: vid.thumbnailUrl } : {}), call_to_action: { type: CTA, value: { link: link.url } } } };
  const form = new FormData();
  form.append("adset_id", state.adsetId);
  form.append("name", name);
  form.append("status", STATUS);
  form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
  form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));
  const r = await gPostForm(`/${ACT}/ads`, form);
  state.ads[adKey] = { adId: r.id, name, link: link.url }; save();
  console.log(`    ✓ ${adKey}: ${r.id}  "${name}"  → ${link.url}`);
}

// ── run ──
console.log(`\n=== DogDivaCo Diva Digest — Jul18/21/22 ${DRY ? "(DRY RUN — no writes)" : "LIVE LAUNCH"} ===`);
console.log(`Campaign: DivaDigest // CBO ${CAMP}  |  template ${TEMPLATE_ID}  |  status ${STATUS}`);
console.log(`Headlines: ${JSON.stringify(HEADLINES)}`);
console.log(`Links: ${LINKS.map((l) => `${l.key}=${l.url}`).join("  |  ")}\n`);

for (const B of BATCHES) {
  const vids = discover(B);
  console.log(`\n######## ${B.tag}  (page ${B.page}) ########`);
  console.log(`Ad set: ${B.adset}`);
  for (const v of vids) for (const link of LINKS) console.log(`   ad: "${adName(v, link)}"  (video ${v.hook}: ${v.file})`);

  if (DRY) continue;

  const { f, s: state } = loadState(B);
  const save = () => writeFileSync(f, JSON.stringify(state, null, 2));
  console.log("\n  ── videos ──");
  for (const v of vids) await uploadVideo(B, v, state, save);
  console.log("  ── ad set ──");
  await createAdSet(B, state, save);
  console.log("  ── ads ──");
  for (const v of vids) for (const link of LINKS) {
    try { await createAd(B, v, link, state, save); }
    catch (e) { console.error(`    ✗ ${v.hook}|${link.key}: ${e.message}`); }
  }
  console.log(`\n  SUMMARY ${B.tag}: adset ${state.adsetId} — ${Object.keys(state.ads).length}/${vids.length * LINKS.length} ads`);
}

if (!DRY) console.log(`\nAds Manager: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${ACT.replace("act_", "")}&selected_campaign_ids=${CAMP}`);
console.log("\nDone.");
