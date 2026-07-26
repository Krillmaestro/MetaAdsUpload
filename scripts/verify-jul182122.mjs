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

const ADSETS = {
  batch18: "120252091332060782",
  batch21: "120252091363340782",
  batch22: "120252091394500782",
};

let total = 0, active = 0, other = 0;
for (const [tag, id] of Object.entries(ADSETS)) {
  const as = await gGet(`/${id}`, { fields: "name,effective_status" });
  const ads = await gGet(`/${id}/ads`, { fields: "name,effective_status,configured_status", limit: "50" });
  console.log(`\n### ${tag}  adset ${id}  [${as.effective_status}]  ${as.name}`);
  for (const a of ads.data || []) {
    total++;
    if (a.effective_status === "ACTIVE") active++; else other++;
    console.log(`   [${a.effective_status}] ${a.id}  ${a.name}`);
  }
}
console.log(`\n=== ${active}/${total} ads ACTIVE  (${other} other) ===`);
