import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));

// Template 20
const tpl = (await sql`SELECT id,name,headlines,primary_texts,cta_type,landing_pages,pixel_id,ad_account_id,optimization_goal,conversion_event FROM templates WHERE id=20`)[0];
console.log("=== TEMPLATE 20 ===");
console.log("name:", tpl.name, "| cta:", tpl.cta_type, "| pixel:", tpl.pixel_id, "| act:", tpl.ad_account_id);
console.log("landing_pages:", JSON.stringify(tpl.landing_pages));
console.log("HEADLINES (" + tpl.headlines.length + "):"); tpl.headlines.forEach((h, i) => console.log(`  [${i}] ${h}`));
console.log("PRIMARY TEXTS (" + tpl.primary_texts.length + "):"); tpl.primary_texts.forEach((p, i) => console.log(`  [${i}] ${p}`));

// existing DivaDigest // CBO ad-sets
const r = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0];
const t = dec(r.access_token);
const g = async (p, q = {}) => { const u = new URL("https://graph.facebook.com/v25.0" + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", t); const R = await fetch(u); const j = await R.json(); if (!R.ok) throw new Error(p + ": " + JSON.stringify(j.error)); return j; };
const CAMP = "120251818258290782"; // DivaDigest // CBO
const camp = await g("/" + CAMP, { fields: "name,objective,daily_budget,lifetime_budget,bid_strategy" });
console.log("\n=== CAMPAIGN ===", JSON.stringify(camp));
const sets = await g("/" + CAMP + "/adsets", { fields: "id,name,effective_status,optimization_goal,billing_event,destination_type,promoted_object,attribution_spec,targeting,created_time", limit: 25 });
console.log(`\n=== DivaDigest // CBO AD SETS (${sets.data.length}) ===`);
sets.data.sort((a,b)=>(b.created_time||"").localeCompare(a.created_time||""));
for (const s of sets.data.slice(0, 4)) {
  console.log(`\n[${s.effective_status}] ${s.id} | ${s.name}`);
  console.log(`  opt=${s.optimization_goal} bill=${s.billing_event} dest=${s.destination_type}`);
  console.log(`  promoted=${JSON.stringify(s.promoted_object)}`);
  console.log(`  attribution=${JSON.stringify(s.attribution_spec)}`);
  console.log(`  targeting=${JSON.stringify(s.targeting)}`);
  const ads = await g("/" + s.id + "/ads", { fields: "name,creative{effective_object_story_id}", limit: 3 });
  for (const a of ads.data) console.log(`    ad: ${a.name}`);
}
// which page? resolve via one ad's creative
const firstSet = sets.data[0];
if (firstSet) {
  const ads = await g("/" + firstSet.id + "/ads", { fields: "creative{object_story_spec}", limit: 1 });
  if (ads.data?.[0]?.creative?.object_story_spec) console.log("\nPAGE from existing creative:", JSON.stringify(ads.data[0].creative.object_story_spec.page_id));
}
