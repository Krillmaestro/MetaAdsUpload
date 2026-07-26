import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const PREFIX = "enc:v1:";
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {}
  return createHash("sha256").update(raw).digest();
}
function decryptSecret(value) {
  if (!value.startsWith(PREFIX)) return value;
  const key = getKey();
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(ctB64, "base64")), d.final()]).toString("utf8");
}
const sql = neon(process.env.DATABASE_URL);
const r = await sql`SELECT access_token FROM meta_connections WHERE is_active = true LIMIT 1`;
const token = decryptSecret(r[0].access_token);
const V = "v25.0";
async function fb(path, params = {}) {
  const url = new URL(`https://graph.facebook.com/${V}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set("access_token", token);
  const res = await fetch(url);
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j.error));
  return j;
}

const CAMP = "120248826608070350"; // Munhälsa // CBO
const sets = await fb(`/${CAMP}/adsets`, {
  fields: "id,name,status,effective_status,daily_budget,optimization_goal,billing_event,bid_strategy,promoted_object,attribution_spec,targeting,destination_type,start_time,created_time",
  limit: 100,
});
console.log(`=== AD SETS in Munhälsa // CBO (${sets.data.length}) ===\n`);
// newest first
sets.data.sort((a,b) => (b.created_time||"").localeCompare(a.created_time||""));
for (const s of sets.data.slice(0, 12)) {
  console.log(`[${s.effective_status}] ${s.id} | ${s.name}`);
  console.log(`   opt=${s.optimization_goal} bill=${s.billing_event} bid=${s.bid_strategy||"-"} budget=${s.daily_budget||"(CBO)"} dest=${s.destination_type||"-"}`);
  console.log(`   promoted=${JSON.stringify(s.promoted_object)}`);
  console.log(`   attribution=${JSON.stringify(s.attribution_spec)}`);
  console.log(`   targeting=${JSON.stringify(s.targeting)}`);
  console.log("");
}

// Show one full ad set's most recent ads to confirm ad naming + creative shape
const newest = sets.data.find(s => /fervin/i.test(s.name)) || sets.data[0];
console.log(`\n=== ADS in newest/fervin set: ${newest.name} (${newest.id}) ===`);
const ads = await fb(`/${newest.id}/ads`, { fields: "id,name,status,effective_status", limit: 30 });
for (const a of ads.data) console.log(`  [${a.effective_status}] ${a.name}`);
