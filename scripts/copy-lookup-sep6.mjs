import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));

// 1) leta i templates
const tpls = await sql.query(`SELECT id, name, primary_texts, headlines FROM templates`);
for (const t of tpls) {
  const pts = (t.primary_texts || []).join("\n---\n");
  if (/Kämpar din hund|Tassarna\. Öronen\. Magen/.test(pts)) {
    console.log(`\n═══ TEMPLATE ${t.id}: ${t.name} ═══`);
    (t.primary_texts || []).forEach((p, i) => console.log(`\n[PT${i+1}]\n${p}`));
    console.log(`\n[HEADLINES] ${JSON.stringify(t.headlines)}`);
  }
}
// 2) leta i upload_jobs
const rows = await sql.query(`SELECT config->'adCopy'->'primaryTexts' AS pts FROM upload_jobs WHERE config::text LIKE '%Tassarna. Öronen. Magen. Du har behandlat%' LIMIT 1`);
if (rows.length) console.log("\n═══ upload_jobs-träff (Tassarna...) ═══\n", JSON.stringify(rows[0].pts, null, 1).slice(0, 2000));
const rows2 = await sql.query(`SELECT config->'adCopy'->'primaryTexts' AS pts FROM upload_jobs WHERE config::text LIKE '%Apotek Hundens 3-i-1 Probiotika är lösningen%' LIMIT 1`);
if (rows2.length) console.log("\n═══ upload_jobs-träff (Apotek Hundens 3-i-1...) ═══\n", JSON.stringify(rows2[0].pts, null, 1).slice(0, 2000));
