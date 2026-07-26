import { readFileSync, readdirSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";

// ── env + token (same as publish-dd-batch) ──
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const cr = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const TOKEN = dec(cr[0].access_token);

const BASE = "https://graph.facebook.com/v25.0";
const CAMP = "120251818258290782"; // DivaDigest // CBO
const gGet = async (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const r = await fetch(u); return r.json(); };

// ── dupe check: any Jul14 / Florencio ad-sets already in the CBO? ──
const adsets = await gGet(`/${CAMP}/adsets`, { fields: "id,name,status,effective_status", limit: "200" });
if (adsets.error) { console.error("adsets error:", JSON.stringify(adsets.error)); process.exit(1); }
console.log(`=== ad-sets in DivaDigest // CBO (${(adsets.data || []).length}) ===`);
for (const a of adsets.data || []) console.log(`  [${a.effective_status}] ${a.id}  ${a.name}`);
const dupes = (adsets.data || []).filter((a) => /jul14|florencio/i.test(a.name));
console.log(`\n>>> Jul14/Florencio matches: ${dupes.length ? dupes.map((d) => `${d.id} "${d.name}"`).join("; ") : "NONE — clear to launch"}`);

// ── verify Josephine Hart page id ──
const page = await gGet(`/1290404807478582`, { fields: "id,name" });
console.log(`\n>>> page 1290404807478582 = ${page.error ? JSON.stringify(page.error) : page.name}`);

// ── preflight names ──
const dir = "C:/Users/krill/Downloads/Batch 14 USA -20260716T203731Z-1-001/Batch 14 USA";
const files = readdirSync(dir).filter((f) => /\.mp4$/i.test(f));
const vids = files.map((f) => { const m = f.match(/^(H\d+)/i); return { hook: (m ? m[1] : f).toUpperCase(), file: f }; }).sort((a, b) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b.hook.slice(1)) || 0));
const ADSET = "USA Florencio Jul14 - #1 - UGC - PP+LP - Evergr";
console.log(`\n=== Batch 14 preflight ===`);
console.log("Ad set name:", ADSET);
vids.forEach((v) => console.log(`   ${v.hook}  ad="${v.hook} ${ADSET}"   file="${v.file}"`));
