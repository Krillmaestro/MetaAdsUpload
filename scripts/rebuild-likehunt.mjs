import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

// ── config ──
const ACT = "act_2277004866371824";          // DogDivaCOmain (USD)
const CAMP = "120251837725300782";            // Like Hunting DogDiva - Page Likes (Warmup)
const PAGE = "1216938401498787";              // Dogdivaco page
const BROKEN_ADSET = "120251844789590782";    // "Like Huting" (PAGE_LIKES/ON_PAGE) -> pause
const ADSET_NAME = "Like Hunting - BIG5 - Post Engagement";
const DAILY_BUDGET_CENTS = 2000;              // $20/day
const STATUS = "ACTIVE";
const DIR = "C:/Users/krill/creative-strategist/Ad statics/DogDivaCO/LIKE HUNTING - Page Likes";
const STATE_FILE = "C:/Users/krill/AppData/Local/Temp/claude/C--Users-krill/3790fc75-c98f-4e85-866c-d93d63404fd2/scratchpad/likehunt-state.json";

const ADS = [
  { id: "L1", file: "LIKEHUNT L1 - small dog is your world.png", name: "LIKEHUNT L1 - small dog is your world",
    caption: "Some people won't get it… but if your small dog is your whole world, this page is for you. 🐾 Give us a like if she's basically your baby 💕" },
  { id: "L2", file: "LIKEHUNT L2 - cancel plans for your dog.png", name: "LIKEHUNT L2 - cancel plans for your dog",
    caption: "Be honest — you've cancelled plans to stay home with your dog. 🙈 Double-tap if you'd do it again in a heartbeat, and like the page for your daily dose of small-dog cuteness. 🐶" },
  { id: "L3", file: "LIKEHUNT L3 - spoiled and not sorry.png", name: "LIKEHUNT L3 - spoiled and not sorry",
    caption: "Yes, she's spoiled. No, we're not sorry. 👑 Like the page if your tiny diva runs on cuddles, treats and attention (and deserves every bit). 🐾" },
  { id: "L4", file: "LIKEHUNT L4 - runs the whole house.png", name: "LIKEHUNT L4 - runs the whole house",
    caption: "They're 6 pounds of pure attitude and somehow they run the entire house. 😤🐾 Like the page if your small dog is secretly the boss. 👑" },
  { id: "L5", file: "LIKEHUNT L5 - talk to your dog.png", name: "LIKEHUNT L5 - talk to your dog",
    caption: "You talk to her like she understands every single word… because she does. 💕 Like the page if your small dog is your best little listener. 🐾" },
  { id: "L6", file: "LIKEHUNT L6 - tag a small-dog mom.png", name: "LIKEHUNT L6 - tag a small-dog mom",
    caption: "Small dog. Big personality. Everywhere you go. 🐾 Tag a fellow small-dog mom who'd get it — and give the page a like for daily tiny-dog joy. 💕" },
];

// ── env + token ──
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const PREFIX = "enc:v1:";
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith(PREFIX)) return v; const [a, b, c] = v.slice(PREFIX.length).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);

const BASE = "https://graph.facebook.com/v25.0";
async function gGet(p, q = {}) { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const R = await fetch(u); const j = await R.json(); if (!R.ok) { const e = new Error(`GET ${p}: ` + JSON.stringify(j.error)); e.meta = j.error; throw e; } return j; }
async function gPost(p, body) { const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }); const j = await res.json(); if (!res.ok) { const e = new Error(`POST ${p}: ` + JSON.stringify(j.error)); e.meta = j.error; throw e; } return j; }

// ── state ──
let state = { adsetId: null, images: {}, ads: {}, brokenPaused: false };
if (existsSync(STATE_FILE)) { try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ── 1. ad set ──
async function createAdSet() {
  if (state.adsetId) { console.log("Ad set exists:", state.adsetId); return; }
  const body = {
    campaign_id: CAMP,
    name: ADSET_NAME,
    optimization_goal: "POST_ENGAGEMENT",
    billing_event: "IMPRESSIONS",
    destination_type: "ON_POST",
    promoted_object: { page_id: PAGE },
    daily_budget: DAILY_BUDGET_CENTS,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: {
      geo_locations: { countries: ["US", "GB", "CA", "AU", "NZ"] },
      targeting_automation: { advantage_audience: 1 },
    },
    status: STATUS,
  };
  const r = await gPost(`/${ACT}/adsets`, body);
  state.adsetId = r.id; save();
  console.log("✓ Ad set created:", r.id, "—", ADSET_NAME);
}

// ── 2. images ──
async function uploadImage(ad) {
  if (state.images[ad.id]) return state.images[ad.id];
  const buf = readFileSync(`${DIR}/${ad.file}`);
  const r = await gPost(`/${ACT}/adimages`, { bytes: buf.toString("base64"), filename: ad.file });
  const hash = Object.values(r.images)[0].hash;
  state.images[ad.id] = hash; save();
  console.log(`  img ${ad.id}: ${hash}`);
  return hash;
}

// ── 3. photo ad ──
async function createAd(ad) {
  if (state.ads[ad.id]?.adId) { console.log(`  ${ad.id}: exists (${state.ads[ad.id].adId})`); return; }
  const hash = await uploadImage(ad);
  const creative = await gPost(`/${ACT}/adcreatives`, {
    name: `${ad.name} — creative`,
    object_story_spec: { page_id: PAGE, photo_data: { image_hash: hash, caption: ad.caption } },
  });
  const adRes = await gPost(`/${ACT}/ads`, {
    adset_id: state.adsetId,
    name: ad.name,
    creative: { creative_id: creative.id },
    status: STATUS,
  });
  state.ads[ad.id] = { adId: adRes.id, creativeId: creative.id, hash }; save();
  console.log(`  ✓ ${ad.id}: ad=${adRes.id}`);
}

async function verifyAd(ad) {
  const adId = state.ads[ad.id].adId;
  const a = await gGet(`/${adId}`, { fields: "name,effective_status,issues_info,creative{effective_object_story_id}" });
  console.log(`    verify ${ad.id}: status=${a.effective_status} issues=${a.issues_info ? JSON.stringify(a.issues_info) : "none"}`);
  const postId = a.creative?.effective_object_story_id;
  if (postId) {
    try { const post = await gGet(`/${postId}`, { fields: "message" }); console.log(`    post ${postId} message="${(post.message || "").slice(0, 50)}..."`); } catch (e) { console.log("    (post read err)", e.message); }
  }
  return a;
}

// ── RUN ──
console.log("── Rebuild Like-Hunting (POST_ENGAGEMENT/ON_POST) ──");
await createAdSet();

console.log("\n── L1 test ──");
await createAd(ADS[0]);
const v = await verifyAd(ADS[0]);
const bad = v.effective_status && ["DISAPPROVED", "WITH_ISSUES", "PENDING_REVIEW"].includes(v.effective_status) && v.issues_info;
if (v.issues_info) {
  console.log("\n⚠ L1 has issues — STOPPING before building L2–L6. Review above.");
  process.exit(0);
}
console.log("L1 looks clean → building L2–L6");
for (const ad of ADS.slice(1)) await createAd(ad);

console.log("\n── pause broken set ──");
if (!state.brokenPaused) {
  await gPost(`/${BROKEN_ADSET}`, { status: "PAUSED" });
  state.brokenPaused = true; save();
  console.log("✓ 'Like Huting' (broken PAGE_LIKES set) paused:", BROKEN_ADSET);
}

console.log("\n── SUMMARY ──");
console.log("New ad set:", state.adsetId, "—", ADSET_NAME, "(" + STATUS + ")");
for (const ad of ADS) console.log(`  ${ad.id}: ${state.ads[ad.id]?.adId || "—"}  ${ad.name}`);
console.log(`\nAds Manager: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ACT.replace("act_","")}&selected_adset_ids=${state.adsetId}`);
