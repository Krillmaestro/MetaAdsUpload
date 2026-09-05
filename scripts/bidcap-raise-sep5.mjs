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
const NEW_BID = 28000; // 280 kr i öre
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

const camps = await g(`/${ACT}/campaigns`, { fields: "id,name,effective_status", limit: "200" });
const c = (camps.data || []).find((x) => x.name === "Probiotika CBO BIDCAP");
if (!c) { console.log("Kampanjen hittas inte"); process.exit(1); }
console.log(`Kampanj: ${c.name} (${c.id}, ${c.effective_status})`);

const adsets = await g(`/${c.id}/adsets`, { fields: "id,name,effective_status,bid_amount,bid_strategy", limit: "200" });
for (const a of adsets.data || []) {
  const cur = Number(a.bid_amount || 0);
  console.log(`\n${a.name}\n  [${a.effective_status}] ${a.bid_strategy} · nuvarande cap: ${cur / 100} kr`);
  if (a.effective_status !== "ACTIVE") { console.log("  hoppar (ej aktiv)"); continue; }
  if (cur === NEW_BID) { console.log("  redan 280 kr"); continue; }
  const r = await post(`/${a.id}`, { bid_amount: String(NEW_BID) });
  console.log(r.error ? `  FAIL: ${JSON.stringify(r.error).slice(0, 200)}` : `  ✓ ${cur / 100} → 280 kr`);
}
console.log("\nKLART.");
