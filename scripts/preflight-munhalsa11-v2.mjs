import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);

const BASE = "https://graph.facebook.com/v25.0";
const ACT = "act_261297039993717"; // Glimmora
const CAMP = "120248826608070350"; // Munhälsa // CBO
const PAGE = "1290404807478582";   // Josephine Hart
const gGet = async (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const r = await fetch(u); return r.json(); };

// 1) pixels on Glimmora — find "FirtZoo"
const px = await gGet(`/${ACT}/adspixels`, { fields: "id,name", limit: "100" });
console.log("=== pixels on Glimmora ===");
if (px.error) console.log("  error:", JSON.stringify(px.error));
else for (const p of px.data || []) console.log(`  ${p.id}  ${p.name}`);

// 2) campaign + existing ad-sets (dupe check)
const camp = await gGet(`/${CAMP}`, { fields: "id,name,status,effective_status" });
console.log(`\n=== campaign ===\n  ${camp.id}  ${camp.name}  [${camp.effective_status}]`);
const adsets = await gGet(`/${CAMP}/adsets`, { fields: "id,name,effective_status", limit: "200" });
console.log(`\n=== ad-sets in campaign (${(adsets.data || []).length}) ===`);
for (const a of adsets.data || []) console.log(`  [${a.effective_status}] ${a.id}  ${a.name}`);

// 3) Josephine Hart page usable on Glimmora?
const pages = await gGet(`/${ACT}/promote_pages`, { fields: "id,name", limit: "200" });
console.log("\n=== promote_pages on Glimmora ===");
if (pages.error) console.log("  error:", JSON.stringify(pages.error));
else {
  const hit = (pages.data || []).find((p) => p.id === PAGE);
  console.log(`  Josephine Hart (${PAGE}): ${hit ? "AVAILABLE ✓" : "NOT in promote_pages — may fail at ad create"}`);
  for (const p of pages.data || []) console.log(`  ${p.id}  ${p.name}`);
}

// 4) template 14 LP resolution
const tr = await sql`SELECT headlines, primary_texts, cta_type, landing_pages FROM templates WHERE id = 14`;
const tpl = tr[0];
console.log("\n=== template 14 ===");
console.log("  headlines:", tpl.headlines.length, "| texts:", tpl.primary_texts.length, "| cta:", tpl.cta_type);
console.log("  landing_pages:", JSON.stringify(tpl.landing_pages));
