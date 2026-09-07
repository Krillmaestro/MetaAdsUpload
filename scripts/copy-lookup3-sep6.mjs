import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const clean = (s) => (s || "").replace(/\\[rn]/g, "").trim();
const sql = neon(clean(process.env.DATABASE_URL));
const hits = await sql.query(`SELECT id, name, primary_texts FROM templates WHERE primary_texts::text ILIKE '%majschips%' OR primary_texts::text ILIKE '%Tassarna. Öronen%'`);
for (const t of hits) { console.log(`═══ TEMPLATE ${t.id}: ${t.name} ═══`); (t.primary_texts||[]).forEach((p,i)=>console.log(`\n[PT${i+1}]\n${p}`)); }
for (const pat of ['%majschips%', '%Tassarna. Öronen. Magen%']) {
  const uj = await sql.query(`SELECT DISTINCT config->'adCopy'->>'primaryTexts' AS pts FROM upload_jobs WHERE config::text ILIKE $1 LIMIT 2`, [pat]);
  for (const r of uj) console.log(`\n═══ upload_jobs ${pat} ═══\n${(r.pts||"").slice(0,1800)}`);
}
