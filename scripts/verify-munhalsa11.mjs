import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const PREFIX = "enc:v1:";
function getKey() {
  const raw = clean(process.env.TOKEN_ENCRYPTION_KEY);
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {}
  return createHash("sha256").update(raw).digest();
}
function dec(v) {
  if (!v.startsWith(PREFIX)) return v;
  const [a, b, c] = v.slice(PREFIX.length).split(":");
  const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64"));
  d.setAuthTag(Buffer.from(b, "base64"));
  return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8");
}
const sql = neon(clean(process.env.DATABASE_URL));
const r = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const t = dec(r[0].access_token);
const g = async (p, q = {}) => {
  const u = new URL("https://graph.facebook.com/v25.0" + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", t);
  const R = await fetch(u); const j = await R.json();
  if (!R.ok) throw new Error(JSON.stringify(j.error));
  return j;
};
const s = await g("/120253688624760350", { fields: "name,status,effective_status,campaign{id,name},account_id" });
console.log("AD SET:", s.name);
console.log("  status:", s.status, "| effective:", s.effective_status);
console.log("  campaign:", s.campaign?.name, "(" + s.campaign?.id + ")");
console.log("  account:", s.account_id);
const ads = await g("/120253688624760350/ads", { fields: "name,status,effective_status", limit: 20 });
console.log("\nADS (" + ads.data.length + "):");
for (const a of ads.data) console.log("  [" + a.effective_status + "] " + a.name);
