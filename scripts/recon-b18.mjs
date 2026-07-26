import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

const env = readFileSync("C:/Users/krill/MetaAdsUpload/.env.local", "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));

// 1) templates overview
const rows = await sql`SELECT id, name, cta_type, landing_pages, headlines, primary_texts, optimization_goal, conversion_event, target_countries, pixel_id, ad_account_id FROM templates ORDER BY id`;
console.log("=== TEMPLATES ===");
for (const r of rows) {
  console.log(`[${r.id}] "${r.name}"  cta=${r.cta_type}`);
  console.log(`     LP=${JSON.stringify(r.landing_pages)}`);
  console.log(`     headlines(${(r.headlines||[]).length})=${JSON.stringify((r.headlines||[]).slice(0,3))}`);
  console.log(`     primary_texts(${(r.primary_texts||[]).length})=${JSON.stringify((r.primary_texts||[]).slice(0,2))}`);
}

// 2) token + graph
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);
const BASE = "https://graph.facebook.com/v25.0";
const gGet = async (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const r = await fetch(u); return r.json(); };

// 3) verify campaign
const CAMP = "120251818258290782";
const camp = await gGet(`/${CAMP}`, { fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy" });
console.log("\n=== CAMPAIGN 120251818258290782 ===");
console.log(JSON.stringify(camp, null, 2));

const adsets = await gGet(`/${CAMP}/adsets`, { fields: "id,name,effective_status", limit: "200" });
console.log(`\n=== existing ad-sets in CBO (${(adsets.data||[]).length}) ===`);
for (const a of adsets.data || []) console.log(`  [${a.effective_status}] ${a.name}`);
const dupes = (adsets.data||[]).filter(a => /jul18|jul21|jul22|florencio|justine/i.test(a.name));
console.log(`\n>>> Jul18/21/22 or Florencio/Justine matches: ${dupes.length ? dupes.map(d=>`"${d.name}"`).join("; ") : "NONE — clear"}`);

// 4) verify pages
for (const pid of ["1216938401498787", "1290404807478582", "111818175275493"]) {
  const p = await gGet(`/${pid}`, { fields: "id,name" });
  console.log(`page ${pid} = ${p.error ? JSON.stringify(p.error) : p.name}`);
}
