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
const num = (x) => Number(x || 0);
const pick = (arr, t) => num((arr || []).find((r) => r.action_type === t)?.value);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gj(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await (await fetch(url)).json();
    if (r.error) {
      if ([1, 2, 4, 17, 341].includes(r.error.code) && i < tries - 1) { await sleep(15000); continue; }
      throw new Error(JSON.stringify(r.error).slice(0, 200));
    }
    return r;
  }
}
const g = (p, q = {}) => {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  return gj(u.toString());
};

const camps = await g(`/${ACT}/campaigns`, { fields: "id,name,effective_status", limit: "500" });
const pro = (camps.data || []).filter((c) => /probiot/i.test(c.name));
console.log("Probiotika-kampanjer:", pro.map((c) => `${c.name} [${c.effective_status}]`).join(" | "));

const lander = (name) => {
  const m = name.match(/\bLP\s?#?(\d+)\b/i);
  if (m) return "LP" + m[1];
  if (/\b7R\b/i.test(name)) return "7R";
  if (/\bPP\b/.test(name)) return "PP";
  return "övrigt";
};
const isVideo = (n) => /VSL|UGC|VIDEO|Non narrated|Non-Narrated|ANIME|BATCH|SB\d?|IMG\d+\s/i.test(n) && !/STATIC/i.test(n);

const agg = {};
async function pull(preset, tag) {
  for (const c of pro) {
    let url = new URL(`${BASE}/${c.id}/insights`);
    url.searchParams.set("level", "ad");
    url.searchParams.set("fields", "ad_name,spend,purchase_roas,actions,action_values");
    url.searchParams.set("date_preset", preset);
    url.searchParams.set("limit", "500");
    url.searchParams.set("access_token", TOKEN);
    let next = url.toString(), pages = 0;
    while (next && pages < 6) {
      const r = await gj(next);
      for (const row of r.data || []) {
        const L = lander(row.ad_name);
        const key = `${tag}|${L}`;
        const a = (agg[key] ||= { spend: 0, rev: 0, purch: 0, vspend: 0, vrev: 0 });
        const sp = num(row.spend), rev = pick(row.action_values, "omni_purchase"), pu = pick(row.actions, "omni_purchase");
        a.spend += sp; a.rev += rev; a.purch += pu;
        if (isVideo(row.ad_name)) { a.vspend += sp; a.vrev += rev; }
      }
      next = r.paging?.next; pages++;
    }
  }
}
await pull("last_14d", "14d");
await pull("last_90d", "90d");

writeFileSync("/private/tmp/claude-501/-Users-kristoffermacbook/149ad702-f80b-43ed-9cd9-742554db01ef/scratchpad/lander-analys-sep6.json", JSON.stringify(agg, null, 1));
for (const tag of ["14d", "90d"]) {
  console.log(`\n══ ${tag} — per lander (alla format | varav video) ══`);
  const rows = Object.entries(agg).filter(([k]) => k.startsWith(tag)).map(([k, v]) => ({ L: k.split("|")[1], ...v, roas: v.spend ? v.rev / v.spend : 0, vroas: v.vspend ? v.vrev / v.vspend : 0 }));
  rows.sort((a, b) => b.spend - a.spend);
  for (const r of rows) console.log(`  ${r.L.padEnd(7)} ${r.roas.toFixed(2).padStart(5)} ROAS  ${Math.round(r.spend).toString().padStart(7)} kr  ${String(r.purch).padStart(4)} köp   | video: ${r.vroas.toFixed(2).padStart(5)} på ${Math.round(r.vspend).toString().padStart(7)} kr`);
}
