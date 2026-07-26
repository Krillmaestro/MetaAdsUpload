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

const ACT = "act_2277004866371824";
const BASE = "https://graph.facebook.com/v25.0";
const gGet = async (p, q = {}) => { const u = new URL(BASE + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", TOKEN); const r = await fetch(u); return r.json(); };

// ── find pages (multiple sources) ──
const pages = new Map();
for (const edge of ["/me/accounts", `/${ACT}/promote_pages`, `/${ACT}/assigned_pages`]) {
  try {
    let next = null; let url = edge; let q = { fields: "id,name", limit: "200" };
    const j = await gGet(url, q);
    if (j.error) { console.log(`(${edge}: ${j.error.message})`); continue; }
    for (const p of j.data || []) pages.set(p.id, p.name);
    next = j.paging?.next;
    let guard = 0;
    while (next && guard++ < 10) { const r = await fetch(next); const jj = await r.json(); for (const p of jj.data || []) pages.set(p.id, p.name); next = jj.paging?.next; }
  } catch (e) { console.log(`(${edge}: ${e.message})`); }
}
console.log(`\n=== pages accessible (${pages.size}) ===`);
const all = [...pages.entries()];
const kath = all.filter(([, n]) => /kath|kathlin|kathlyn|kaitlin|dr\.?\s*kath/i.test(n));
console.log("\n>>> MATCHES for 'Kathlin':");
if (kath.length) kath.forEach(([id, n]) => console.log(`   ${id}  ${n}`));
else { console.log("   (none) — showing all pages so you can pick:"); all.forEach(([id, n]) => console.log(`   ${id}  ${n}`)); }

// ── preflight the DIVA 22 batch ──
const dir = "C:/Users/krill/Downloads/DIVA 22-20260716T203602Z-1-001/DIVA 22";
const files = readdirSync(dir).filter((f) => /\.mp4$/i.test(f));
const vids = files.map((f) => { const m = f.match(/^(H\d+)/i); return { hook: (m ? m[1] : f).toUpperCase(), file: f }; }).sort((a, b) => (parseInt(a.hook.slice(1)) || 0) - (parseInt(b.hook.slice(1)) || 0));
const ADSET = "USA Fervin Jul22 - #1 - UGC - pp - Evergreen - Scratching - Oskar";
console.log(`\n=== DIVA 22 preflight ===`);
console.log("Ad set name:", ADSET);
vids.forEach((v) => console.log(`   ${v.hook}  ad="${v.hook} ${ADSET}"   file="${v.file}"`));
