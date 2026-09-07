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

const camps = await g(`/${ACT}/campaigns`, { fields: "id,name", limit: "500" });
const pro = (camps.data || []).filter((c) => /probiot/i.test(c.name));

const lander = (name) => {
  const m = name.match(/\bLP\s?#?(\d+)\b/i);
  if (m) return "LP" + m[1];
  if (/\b7R\b/i.test(name)) return "7R";
  if (/\bPP\b/.test(name)) return "PP";
  return "övrigt";
};
const urlOf = (cr) => {
  if (!cr) return null;
  const s = cr.object_story_spec || {};
  return s.link_data?.link
    || s.video_data?.call_to_action?.value?.link
    || cr.asset_feed_spec?.link_urls?.[0]?.website_url
    || null;
};

const map = {};
for (const c of pro) {
  let next = (() => { const u = new URL(`${BASE}/${c.id}/ads`);
    u.searchParams.set("fields", "name,creative{object_story_spec,asset_feed_spec}");
    u.searchParams.set("limit", "250"); u.searchParams.set("access_token", TOKEN); return u.toString(); })();
  let pages = 0;
  while (next && pages < 6) {
    const r = await gj(next);
    for (const ad of r.data || []) {
      const L = lander(ad.name);
      const u = urlOf(ad.creative);
      if (!u) continue;
      const bare = u.split("?")[0];
      ((map[L] ||= {})[bare] ||= { n: 0, full: u }).n++;
    }
    next = r.paging?.next; pages++;
  }
}

const order = Object.keys(map).sort();
const seen = new Set();
for (const L of order) {
  const urls = Object.entries(map[L]).sort((a, b) => b[1].n - a[1].n);
  console.log(`\n${L}:`);
  for (const [bare, info] of urls.slice(0, 4)) {
    console.log(`   ${String(info.n).padStart(4)} ads  ${bare}`);
    seen.add(bare);
  }
}
console.log("\n── HEAD-koll ──");
for (const u of seen) {
  try { const r = await fetch(u, { method: "HEAD", redirect: "manual" });
    console.log(`  HTTP ${r.status}  ${u}`); }
  catch (e) { console.log(`  FEL      ${u} (${e.message})`); }
}
