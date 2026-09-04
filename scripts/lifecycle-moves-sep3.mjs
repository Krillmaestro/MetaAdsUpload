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
const SCALING_CAMPAIGN = "120254640672690350";
const SCALING_ADSET = "120254640674830350"; // SE ProBiotics - Scaling Winners - POSTID
const GY_ADSET = "120254770556580350";      // [GY] Zombie Stack

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

// ── 1) Faktalista PP → Scaling Winners (originalet LEVER KVAR i ABO) ─────────
const SCALE_AD = "120254897437120350"; // SE Gene Aug31 - #6 - STATIC - PP - Evergreen - Faktalista - Gene
{
  const ad = await g(`/${SCALE_AD}`, { fields: "name,creative{id},effective_status" });
  console.log(`\n══ SCALING: ${ad.name} (${ad.effective_status}, creative ${ad.creative.id}) ══`);
  const existing = await g(`/${SCALING_CAMPAIGN}/ads`, { fields: "name,creative{id}", limit: "200" });
  const names = new Set(existing.data.map((a) => a.name));
  const creatives = new Set(existing.data.map((a) => a.creative.id));
  console.log(`  dublettkontroll: ${existing.data.length} annonser i scaling-kampanjen`);
  if (names.has(ad.name) || creatives.has(ad.creative.id)) {
    console.log("  DUBBLETT — redan i scaling, hoppar");
  } else {
    const r = await post(`/${ACT}/ads`, { name: ad.name, adset_id: SCALING_ADSET, creative: JSON.stringify({ creative_id: ad.creative.id }), status: "ACTIVE" });
    if (r.error) console.log("  FAIL:", JSON.stringify(r.error).slice(0, 200));
    else console.log(`  ✓ Scaling-kopia: ${r.id} — originalet i ABO rörs INTE (lever kvar)`);
  }
}

// ── 2) 1,6-regeln → graveyard (kopia + originalannonsen stängs) ──────────────
const GY_ADS = [
  { id: "120254886249900350", why: "Apr119 H1 [LP12]: 498 kr / 0 köp på 3d" },
  { id: "120254897429870350", why: "Faktalista 7R: 1,26 på 3d" },
];
const gy = await g(`/${GY_ADSET}/ads`, { fields: "name,creative{id}", limit: "200" });
const gyNames = new Set(gy.data.map((a) => a.name));
const gyCreatives = new Set(gy.data.map((a) => a.creative.id));
console.log(`\n══ GRAVEYARD (1,6-regeln) — stacken har ${gy.data.length} annonser ══`);
for (const t of GY_ADS) {
  const ad = await g(`/${t.id}`, { fields: "name,creative{id},effective_status" });
  console.log(`  ${ad.name} (${t.why})`);
  if (gyNames.has(ad.name) || gyCreatives.has(ad.creative.id)) {
    console.log("    DUBBLETT i stacken — skapar ingen kopia");
  } else {
    const r = await post(`/${ACT}/ads`, { name: ad.name, adset_id: GY_ADSET, creative: JSON.stringify({ creative_id: ad.creative.id }), status: "ACTIVE" });
    if (r.error) { console.log("    FAIL:", JSON.stringify(r.error).slice(0, 200)); continue; }
    gyNames.add(ad.name); gyCreatives.add(ad.creative.id);
    console.log(`    ✓ GY-kopia: ${r.id}`);
  }
  const p = await post(`/${t.id}`, { status: "PAUSED" });
  console.log(p.error ? `    PAUS-FAIL: ${JSON.stringify(p.error).slice(0, 200)}` : "    ✓ originalannonsen i ABO stängd (1,6-undantaget)");
}
console.log("\n=== KLART ===");
