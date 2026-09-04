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

const ABO = "120229285210840350";
const GY = "120254770556580350"; // Probiotics Zombie Stack
const NAMES = [
  "SE Gene Aug24 - #3 - STATIC - PP - Evergreen - MIX - Gene",
  "SE Fervin May181 - #1 - VSL - LP12 + 7R - Evergreen - MIX - Oskar",
  "SE Gene Aug31 - #6 - STATIC - 7R + PP - Evergreen - Faktalista - Gene",
  "SE Justine Aug81.V3 - #1 - Non narrated - LP12 + 7R - Evergreen - LickingPaws - Oskar",
  "SE Gene Sep1 - Statics #6 - ORON - PROBIOTIKA - 399 - DirtyEars",
  "SE Fervin Apr81.V2 - #1 - Non narrated - LP12 + 7R - Evergreen - LickingPaws - Oskar",
];

const adsets = await g(`/${ABO}/adsets`, { fields: "id,name,effective_status", limit: "200" });
const gy = await g(`/${GY}/ads`, { fields: "name,creative{id}", limit: "500" });
const gyNames = new Set((gy.data || []).map((a) => a.name));
const gyCreatives = new Set((gy.data || []).map((a) => a.creative.id));
console.log(`GY-stacken har ${(gy.data || []).length} annonser (dublettkontroll)`);

for (const name of NAMES) {
  const src = (adsets.data || []).find((a) => a.name === name);
  if (!src) { console.log(`\n✗ HITTAS EJ: ${name}`); continue; }
  console.log(`\n══ ${name} (${src.id}, ${src.effective_status}) ══`);
  const ads = await g(`/${src.id}/ads`, { fields: "name,status,creative{id}", limit: "50" });
  if (!ads.data?.length) { console.log("  inga annonser — hoppar"); continue; }
  let fail = false;
  for (const a of ads.data) {
    if (gyNames.has(a.name) || gyCreatives.has(a.creative.id)) { console.log(`  DUBLETT, hoppar: ${a.name}`); continue; }
    const r = await post(`/${ACT}/ads`, {
      name: a.name, adset_id: GY,
      creative: JSON.stringify({ creative_id: a.creative.id }),
      status: "ACTIVE",
    });
    if (r.error) { console.log(`  FAIL ${a.name}: ${JSON.stringify({ code: r.error.code, sub: r.error.error_subcode, msg: (r.error.message || "").slice(0, 140) })}`); fail = true; break; }
    gyNames.add(a.name); gyCreatives.add(a.creative.id);
    console.log(`  ✓ GY-kopia ${r.id}  ${a.name}`);
  }
  if (fail) { console.log("  ⚠️ käll-adsetet pausas INTE (ofullständig flytt)"); continue; }
  const p = await post(`/${src.id}`, { status: "PAUSED" });
  console.log(p.error ? `  PAUS-FAIL: ${JSON.stringify(p.error)}` : "  ✓ käll-adsetet pausat");
}
console.log("\nKLART.");
