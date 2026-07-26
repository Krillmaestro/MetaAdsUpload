import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const PREFIX = "enc:v1:";
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith(PREFIX)) return v; const [a, b, c] = v.slice(PREFIX.length).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const r = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const t = dec(r[0].access_token);
const g = async (p, q = {}) => { const u = new URL("https://graph.facebook.com/v25.0" + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", t); const R = await fetch(u); const j = await R.json(); if (!R.ok) throw new Error(`${p}: ` + JSON.stringify(j.error)); return j; };

const CAMP = "120251837725300782";
// ALL adsets incl archived
const sets = await g(`/${CAMP}/adsets`, { fields: "id,name,status,configured_status,effective_status,optimization_goal,destination_type,promoted_object,daily_budget,created_time", limit: 50 });
console.log(`=== ALL AD SETS in campaign (${sets.data.length}) ===`);
for (const s of sets.data) {
  console.log(`\n[${s.effective_status}/${s.configured_status}] ${s.id} | ${s.name}`);
  console.log(`  opt=${s.optimization_goal} dest=${s.destination_type||"-"} budget=${s.daily_budget?("$"+s.daily_budget/100):"-"} created=${s.created_time}`);
  console.log(`  promoted=${JSON.stringify(s.promoted_object)}`);
  const ads = await g(`/${s.id}/ads`, { fields: "id,name,effective_status", limit: 25 });
  console.log(`  ads: ${ads.data.length}`);
  for (const a of ads.data) console.log(`    [${a.effective_status}] ${a.name}`);
}
