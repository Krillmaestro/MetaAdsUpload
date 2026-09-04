import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const TOKEN = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0].access_token;

const ACT = "act_261297039993717";
const BASE = "https://graph.facebook.com/v25.0";
const g = async (p, q = {}) => {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  return (await fetch(u)).json();
};
const post = async (p, params) => {
  const b = new URLSearchParams({ ...params, access_token: TOKEN });
  return (await fetch(BASE + p, { method: "POST", body: b })).json();
};
const postJson = async (p, body) => (await fetch(BASE + p, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify(body),
})).json();

async function moveBatch(srcAdsetId, srcLabel, gyAdsetId) {
  console.log(`\n══ ${srcLabel} → GY-adset ${gyAdsetId} ══`);
  const gy = await g(`/${gyAdsetId}/ads`, { fields: "name,creative{id}", limit: "200" });
  const gyNames = new Set((gy.data || []).map((a) => a.name));
  const gyCreatives = new Set((gy.data || []).map((a) => a.creative.id));
  console.log(`  stacken har ${(gy.data || []).length} annonser (dublettkontroll)`);
  const src = await g(`/${srcAdsetId}/ads`, { fields: "name,status,creative{id}", limit: "50" });
  if (!src.data?.length) { console.log("  INGA ANNONSER — hoppar"); return; }
  let fail = false;
  for (const a of src.data) {
    if (gyNames.has(a.name) || gyCreatives.has(a.creative.id)) { console.log(`  DUBBLETT, hoppar: ${a.name}`); continue; }
    const r = await post(`/${ACT}/ads`, {
      name: a.name, adset_id: gyAdsetId,
      creative: JSON.stringify({ creative_id: a.creative.id }),
      status: "ACTIVE",
    });
    if (r.error) { console.log(`  FAIL ${a.name}: ${JSON.stringify({ code: r.error.code, sub: r.error.error_subcode, msg: (r.error.message || "").slice(0, 140) })}`); fail = true; break; }
    gyNames.add(a.name); gyCreatives.add(a.creative.id);
    console.log(`  ✓ GY-kopia ${r.id}  ${a.name}`);
  }
  if (fail) { console.log("  ⚠️ käll-adsetet pausas INTE (ofullständig flytt)"); return; }
  const p = await post(`/${srcAdsetId}`, { status: "PAUSED" });
  console.log(p.error ? `  PAUS-FAIL: ${JSON.stringify(p.error)}` : "  ✓ käll-adsetet pausat");
}

// ── Del A: Probiotika → [GY] Zombie Stack (finns) ────────────────────────────
const PRO_GY_STACK = "120254770556580350";
await moveBatch("120254782860990350", "SE Gene Aug24 - #2 - STATIC - PP - Evergreen - DirtyEars - Gene", PRO_GY_STACK);
await moveBatch("120254886065470350", "SE Gene Aug30 - #3 - STATIC - PP + 7R - Evergreen - Valence - Gene", PRO_GY_STACK);

// ── Del B: Allergi Faktalista → Allergi-GY (stack skapas vid behov) ──────────
const ALLERGI_ABO = "120254782838750350";
const ALLERGI_GY_CAMPAIGN = "120247929620090350";
const TARGET_NAME = "SE Gene Aug31 - #3 - STATIC - LP1 + PP - Evergreen - Faktalista - Gene";

const aboSets = await g(`/${ALLERGI_ABO}/adsets`, { fields: "name,effective_status", limit: "200" });
const srcSet = (aboSets.data || []).find((a) => a.name === TARGET_NAME);
if (!srcSet) {
  console.log(`\n⚠️ Hittar inte exakt "${TARGET_NAME}" i Allergi & Klåda // ABO. Kandidater:`);
  for (const a of (aboSets.data || []).filter((x) => /aug31|faktalista/i.test(x.name))) console.log("   -", a.name, a.id, a.effective_status);
} else {
  console.log(`\nKälla hittad: ${srcSet.id} (${srcSet.effective_status})`);
  const gySets = await g(`/${ALLERGI_GY_CAMPAIGN}/adsets`, { fields: "name,effective_status", limit: "200" });
  let stack = (gySets.data || []).find((a) => a.name === "[GY] Zombie Stack");
  if (!stack) {
    console.log("  Ingen [GY] Zombie Stack i Allergi-GY — skapar enligt 1-adset-regeln (klonar config från befintligt GY-adset)...");
    const sample = (gySets.data || [])[0];
    const cfg = await g(`/${sample.id}`, { fields: "targeting,attribution_spec,optimization_goal,billing_event,promoted_object,destination_type,bid_amount" });
    const body = {
      campaign_id: ALLERGI_GY_CAMPAIGN,
      name: "[GY] Zombie Stack",
      billing_event: cfg.billing_event || "IMPRESSIONS",
      optimization_goal: cfg.optimization_goal || "OFFSITE_CONVERSIONS",
      bid_amount: 22000,
      promoted_object: cfg.promoted_object || { pixel_id: "1485774658810931", custom_event_type: "PURCHASE" },
      targeting: cfg.targeting,
      ...(cfg.attribution_spec ? { attribution_spec: cfg.attribution_spec } : {}),
      ...(cfg.destination_type ? { destination_type: cfg.destination_type } : {}),
      status: "ACTIVE",
    };
    const r = await postJson(`/${ACT}/adsets`, body);
    if (r.error) { console.log("  STACK-SKAPANDE FAIL:", JSON.stringify(r.error).slice(0, 300)); }
    else { stack = { id: r.id, name: "[GY] Zombie Stack" }; console.log(`  ✓ [GY] Zombie Stack skapad: ${r.id} (cap 220 kr, klonad targeting från ${sample.name})`); }
  } else console.log(`  [GY] Zombie Stack finns: ${stack.id}`);
  if (stack) await moveBatch(srcSet.id, TARGET_NAME, stack.id);
}
console.log("\n=== KLART ===");
