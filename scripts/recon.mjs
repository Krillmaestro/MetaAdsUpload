import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

// ── env ──
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ── crypto (port of src/lib/crypto.ts) ──
const PREFIX = "enc:v1:";
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {}
  return createHash("sha256").update(raw).digest();
}
function decryptSecret(value) {
  if (!value.startsWith(PREFIX)) return value;
  const key = getKey();
  const [ivB64, tagB64, ctB64] = value.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

const sql = neon(process.env.DATABASE_URL);
const conns = await sql`SELECT id, name, is_active, active_ad_account_id, active_page_id, pixel_id, ad_accounts, token_expires_at FROM meta_connections WHERE is_active = true LIMIT 1`;
if (!conns.length) { console.log("NO ACTIVE CONNECTION"); process.exit(1); }
const conn = conns[0];
const tokenRow = await sql`SELECT access_token FROM meta_connections WHERE id = ${conn.id}`;
const token = decryptSecret(tokenRow[0].access_token);

const actId = conn.active_ad_account_id.startsWith("act_") ? conn.active_ad_account_id : `act_${conn.active_ad_account_id}`;
console.log("CONNECTION:", conn.name, "| id", conn.id);
console.log("AD ACCOUNT:", actId);
console.log("PAGE:", conn.active_page_id);
console.log("PIXEL:", conn.pixel_id);
console.log("TOKEN len:", token.length, "expires:", conn.token_expires_at);
console.log("AD ACCOUNTS ON CONN:", JSON.stringify(conn.ad_accounts));

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

// List campaigns (active + paused) — find the Fervin/Munhälsa/testing campaign
const camps = await fb(`/${actId}/campaigns`, {
  fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
  limit: 200,
});
console.log(`\n=== CAMPAIGNS (${camps.data.length}) ===`);
for (const c of camps.data) {
  const cbo = c.daily_budget || c.lifetime_budget ? ` CBO(${c.daily_budget || c.lifetime_budget})` : "";
  const flag = /fervin|munh|test|munhälsa|oral/i.test(c.name) ? "★" : " ";
  console.log(`${flag} [${c.effective_status}] ${c.id} | ${c.name}${cbo} | ${c.objective}`);
}
