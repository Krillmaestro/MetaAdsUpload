import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const TOKEN = (await sql`SELECT access_token FROM meta_connections WHERE is_active=true LIMIT 1`)[0].access_token;

const ACT = "act_261297039993717";
const BASE = "https://graph.facebook.com/v25.0";
const g = async (p, q = {}) => {
  const u = new URL(BASE + p);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", TOKEN);
  return (await fetch(u)).json();
};
const post = async (p, params) => {
  const b = new URLSearchParams({ ...params, access_token: TOKEN });
  return (await fetch(BASE + p, { method: "POST", body: b })).json();
};

const SRC_ADSET_NAME = "SE Gene Aug31 - #1 - STATIC - LP1 + PP - Evergreen - InteMer - Gene";
const ABO = "120254782838750350";

// källa
const srcAdsets = await g(`/${ABO}/adsets`, { fields: "id,name", limit: "200" });
const src = (srcAdsets.data || []).find((a) => a.name === SRC_ADSET_NAME);
if (!src) { console.log("KÄLL-ADSET SAKNAS"); process.exit(1); }
const srcAds = await g(`/${src.id}/ads`, { fields: "id,name,status,creative{id}", limit: "50" });
console.log(`KÄLLA ${src.id}:`);
for (const a of srcAds.data || []) console.log(`  ${a.id}  creative=${a.creative.id}  [${a.status}]  ${a.name}`);

// mål: Allergi-CBO
const camps = await g(`/${ACT}/campaigns`, { fields: "id,name,effective_status", limit: "200" });
const cbo = (camps.data || []).find((c) => c.name === "Allergi & Klåda // CBO // 2026-04");
if (!cbo) { console.log("CBO SAKNAS. Kampanjer:", (camps.data || []).map((c) => c.name).join(" | ")); process.exit(1); }
console.log(`\nMÅLKAMPANJ ${cbo.id} (${cbo.effective_status}): ${cbo.name}`);
const tAdsets = await g(`/${cbo.id}/adsets`, { fields: "id,name,effective_status", limit: "200" });
for (const a of tAdsets.data || []) console.log(`  ADSET ${a.id} [${a.effective_status}] ${a.name}`);

// dublettkontroll: ALLA ads i målkampanjen
const tAds = await g(`/${cbo.id}/ads`, { fields: "id,name,status,creative{id},adset{name}", limit: "500" });
console.log(`\nDUBLETTKONTROLL — ${(tAds.data || []).length} ads i målkampanjen:`);
const srcCreatives = new Set((srcAds.data || []).map((a) => a.creative.id));
const srcNames = new Set((srcAds.data || []).map((a) => a.name));
let dup = false;
for (const a of tAds.data || []) {
  const hit = srcCreatives.has(a.creative.id) || srcNames.has(a.name);
  if (hit) { dup = true; console.log(`  ⚠️ DUBLETT: ${a.name} (creative ${a.creative.id}) i ${a.adset.name}`); }
}
if (!dup) console.log("  ✓ inga dubletter (varken namn eller creative_id)");

const TARGET = process.env.TARGET_ADSET;
if (!TARGET) { console.log("\nRECON KLAR — sätt TARGET_ADSET för att flytta."); process.exit(0); }
if (dup) { console.log("DUBLETT FUNNEN — avbryter flytt."); process.exit(1); }
for (const a of srcAds.data || []) {
  if (a.status !== "ACTIVE") { console.log(`hoppar (${a.status}): ${a.name}`); continue; }
  const r = await post(`/${ACT}/ads`, {
    name: a.name, adset_id: TARGET,
    creative: JSON.stringify({ creative_id: a.creative.id }),
    status: "ACTIVE",
  });
  console.log(r.error ? `FAIL ${a.name}: ${JSON.stringify(r.error).slice(0, 200)}` : `✓ scaling-kopia ${r.id}  ${a.name}`);
}
console.log("KÄLLAN LÄMNAS AKTIV I ABO (livscykelregeln).");
