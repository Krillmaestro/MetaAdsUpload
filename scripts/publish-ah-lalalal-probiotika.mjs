import { readFileSync, existsSync, statSync, readdirSync, mkdirSync, writeFileSync, createReadStream } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { NodeHttpHandler } from "@smithy/node-http-handler";

// ── ApotekHunden Probiotika — LALALAL-batcharna (Kristoffer 2026-09-02) ──────
// 4 batchar × 3 hooks × 2 landers (LP12 + 7R, Kristoffers order) = 24 ads.
// ProBiotics // ABO 120229285210840350, 300 kr/dag/adset, template 28-copy,
// sida Apotek Hunden, pixel 1485774658810931, attribution 7d klick + 1d view.
const DRY = process.env.DRY_RUN === "1";

const ACT = "act_261297039993717";
const CAMPAIGN_ID = "120229285210840350"; // ProBiotics // ABO
const PIXEL = "1485774658810931";
const PAGE = "265790413295490"; // Apotek Hunden
const TEMPLATE_ID = 28;
const STATUS = "ACTIVE";
const DAILY_BUDGET = 30000;
const EXCLUDED_AUDIENCES = ["120250065842190350"];
const URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}";

const ROOT = "/Users/kristoffermacbook/Downloads/LALALAL";
const BATCHES = [
  { dir: "BATCH 147.V1 SWEDISH", slot: "LP10 + LP11", editor: "Florencio", batch: "Aug147.V1" },
  { dir: "BATCH 154.V1",         slot: "LP12 + LP11", editor: "Fervin",    batch: "Aug154.V1" },
  { dir: "BATCH 81",             slot: "LP#2",        editor: "Fervin",    batch: "Apr81.V2"  },
  { dir: "BATCH 81.V3",          slot: "11 + LP12",   editor: "Justine",   batch: "Aug81.V3"  },
];
const LINKS = [
  { key: "LP12", url: "https://www.apotekhunden.se/pages/ahprobiotika?_ab=0&key=1776716014500", cta: "SHOP_NOW" },
  { key: "7R",   url: "https://www.apotekhunden.se/pages/7-skal-los-mage-tassar-oron-samma-problem", cta: "LEARN_MORE" },
];

const STATE_DIR = "/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad";
if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = `${STATE_DIR}/ah-lalalal-launch-state.json`;

// ── env + token ──────────────────────────────────────────────────────────────
const env = readFileSync("/Users/kristoffermacbook/Desktop/namnlös mapp/MetaAdsUpload-fresh/.env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const TOKEN = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0].access_token;
const tpl = (await sql`SELECT name, headlines, primary_texts FROM templates WHERE id=${TEMPLATE_ID}`)[0];
const HEADLINES = (tpl.headlines || []).filter(Boolean).slice(0, 2);
const TEXTS = (tpl.primary_texts || []).filter(Boolean).slice(0, 2);
if (HEADLINES.length < 2 || TEXTS.length < 2) throw new Error(`Template ${TEMPLATE_ID} saknar 2+2 copy`);

// ── graph helpers (samma som aug202-scriptet) ───────────────────────────────
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

// ── r2 ───────────────────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${clean(process.env.R2_ACCOUNT_ID)}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: clean(process.env.R2_ACCESS_KEY_ID), secretAccessKey: clean(process.env.R2_SECRET_ACCESS_KEY) },
  forcePathStyle: true, maxAttempts: 8,
  requestHandler: new NodeHttpHandler({ connectionTimeout: 10000, socketTimeout: 90000 }),
});
const R2_BUCKET = clean(process.env.R2_BUCKET_NAME);
const R2_PUBLIC = clean(process.env.R2_PUBLIC_URL).replace(/\/$/, "");

// ── state ────────────────────────────────────────────────────────────────────
let state = { batches: {} };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── namnbygge ────────────────────────────────────────────────────────────────
const norm = (s) => s.replace(/\s+/g, " ").replace(/\s*-\s*$/, "").trim();
const baseName = (file) => file.replace(/\.(mp4|mov)$/i, "");
const withSlot = (name, slot, repl) => norm(name.split(slot).join(repl));

// ── discovery + plan ─────────────────────────────────────────────────────────
const plan = [];
for (const b of BATCHES) {
  const dir = `${ROOT}/${b.dir}`;
  const files = readdirSync(dir).filter((f) => /\.(mp4|mov)$/i.test(f) && !f.startsWith(".")).sort();
  if (files.length < 3) throw new Error(`${b.dir}: bara ${files.length} videor`);
  const videos = files.map((f) => ({ hook: (f.match(/^(H\d+)/i)?.[1] || "H?").toUpperCase(), file: f }))
    .sort((a, b2) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b2.hook.slice(1)) || 0));
  const h1 = videos[0].file;
  if (!h1.includes(b.slot)) throw new Error(`${b.dir}: LP-slot "${b.slot}" hittas inte i "${h1}"`);
  const adsetName = withSlot(baseName(h1).replace(/^H\d+\s+/i, ""), b.slot, "LP12 + 7R");
  plan.push({ ...b, dir, videos, adsetName });
}

console.log(`\n=== LALALAL → ProBiotics // ABO ${DRY ? "(DRY RUN)" : "LIVE LAUNCH"} ===`);
console.log(`Template ${TEMPLATE_ID}: ${tpl.name} | sida ${PAGE} | pixel ${PIXEL} | ${(DAILY_BUDGET/100)} kr/dag per ad set | status ${STATUS}`);
console.log(`Landers: LP12 (SHOP_NOW) + 7R (LEARN_MORE)\n`);
for (const p of plan) {
  console.log(`AD SET: ${p.adsetName}`);
  for (const v of p.videos) {
    const mb = (statSync(`${p.dir}/${v.file}`).size / 1048576).toFixed(0);
    for (const l of LINKS) console.log(`   ${withSlot(baseName(v.file), p.slot, l.key)}  →  ${l.key}  (${mb}MB)`);
  }
}

// ── preflight ────────────────────────────────────────────────────────────────
console.log("\n── preflight ──");
for (const l of LINKS) {
  const r = await fetch(l.url, { method: "HEAD", redirect: "manual" });
  console.log(`  ${l.key}: HTTP ${r.status} ${r.status === 200 ? "✓" : "⚠️"}`);
  if (r.status !== 200) throw new Error(`Lander ${l.key} svarar ${r.status}`);
}
const existing = await gGet(`/${CAMPAIGN_ID}/adsets`, { fields: "name", limit: "500" });
const existingNames = new Set((existing.data || []).map((a) => a.name));
console.log(`  dublettkontroll: ${existingNames.size} befintliga ad sets i kampanjen`);
for (const p of plan) {
  if (existingNames.has(p.adsetName)) throw new Error(`DUBBLETT: ad set "${p.adsetName}" finns redan i kampanjen — avbryter`);
}
console.log("  inga namnkrockar ✓");

if (DRY) { console.log("\n(dry run — inget skickat)"); process.exit(0); }

// ── launch ───────────────────────────────────────────────────────────────────
for (const p of plan) {
  console.log(`\n══ ${p.dir} ══`);
  const bs = (state.batches[p.dir] ||= { videos: {}, adsetId: null, ads: {} });

  for (const v of p.videos) {
    if (bs.videos[v.hook]?.videoId && bs.videos[v.hook]?.ready !== false) { console.log(`  ${v.hook}: klar sedan innan (${bs.videos[v.hook].videoId})`); continue; }
    const path = `${p.dir}/${v.file}`;
    const size = statSync(path).size;
    const sanitized = v.file.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = bs.videos[v.hook]?.r2Key || `library/${Date.now()}-${sanitized}`;
    const publicUrl = `${R2_PUBLIC}/${key}`;
    if (!bs.videos[v.hook]?.r2Key) {
      console.log(`  ${v.hook}: R2-upload ${(size/1048576).toFixed(0)}MB...`);
      const up = new Upload({
        client: r2,
        params: { Bucket: R2_BUCKET, Key: key, Body: createReadStream(path), ContentType: /\.mov$/i.test(v.file) ? "video/quicktime" : "video/mp4" },
        partSize: 8 * 1024 * 1024, queueSize: 1, leavePartsOnError: false,
      });
      let lastPct = -10; const t0 = Date.now();
      up.on("httpUploadProgress", (pr) => {
        const pct = Math.floor(((pr.loaded || 0) / size) * 100);
        if (pct >= lastPct + 10) { lastPct = pct; console.log(`  ${v.hook}: ${pct}% (${((pr.loaded||0)/1048576).toFixed(0)}/${(size/1048576).toFixed(0)} MB)`); }
      });
      await up.done();
      bs.videos[v.hook] = { r2Key: key, r2Url: publicUrl, fileSize: size }; save();
      const head = await fetch(publicUrl, { method: "HEAD" });
      if (!head.ok) throw new Error(`${v.hook}: R2 ej publikt läsbar (${head.status})`);
      try {
        await sql`INSERT INTO creatives (name, type, source, r2_key, r2_url, file_size, editor_name, batch_number, status)
                  VALUES (${v.file}, 'video', 'r2', ${key}, ${publicUrl}, ${size}, ${p.editor}, ${p.batch}, 'uploaded')`;
      } catch (e) { console.warn(`  (creatives-rad: ${e.message})`); }
    }
    const up2 = await gPostJson(`/${ACT}/advideos`, { file_url: publicUrl, title: baseName(v.file) });
    bs.videos[v.hook].videoId = up2.id; save();
    console.log(`  ${v.hook}: video_id=${up2.id}, väntar på ready...`);
    const start = Date.now(); let iv = 5000, ready = false;
    while (Date.now() - start < 900000) {
      const r = await gGet(`/${up2.id}`, { fields: "status" });
      const st = r.status?.video_status;
      if (st === "ready") { ready = true; break; }
      if (st === "error") throw new Error(`${v.hook}: Meta-bearbetning misslyckades`);
      await sleep(iv); iv = Math.min(iv * 1.4, 15000);
    }
    let thumb = null;
    try {
      const t = await gGet(`/${up2.id}/thumbnails`);
      if (t.data?.length) thumb = (t.data.find((x) => x.is_preferred) || t.data[0]).uri;
      if (!thumb) thumb = (await gGet(`/${up2.id}`, { fields: "picture" })).picture || null;
    } catch {}
    bs.videos[v.hook].thumbnailUrl = thumb; bs.videos[v.hook].ready = ready; save();
    try { await sql`UPDATE creatives SET meta_video_id=${up2.id}, thumbnail_url=${thumb} WHERE r2_key=${bs.videos[v.hook].r2Key}`; } catch {}
    console.log(`  ${v.hook}: ${ready ? "ready ✓" : "timeout — fortsätter"}, thumb=${thumb ? "ja" : "nej"}`);
  }

  if (!bs.adsetId) {
    const r = await gPostJson(`/${ACT}/adsets`, {
      campaign_id: CAMPAIGN_ID,
      name: p.adsetName,
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
    bs.adsetId = r.id; save();
    console.log(`  ✓ ad set ${r.id} — ${p.adsetName}`);
  } else console.log(`  ad set finns i state: ${bs.adsetId}`);

  for (const v of p.videos) for (const link of LINKS) {
    const adKey = `${v.hook}|${link.key}`;
    if (bs.ads[adKey]?.adId) { console.log(`    ${adKey}: finns redan`); continue; }
    const vid = bs.videos[v.hook];
    const name = withSlot(baseName(v.file), p.slot, link.key);
    const group = {
      texts: [
        ...TEXTS.map((text) => ({ text, text_type: "primary_text" })),
        ...HEADLINES.map((text) => ({ text, text_type: "headline" })),
      ],
      call_to_action: { type: link.cta, value: { link: link.url } },
      videos: [{ video_id: vid.videoId, ...(vid.thumbnailUrl ? { thumbnail_url: vid.thumbnailUrl } : {}) }],
    };
    const storySpec = {
      page_id: PAGE,
      video_data: {
        video_id: vid.videoId, message: TEXTS[0], title: HEADLINES[0], link_description: HEADLINES[0],
        ...(vid.thumbnailUrl ? { image_url: vid.thumbnailUrl } : {}),
        call_to_action: { type: link.cta, value: { link: link.url } },
      },
    };
    const form = new FormData();
    form.append("adset_id", bs.adsetId);
    form.append("name", name);
    form.append("status", STATUS);
    form.append("creative", JSON.stringify({ name, object_story_spec: storySpec, url_tags: URL_TAGS }));
    form.append("creative_asset_groups_spec", JSON.stringify({ groups: [group] }));
    const r = await gPostForm(`/${ACT}/ads`, form);
    bs.ads[adKey] = { adId: r.id, name, link: link.url }; save();
    console.log(`    ✓ ${adKey}: ${r.id} "${name}"`);
    try {
      await sql`INSERT INTO upload_jobs (filename, media_type, status, total_steps, current_step, step_label, r2_key, r2_url, campaign_id, adset_id, ad_id, video_id, config, completed_at)
                VALUES (${v.file}, 'video', 'completed', 4, 4, 'Klar!', ${vid.r2Key}, ${vid.r2Url}, ${CAMPAIGN_ID}, ${bs.adsetId}, ${r.id}, ${vid.videoId},
                        ${JSON.stringify({ adName: name, adCopy: { headlines: HEADLINES, primaryTexts: TEXTS, linkUrl: link.url, ctaType: link.cta }, pageId: PAGE, pixelId: PIXEL, adAccountId: ACT, source: "publish-ah-lalalal-probiotika" })}::jsonb, now())`;
    } catch (e) { console.warn(`    (upload_jobs: ${e.message})`); }
  }
}
const total = Object.values(state.batches).reduce((n, b) => n + Object.keys(b.ads).length, 0);
console.log(`\n=== KLART: ${plan.length} ad sets, ${total} annonser i ProBiotics // ABO ===`);
