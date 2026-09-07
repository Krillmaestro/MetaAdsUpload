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
const BASE = "https://graph.facebook.com/v25.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gj(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const r = await (await fetch(url)).json();
    if (r.error) { if ([1,2,4,17,341].includes(r.error.code) && i < tries-1) { await sleep(15000); continue; } throw new Error(JSON.stringify(r.error).slice(0,200)); }
    return r;
  }
}
const camps = await gj(`${BASE}/act_261297039993717/campaigns?fields=id,name&limit=500&access_token=${TOKEN}`);
const ids = (camps.data||[]).filter(c=>/probiot/i.test(c.name)).map(c=>c.id);
const found = new Map();
outer:
for (const cid of ids) {
  let next = `${BASE}/${cid}/ads?fields=creative{asset_feed_spec}&limit=250&access_token=${TOKEN}`;
  let pages = 0;
  while (next && pages < 6) {
    const r = await gj(next);
    for (const ad of r.data || []) {
      for (const b of ad.creative?.asset_feed_spec?.bodies || []) {
        const t = b.text || "";
        if (/^Tassarna\. Öronen\. Magen\. Du har behandlat/.test(t) && !found.has("PT_TASSARNA")) found.set("PT_TASSARNA", t);
        if (/^Luktar tassarna majschips\? Det är jästen/.test(t) && !found.has("PT_MAJSCHIPS")) found.set("PT_MAJSCHIPS", t);
      }
      if (found.size === 2) break outer;
    }
    next = r.paging?.next; pages++;
  }
}
for (const [k, v] of found) console.log(`\n═══ ${k} ═══\n${v}`);
if (found.size < 2) console.log(`\nBARA ${found.size} TRÄFF(AR)`);
