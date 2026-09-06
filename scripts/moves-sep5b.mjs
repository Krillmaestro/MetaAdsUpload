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
const ALLERGI_GY = "120252287364240350", PRO_GY = "120254770556580350";

const data = JSON.parse(readFileSync("/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad/abo-data-sep5.json", "utf8"));
const all = data.flatMap((c) => c.adsets.map((s) => ({ ...s, camp: c.name })));
const want = [
  { key: "Statics #10 - DARFOR", gy: ALLERGI_GY },
  { key: "Aug154.V1", gy: PRO_GY },
  { key: "Aug147.V1", gy: PRO_GY },
  { key: "Apr119.V2", gy: PRO_GY },
];

const gyCache = {};
for (const gyId of [ALLERGI_GY, PRO_GY]) {
  const r = await g(`/${gyId}/ads`, { fields: "name,creative{id}", limit: "500" });
  gyCache[gyId] = { names: new Set((r.data || []).map((a) => a.name)), creatives: new Set((r.data || []).map((a) => a.creative.id)) };
}

for (const w of want) {
  const hits = all.filter((s) => s.name.includes(w.key));
  if (hits.length !== 1) { console.log(`✗ ${w.key}: ${hits.length} träffar — hoppar`); continue; }
  const src = hits[0];
  console.log(`\n══ ${src.name} (${src.id})  [exakt namn: ${JSON.stringify(src.name)}]`);
  const ins = await g(`/${src.id}/insights`, { fields: "spend,purchase_roas", time_range: TODAY });
  const dd = (ins.data || [])[0] || {};
  const roasToday = num((dd.purchase_roas || []).find((r) => r.action_type === "omni_purchase")?.value);
  console.log(`  I DAG: ${roasToday.toFixed(2)} ROAS på ${Math.round(num(dd.spend))} kr`);
  if (roasToday > 2.0) { console.log("  🛡️ ÖVER 2 I DAG — RÖRS INTE (Kristoffers spärr)"); continue; }
  const ads = await g(`/${src.id}/ads`, { fields: "name,status,creative{id}", limit: "50" });
  const gy = gyCache[w.gy];
  let fail = false;
  for (const a of ads.data || []) {
    if (gy.names.has(a.name) || gy.creatives.has(a.creative.id)) { console.log(`  DUBLETT, hoppar: ${a.name}`); continue; }
    const r = await post(`/${ACT}/ads`, { name: a.name, adset_id: w.gy, creative: JSON.stringify({ creative_id: a.creative.id }), status: "ACTIVE" });
    if (r.error) { console.log(`  FAIL ${a.name}: ${JSON.stringify(r.error).slice(0, 160)}`); fail = true; break; }
    gy.names.add(a.name); gy.creatives.add(a.creative.id);
    console.log(`  ✓ GY-kopia ${r.id}  ${a.name}`);
  }
  if (fail) { console.log("  ⚠️ käll-adsetet pausas INTE"); continue; }
  const p = await post(`/${src.id}`, { status: "PAUSED" });
  console.log(p.error ? `  PAUS-FAIL: ${JSON.stringify(p.error)}` : "  ✓ käll-adsetet pausat");
}
console.log("\nKLART.");
