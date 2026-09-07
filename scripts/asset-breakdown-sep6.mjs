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
const num = (x) => Number(x || 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gj(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await (await fetch(url)).json();
    if (r.error) { if ([1,2,4,17,341].includes(r.error.code) && i < tries-1) { await sleep(15000); continue; } throw new Error(JSON.stringify(r.error).slice(0,200)); }
    return r;
  }
}
const camps = await gj(`${BASE}/${ACT}/campaigns?fields=id,name&limit=500&access_token=${TOKEN}`);
const ids = (camps.data||[]).filter(c=>/probiot/i.test(c.name)).map(c=>c.id);
const filt = encodeURIComponent(JSON.stringify([{field:"campaign.id",operator:"IN",value:ids}]));
for (const bd of ["body_asset","title_asset"]) {
  console.log(`\n═══ ${bd} — last_30d, Probiotika ═══`);
  let next = `${BASE}/${ACT}/insights?level=account&breakdowns=${bd}&fields=spend,purchase_roas,actions&date_preset=last_30d&filtering=${filt}&limit=200&access_token=${TOKEN}`;
  const rows = [];
  let pages = 0;
  while (next && pages < 4) {
    const r = await gj(next);
    for (const row of r.data || []) {
      const a = row[bd] || {};
      rows.push({ text: (a.text || "?").replace(/\s+/g," ").slice(0,110), spend: num(row.spend),
        roas: num((row.purchase_roas||[]).find(x=>x.action_type==="omni_purchase")?.value),
        kop: num((row.actions||[]).find(x=>x.action_type==="omni_purchase")?.value) });
    }
    next = r.paging?.next; pages++;
  }
  rows.sort((a,b)=>b.spend-a.spend);
  for (const r of rows.slice(0, 15)) console.log(`  ${r.roas.toFixed(2).padStart(5)} ROAS  ${Math.round(r.spend).toString().padStart(7)} kr  ${String(r.kop).padStart(3)} köp  ${r.text}`);
}
