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
const gGet = async (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const r = await fetch(u); return r.json(); };

const ADSET = process.argv[2];
if (!ADSET) { console.error("Usage: node verify-batch17.mjs <adset_id>"); process.exit(1); }
const as = await gGet(`/${ADSET}`, { fields: "id,name,effective_status,promoted_object,targeting{geo_locations}" });
console.log(`ADSET [${as.effective_status}] ${as.id}  ${as.name}`);
console.log(`  pixel=${as.promoted_object?.pixel_id}  event=${as.promoted_object?.custom_event_type}  geo=${JSON.stringify(as.targeting?.geo_locations?.countries)}`);
const ads = await gGet(`/${ADSET}/ads`, { fields: "id,name,status,effective_status,creative{id,object_story_spec}", limit: "50" });
if (ads.error) { console.error(JSON.stringify(ads.error)); process.exit(1); }
for (const a of ads.data || []) {
  const oss = a.creative?.object_story_spec || {};
  const vd = oss.video_data || {};
  const link = vd.call_to_action?.value?.link;
  console.log(`[${a.effective_status}] ${a.id}  ${a.name}`);
  console.log(`    page=${oss.page_id}  link=${link}`);
}
