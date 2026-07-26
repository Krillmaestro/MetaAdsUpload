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

const ACT = "act_2277004866371824"; // DogDivaCOmain
const g = async (p, q = {}) => {
  const u = new URL("https://graph.facebook.com/v25.0" + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", t);
  const R = await fetch(u); const j = await R.json();
  if (!R.ok) throw new Error(`${p}: ` + JSON.stringify(j.error));
  return j;
};

// Recent campaigns (any status incl. drafts / with issues)
const camps = await g(`/${ACT}/campaigns`, {
  fields: "id,name,status,effective_status,objective,special_ad_categories,issues_info,created_time",
  limit: 25,
  date_preset: "maximum",
});
camps.data.sort((a,b)=>(b.created_time||"").localeCompare(a.created_time||""));
console.log("=== RECENT CAMPAIGNS (DogDivaCOmain) ===");
for (const c of camps.data.slice(0, 10)) {
  const flag = /like|hunt|warm/i.test(c.name) ? "★" : " ";
  console.log(`${flag} [${c.effective_status}] ${c.id} | ${c.name} | obj=${c.objective} | SAC=${JSON.stringify(c.special_ad_categories)}`);
  if (c.issues_info) console.log("    ISSUES:", JSON.stringify(c.issues_info));
}

// Find like-hunt campaign
const camp = camps.data.find(c => /like|hunt|warm/i.test(c.name)) || camps.data[0];
console.log(`\n=== DRILL: ${camp.name} (${camp.id}) ===`);

const sets = await g(`/${camp.id}/adsets`, {
  fields: "id,name,status,effective_status,optimization_goal,billing_event,destination_type,promoted_object,issues_info,targeting,created_time",
  limit: 25,
});
for (const s of sets.data) {
  console.log(`\n  ADSET [${s.effective_status}] ${s.id} | ${s.name}`);
  console.log(`    opt=${s.optimization_goal} bill=${s.billing_event} dest=${s.destination_type||"-"}`);
  console.log(`    promoted=${JSON.stringify(s.promoted_object)}`);
  if (s.issues_info) console.log("    ⚠ ISSUES:", JSON.stringify(s.issues_info, null, 2));
  // ads under this set
  try {
    const ads = await g(`/${s.id}/ads`, { fields: "id,name,effective_status,issues_info,creative{id}", limit: 25 });
    for (const a of ads.data) {
      console.log(`      AD [${a.effective_status}] ${a.id} | ${a.name}`);
      if (a.issues_info) console.log("        ⚠ ISSUES:", JSON.stringify(a.issues_info, null, 2));
    }
  } catch (e) { console.log("      (ads fetch error)", e.message); }
}
