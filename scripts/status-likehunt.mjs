import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { createDecipheriv, createHash } from "node:crypto";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
function getKey() { const raw = clean(process.env.TOKEN_ENCRYPTION_KEY); if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex"); try { const b = Buffer.from(raw, "base64"); if (b.length === 32) return b; } catch {} return createHash("sha256").update(raw).digest(); }
function dec(v) { if (!v.startsWith("enc:v1:")) return v; const [a, b, c] = v.slice(7).split(":"); const d = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(a, "base64")); d.setAuthTag(Buffer.from(b, "base64")); return Buffer.concat([d.update(Buffer.from(c, "base64")), d.final()]).toString("utf8"); }
const sql = neon(clean(process.env.DATABASE_URL));
const r = await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`;
const t = dec(r[0].access_token);
const g = async (p, q = {}) => { const u = new URL("https://graph.facebook.com/v25.0" + p); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v); u.searchParams.set("access_token", t); const R = await fetch(u); const j = await R.json(); if (!R.ok) throw new Error(`${p}: ` + JSON.stringify(j.error)); return j; };

const S = "120251855625800782";
const set = await g("/" + S, { fields: "name,configured_status,effective_status,issues_info,recommendations,daily_budget,optimization_goal,destination_type,bid_strategy,promoted_object,start_time" });
console.log("=== AD SET ===");
console.log(set.name, "\n  configured:", set.configured_status, "| effective:", set.effective_status);
console.log("  opt:", set.optimization_goal, "| dest:", set.destination_type, "| $" + set.daily_budget / 100 + "/d | bid:", set.bid_strategy);
if (set.issues_info) console.log("  ⚠ ISSUES:", JSON.stringify(set.issues_info, null, 2));
if (set.recommendations) console.log("  RECS:", JSON.stringify(set.recommendations, null, 2));

const ads = await g("/" + S + "/ads", { fields: "name,configured_status,effective_status,issues_info,creative{effective_object_story_id,id}", limit: 10 });
console.log("\n=== ADS (" + ads.data.length + ") ===");
for (const a of ads.data) {
  console.log(`\n[${a.effective_status}] ${a.name}`);
  if (a.issues_info) console.log("  ⚠ ISSUES:", JSON.stringify(a.issues_info));
  const pid = a.creative?.effective_object_story_id;
  console.log("  post_id:", pid || "(none yet)");
}

// insights (has it spent anything?)
try {
  const ins = await g("/" + S + "/insights", { fields: "spend,impressions,reach,actions", date_preset: "maximum" });
  console.log("\n=== INSIGHTS ===");
  console.log(ins.data?.length ? JSON.stringify(ins.data[0], null, 2) : "no delivery yet (spend=0)");
} catch (e) { console.log("insights err:", e.message); }
