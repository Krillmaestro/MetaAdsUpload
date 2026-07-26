import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

const ACT = "act_2277004866371824";
const PAGE = "1216938401498787";
const OLD_CAMP = "120251837725300782";   // pause this whole campaign (warmup + broken set)
const CAMP_NAME = "Like Hunting DogDiva // ABO";
const ADSET_NAME = "Like Hunting - BIG5 - Post Engagement";
const DAILY = 2000; // $20
const STATUS = "ACTIVE";
const STATE = "C:/Users/krill/AppData/Local/Temp/claude/C--Users-krill/3790fc75-c98f-4e85-866c-d93d63404fd2/scratchpad/likehunt-abo-state.json";

// reuse the 6 already-approved page posts (no duplicate posts on the page)
const POSTS = [
  { id: "L1", name: "LIKEHUNT L1 - small dog is your world", post: "1216938401498787_122107936929380921" },
  { id: "L2", name: "LIKEHUNT L2 - cancel plans for your dog", post: "1216938401498787_122107937055380921" },
  { id: "L3", name: "LIKEHUNT L3 - spoiled and not sorry", post: "1216938401498787_122107937133380921" },
  { id: "L4", name: "LIKEHUNT L4 - runs the whole house", post: "1216938401498787_122107937175380921" },
  { id: "L5", name: "LIKEHUNT L5 - talk to your dog", post: "1216938401498787_122107937271380921" },
  { id: "L6", name: "LIKEHUNT L6 - tag a small-dog mom", post: "1216938401498787_122107937355380921" },
];

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);
const BASE = "https://graph.facebook.com/v25.0";
const gPost = async (p, body) => { const res = await fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }); const j = await res.json(); if (!res.ok) { const e = new Error(`POST ${p}: ` + JSON.stringify(j.error)); e.meta = j.error; throw e; } return j; };

let state = { campaignId: null, adsetId: null, ads: {}, oldPaused: false };
if (existsSync(STATE)) { try { state = JSON.parse(readFileSync(STATE, "utf8")); } catch {} }
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

// 1. campaign
if (!state.campaignId) {
  const c = await gPost(`/${ACT}/campaigns`, {
    name: CAMP_NAME, objective: "OUTCOME_ENGAGEMENT", special_ad_categories: [], status: STATUS,
    is_adset_budget_sharing_enabled: false, // pure ABO, budget stays on the ad set
  });
  state.campaignId = c.id; save();
  console.log("✓ Campaign:", c.id, "—", CAMP_NAME);
} else console.log("Campaign exists:", state.campaignId);

// 2. ad set (ABO)
if (!state.adsetId) {
  const s = await gPost(`/${ACT}/adsets`, {
    campaign_id: state.campaignId,
    name: ADSET_NAME,
    optimization_goal: "POST_ENGAGEMENT",
    billing_event: "IMPRESSIONS",
    destination_type: "ON_POST",
    promoted_object: { page_id: PAGE },
    daily_budget: DAILY,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: { geo_locations: { countries: ["US", "GB", "CA", "AU", "NZ"] }, targeting_automation: { advantage_audience: 1 } },
    status: STATUS,
  });
  state.adsetId = s.id; save();
  console.log("✓ Ad set:", s.id, "($20/day ABO)");
} else console.log("Ad set exists:", state.adsetId);

// 3. ads (reuse existing posts)
for (const p of POSTS) {
  if (state.ads[p.id]?.adId) { console.log(`  ${p.id}: exists`); continue; }
  const creative = await gPost(`/${ACT}/adcreatives`, { name: `${p.name} — creative`, object_story_id: p.post });
  const ad = await gPost(`/${ACT}/ads`, { adset_id: state.adsetId, name: p.name, creative: { creative_id: creative.id }, status: STATUS });
  state.ads[p.id] = { adId: ad.id, creativeId: creative.id }; save();
  console.log(`  ✓ ${p.id}: ad=${ad.id}`);
}

// 4. pause the old messy campaign
if (!state.oldPaused) {
  await gPost(`/${OLD_CAMP}`, { status: "PAUSED" });
  state.oldPaused = true; save();
  console.log("✓ Old campaign paused:", OLD_CAMP);
}

console.log("\n── SUMMARY ──");
console.log("Campaign:", state.campaignId, "—", CAMP_NAME, "(" + STATUS + ")");
console.log("Ad set:", state.adsetId, "— POST_ENGAGEMENT / ON_POST / $20/day ABO");
for (const p of POSTS) console.log(`  ${p.id}: ${state.ads[p.id]?.adId}  ${p.name}`);
console.log(`\nAds Manager: https://adsmanager.facebook.com/adsmanager/manage/ads?act=${ACT.replace("act_","")}&selected_campaign_ids=${state.campaignId}`);
