import { readFileSync, writeFileSync } from "node:fs";
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
const TR = JSON.stringify({ since: "2026-09-03", until: "2026-09-05" });
const g = async (p, q = {}) => {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  return (await fetch(u)).json();
};
const num = (x) => Number(x || 0);
const pick = (arr, t) => num((arr || []).find((r) => r.action_type === t)?.value);

const camps = await g(`/${ACT}/campaigns`, { fields: "id,name,effective_status,daily_budget,lifetime_budget", limit: "200" });
const abos = (camps.data || []).filter((c) => c.effective_status === "ACTIVE" && !num(c.daily_budget) && !num(c.lifetime_budget));
console.log("ABO-kampanjer:", abos.map((c) => `${c.name} (${c.id})`).join(" | "));

const out = [];
for (const c of abos) {
  const adsets = await g(`/${c.id}/adsets`, { fields: "id,name,effective_status,daily_budget,created_time", limit: "200" });
  const activeAS = (adsets.data || []).filter((a) => a.effective_status === "ACTIVE");

  const adIns = await g(`/${c.id}/insights`, {
    level: "ad", fields: "adset_id,adset_name,ad_id,ad_name,spend,purchase_roas,actions,action_values",
    time_range: TR, limit: "500",
  });
  const daily = await g(`/${c.id}/insights`, {
    level: "adset", fields: "adset_id,spend,purchase_roas", time_range: TR, time_increment: "1", limit: "500",
  });
  if (adIns.error || daily.error) { console.log("INSIGHTS ERROR", c.name, JSON.stringify(adIns.error || daily.error)); continue; }

  const byAdset = {};
  for (const a of activeAS) byAdset[a.id] = { id: a.id, name: a.name, budget: num(a.daily_budget) / 100, created: a.created_time, spend: 0, rev: 0, purch: 0, ads: [], days: [] };
  for (const r of adIns.data || []) {
    const s = byAdset[r.adset_id]; if (!s) continue;
    const spend = num(r.spend), rev = pick(r.action_values, "omni_purchase"), purch = pick(r.actions, "omni_purchase");
    s.spend += spend; s.rev += rev; s.purch += purch;
    s.ads.push({ name: r.ad_name, spend, roas: pick(r.purchase_roas, "omni_purchase"), purch });
  }
  for (const r of daily.data || []) {
    const s = byAdset[r.adset_id]; if (!s) continue;
    s.days.push({ d: r.date_start, spend: num(r.spend), roas: pick(r.purchase_roas, "omni_purchase") });
  }
  for (const s of Object.values(byAdset)) {
    s.roas = s.spend ? s.rev / s.spend : 0;
    s.ads.sort((a, b) => b.spend - a.spend);
    s.days.sort((a, b) => a.d.localeCompare(b.d));
  }
  out.push({ id: c.id, name: c.name, adsets: Object.values(byAdset).sort((a, b) => b.spend - a.spend) });
}

writeFileSync("/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad/abo-data-sep5.json", JSON.stringify(out, null, 1));
for (const c of out) {
  console.log(`\n═══ ${c.name} ═══`);
  for (const s of c.adsets) {
    const days = s.days.map((d) => d.roas.toFixed(1)).join("/");
    console.log(`  ${s.roas.toFixed(2).padStart(5)} ROAS  ${Math.round(s.spend).toString().padStart(5)} kr  ${String(s.purch).padStart(2)} köp  ${String(s.budget).padStart(4)} b  [${days}]  ${s.name}`);
  }
}
