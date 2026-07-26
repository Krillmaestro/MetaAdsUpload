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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ADSETS = { batch18: "120252091332060782", batch21: "120252091363340782", batch22: "120252091394500782" };
const BAD = new Set(["DISAPPROVED", "WITH_ISSUES", "ADSET_PAUSED", "CAMPAIGN_PAUSED", "DELETED", "ARCHIVED"]);
const INTERVAL = 150000, MAX_ROUNDS = 32; // ~80 min cap

const pad = (n) => String(n).padStart(2, "0");
async function snapshot() {
  const rows = [];
  for (const [tag, id] of Object.entries(ADSETS)) {
    const ads = await gGet(`/${id}/ads`, { fields: "name,effective_status", limit: "50" });
    for (const a of ads.data || []) rows.push({ tag, id: a.id, name: a.name, st: a.effective_status });
  }
  return rows;
}

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const rows = await snapshot();
  const counts = {};
  for (const r of rows) counts[r.st] = (counts[r.st] || 0) + 1;
  const active = counts.ACTIVE || 0;
  const bad = rows.filter((r) => BAD.has(r.st));
  const now = new Date();
  const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  console.log(`[${stamp}] round ${round}: ${active}/${rows.length} ACTIVE  |  ${JSON.stringify(counts)}`);

  if (bad.length) {
    console.log(`\n!!! ${bad.length} ad(s) need attention:`);
    for (const r of bad) console.log(`   [${r.st}] ${r.id}  ${r.name}`);
  }
  if (active === rows.length) {
    console.log(`\n>>> ALL ${rows.length} ADS ACTIVE / LIVE <<<`);
    break;
  }
  if (bad.length) { console.log(`\n>>> stopping early — issues to review above <<<`); break; }
  if (round === MAX_ROUNDS) { console.log(`\n>>> reached max wait (~80 min); ${active}/${rows.length} active, rest still in review <<<`); break; }
  await sleep(INTERVAL);
}
