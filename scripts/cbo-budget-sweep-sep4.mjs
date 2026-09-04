import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
const DRY = process.env.DRY_RUN === "1";
const STATE = "/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad/cbo-sweep-2026-09-04.json";
const applied = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};

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

const camps = await g(`/${ACT}/campaigns`, {
  fields: "id,name,effective_status,daily_budget,lifetime_budget",
  limit: "200",
});
if (camps.error) { console.log("CAMPAIGNS ERROR", JSON.stringify(camps.error)); process.exit(1); }

const active = (camps.data || []).filter((c) => c.effective_status === "ACTIVE");
const cbos = active.filter((c) => Number(c.daily_budget) > 0);
const lifetime = active.filter((c) => !Number(c.daily_budget) && Number(c.lifetime_budget) > 0);
console.log(`Aktiva kampanjer: ${active.length} · CBO (daily): ${cbos.length} · CBO (lifetime, hoppas): ${lifetime.length}`);
for (const c of lifetime) console.log(`  LIFETIME-SKIP: ${c.name}`);

const rows = [];
for (const c of cbos) {
  const ins = await g(`/${c.id}/insights`, {
    fields: "spend,purchase_roas",
    time_range: JSON.stringify({ since: "2026-09-01", until: "2026-09-03" }),
  });
  if (ins.error) { console.log(`INSIGHTS ERROR ${c.name}:`, JSON.stringify(ins.error)); continue; }
  const d = ins.data?.[0] || {};
  const spend = Number(d.spend || 0);
  const roas = Number((d.purchase_roas || []).find((r) => r.action_type === "omni_purchase")?.value || 0);
  const budget = Number(c.daily_budget);
  let action = "HOLD", nb = budget;
  if (spend < 100) action = "SKIP_LOW_SPEND";
  else if (roas > 2.0) { action = "RAISE"; nb = Math.round((budget * 1.2) / 100) * 100; }
  else if (roas < 1.8) { action = "LOWER"; nb = Math.round((budget * 0.8) / 100) * 100; }
  rows.push({ id: c.id, name: c.name, spend, roas, budget, nb, action });
}

rows.sort((a, b) => b.spend - a.spend);
console.log("\nACTION           ROAS3d  SPEND3d   BUDGET → NY      KAMPANJ");
for (const r of rows) {
  console.log(
    `${r.action.padEnd(15)}  ${r.roas.toFixed(2).padStart(5)}  ${Math.round(r.spend).toString().padStart(6)}   ${(r.budget / 100).toString().padStart(5)} → ${(r.nb / 100).toString().padStart(5)}   ${r.name}`
  );
}

if (!DRY) {
  for (const r of rows) {
    if (r.action !== "RAISE" && r.action !== "LOWER") continue;
    if (applied[r.id]) { console.log(`REDAN JUSTERAD, hoppar: ${r.name}`); continue; }
    const res = await post(`/${r.id}`, { daily_budget: String(r.nb) });
    if (res.error) console.log(`FAIL ${r.name}: ${JSON.stringify(res.error).slice(0, 200)}`);
    else { applied[r.id] = { from: r.budget, to: r.nb, at: new Date().toISOString() }; console.log(`✓ ${r.action} ${r.name}: ${r.budget / 100} → ${r.nb / 100} kr`); }
    writeFileSync(STATE, JSON.stringify(applied, null, 2));
  }
  console.log("\nKLART.");
} else console.log("\nDRY RUN — inget ändrat.");
