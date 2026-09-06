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
const num = (x) => Number(x || 0);
const TODAY = JSON.stringify({ since: "2026-09-05", until: "2026-09-05" });

const ALLERGI_ABO = "120254782838750350", PRO_ABO = "120229285210840350";
const SCALING_CAMPAIGN = "120247704475550350", SCALING_ADSET = "120254851007420350";
const ALLERGI_GY = "120252287364240350", PRO_GY = "120254770556580350";

const byName = async (camp, name) => {
  const r = await g(`/${camp}/adsets`, { fields: "id,name,effective_status", limit: "200" });
  return (r.data || []).find((a) => a.name === name);
};

// ── DEL A: SÖK → Scaling Winners ─────────────────────────────────────────────
console.log("═══ DEL A: SÖK #11 → Scaling Winners ═══");
const sok = await byName(ALLERGI_ABO, "SE Gene Sep1 - Statics #11 - SOK - ALLERGI - 399 - Search");
if (!sok) { console.log("SÖK hittas inte!"); process.exit(1); }
const tAds = await g(`/${SCALING_CAMPAIGN}/ads`, { fields: "name,creative{id}", limit: "500" });
const tNames = new Set((tAds.data || []).map((a) => a.name));
const tCreatives = new Set((tAds.data || []).map((a) => a.creative.id));
console.log(`dublettkontroll: ${(tAds.data || []).length} ads i målkampanjen`);
const sokAds = await g(`/${sok.id}/ads`, { fields: "name,status,creative{id}", limit: "50" });
for (const a of sokAds.data || []) {
  if (a.status !== "ACTIVE") { console.log(`  hoppar (${a.status}): ${a.name}`); continue; }
  if (tNames.has(a.name) || tCreatives.has(a.creative.id)) { console.log(`  DUBLETT, hoppar: ${a.name}`); continue; }
  const r = await post(`/${ACT}/ads`, { name: a.name, adset_id: SCALING_ADSET, creative: JSON.stringify({ creative_id: a.creative.id }), status: "ACTIVE" });
  console.log(r.error ? `  FAIL ${a.name}: ${JSON.stringify(r.error).slice(0, 160)}` : `  ✓ scaling-kopia ${r.id}  ${a.name}`);
  if (!r.error) { tNames.add(a.name); tCreatives.add(a.creative.id); }
}
console.log("källan lämnas aktiv i ABO (livscykelregeln).");

// ── DEL B: röda → graveyard, med dagens-ROAS-spärr ───────────────────────────
const CANDIDATES = [
  { camp: ALLERGI_ABO, gy: ALLERGI_GY, name: "SE Gene Sep1 - Statics #9 - KLADKARTAN - ALLERGI - 399 - Scratching" },
  { camp: ALLERGI_ABO, gy: ALLERGI_GY, name: "SE Gene Sep1 - Statics #4 - CHATT - ALLERGI - 399 - Skeptic" },
  { camp: ALLERGI_ABO, gy: ALLERGI_GY, name: "SE Gene Sep1 - Statics #10 - DARFOR - ALLERGI - 399 - Skeptic" },
  { camp: PRO_ABO, gy: PRO_GY, name: "SE Fervin Aug154.V1 - #1 - VSL - LP12 + 7R - Evergreen - MIX - Oskar" },
  { camp: PRO_ABO, gy: PRO_GY, name: "SE Florencio Aug147.V1 - #1 - UGC - LP12 + 7R" },
  { camp: PRO_ABO, gy: PRO_GY, name: "SE Fervin Apr119.V2 - #1 - VSL - LP12 + 7R - Evergreen - LickingPaws - Oskar" },
];
const gyCache = {};
for (const gyId of [ALLERGI_GY, PRO_GY]) {
  const r = await g(`/${gyId}/ads`, { fields: "name,creative{id}", limit: "500" });
  gyCache[gyId] = { names: new Set((r.data || []).map((a) => a.name)), creatives: new Set((r.data || []).map((a) => a.creative.id)), n: (r.data || []).length };
}
console.log(`\n═══ DEL B: graveyard (Allergi-GY ${gyCache[ALLERGI_GY].n} ads · Pro-GY ${gyCache[PRO_GY].n} ads) ═══`);

for (const c of CANDIDATES) {
  const src = await byName(c.camp, c.name);
  if (!src) { console.log(`\n✗ HITTAS EJ: ${c.name}`); continue; }
  const ins = await g(`/${src.id}/insights`, { fields: "spend,purchase_roas", time_range: TODAY });
  const d = (ins.data || [])[0] || {};
  const roasToday = num((d.purchase_roas || []).find((r) => r.action_type === "omni_purchase")?.value);
  console.log(`\n══ ${c.name} — I DAG: ${roasToday.toFixed(2)} ROAS på ${Math.round(num(d.spend))} kr ══`);
  if (roasToday > 2.0) { console.log("  🛡️ ÖVER 2 I DAG — RÖRS INTE (Kristoffers spärr)"); continue; }
  const ads = await g(`/${src.id}/ads`, { fields: "name,status,creative{id}", limit: "50" });
  const gy = gyCache[c.gy];
  let fail = false;
  for (const a of ads.data || []) {
    if (gy.names.has(a.name) || gy.creatives.has(a.creative.id)) { console.log(`  DUBLETT, hoppar: ${a.name}`); continue; }
    const r = await post(`/${ACT}/ads`, { name: a.name, adset_id: c.gy, creative: JSON.stringify({ creative_id: a.creative.id }), status: "ACTIVE" });
    if (r.error) { console.log(`  FAIL ${a.name}: ${JSON.stringify(r.error).slice(0, 160)}`); fail = true; break; }
    gy.names.add(a.name); gy.creatives.add(a.creative.id);
    console.log(`  ✓ GY-kopia ${r.id}  ${a.name}`);
  }
  if (fail) { console.log("  ⚠️ käll-adsetet pausas INTE (ofullständig flytt)"); continue; }
  const p = await post(`/${src.id}`, { status: "PAUSED" });
  console.log(p.error ? `  PAUS-FAIL: ${JSON.stringify(p.error)}` : "  ✓ käll-adsetet pausat");
}
console.log("\nKLART.");
