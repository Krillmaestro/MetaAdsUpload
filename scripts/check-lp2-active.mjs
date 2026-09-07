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
const urlOf = (cr) => {
  if (!cr) return null;
  const s = cr.object_story_spec || {};
  return s.link_data?.link || s.video_data?.call_to_action?.value?.link || cr.asset_feed_spec?.link_urls?.[0]?.website_url || null;
};
let next = `${BASE}/120232796260150350/ads?fields=name,effective_status,creative{object_story_spec,asset_feed_spec}&limit=250&access_token=${TOKEN}`;
let pages = 0;
while (next && pages < 6) {
  const r = await (await fetch(next)).json();
  if (r.error) { console.log("ERR", JSON.stringify(r.error).slice(0,150)); break; }
  for (const ad of r.data || []) {
    if (ad.effective_status !== "ACTIVE") continue;
    const u = urlOf(ad.creative);
    if (u && /probiotika|listicle/.test(u.split("?")[0]) || /LP2/.test(ad.name)) {
      console.log(`${ad.effective_status}  ${(u||"?").split("?")[0]}  <<  ${ad.name.slice(0,60)}`);
    }
  }
  next = r.paging?.next; pages++;
}
