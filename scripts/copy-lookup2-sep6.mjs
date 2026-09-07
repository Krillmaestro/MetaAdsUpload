import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const t28 = await sql.query(`SELECT id, name, primary_texts, headlines FROM templates WHERE id=28`);
for (const t of t28) { console.log(`═══ TEMPLATE 28: ${t.name} ═══`); (t.primary_texts||[]).forEach((p,i)=>console.log(`\n[PT${i+1}]\n${p}`)); console.log(`\n[HEADLINES] ${JSON.stringify(t.headlines)}`); }
const hits = await sql.query(`SELECT id, name FROM templates WHERE array_to_string(primary_texts,'|') ILIKE '%majschips%' OR array_to_string(primary_texts,'|') ILIKE '%Tassarna. Öronen%'`);
console.log("\nTemplates med majschips/Tassarna:", JSON.stringify(hits));
const uj = await sql.query(`SELECT DISTINCT config->'adCopy'->>'primaryTexts' AS pts FROM upload_jobs WHERE config::text ILIKE '%majschips%' LIMIT 2`);
for (const r of uj) console.log("\n═══ upload_jobs majschips ═══\n", (r.pts||"").slice(0,1600));
const uj2 = await sql.query(`SELECT DISTINCT config->'adCopy'->>'primaryTexts' AS pts FROM upload_jobs WHERE config::text ILIKE '%Tassarna. Öronen. Magen%' LIMIT 2`);
for (const r of uj2) console.log("\n═══ upload_jobs Tassarna ═══\n", (r.pts||"").slice(0,1600));
