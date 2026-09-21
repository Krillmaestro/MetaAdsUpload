// Registrerar leveransen ZAM317/318/344/345 (packlista 18.09.2026, Fluffy Friends Lab -> Konsido 3PL Uppsala).
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); }
const sql = neon((process.env.DATABASE_URL||"").replace(/\\[rn]/g,"").trim());
const REF = "ZAM317/318/344/345";
const ORDERED = "2026-09-18";      // shipping preparation date
const ETA = process.argv[2] || "2026-09-21";
const LINES = [
  ["PRO", 2560, "Probiotics 180 g · batch M166/26 · bäst före 09.2028"],
  ["KLA", 2048, "Itch Support 180 g · batch M189/26 · bäst före 09.2028"],
  ["MUN", 1536, "Dental Care Premium 200 g · batch M208/26 · bäst före 09.2028"],
  ["CLM", 1024, "Calm&Relax 180 g · batch M175/26 · bäst före 09.2028"],
  ["LT",  1024, "Joint&Bone 180 g · batch M170/26 · bäst före 09.2028"],
  ["SC",  1024, "Skin&Coat 180 g · batch M174/26 · bäst före 09.2028"],
];
const prods = await sql`SELECT id, code, name FROM inventory_products`;
const byCode = Object.fromEntries(prods.map(p => [p.code, p]));
let total = 0;
for (const [code, units, batch] of LINES) {
  const p = byCode[code];
  if (!p) { console.log(`HOPPAR ÖVER ${code} – finns inte i katalogen`); continue; }
  const dup = await sql`SELECT id FROM inventory_purchase_orders WHERE product_id=${p.id} AND ordered_on=${ORDERED} AND units=${units}`;
  if (dup.length) { console.log(`redan registrerad: ${code} ${units} st`); continue; }
  await sql`INSERT INTO inventory_purchase_orders (id, product_id, units, ordered_on, eta_on, status, note, created_by_name)
    VALUES (${randomUUID()}, ${p.id}, ${units}, ${ORDERED}, ${ETA}, 'ordered', ${`${REF} · ${batch}`}, 'Packlista 18.09.2026')`;
  console.log(`✔ ${code.padEnd(4)} ${String(units).padStart(5)} st  ${p.name}`);
  total += units;
}
console.log(`\ntotalt registrerat: ${total} st (packlistan säger 9216)`);
const open = await sql`SELECT p.code, po.units, po.ordered_on, po.eta_on, po.status FROM inventory_purchase_orders po
  JOIN inventory_products p ON p.id=po.product_id WHERE po.received_on IS NULL ORDER BY p.sort_order`;
console.log('\növriga öppna ordrar i systemet:');
for (const o of open) console.log(`  ${o.code.padEnd(4)} ${String(o.units).padStart(5)} st · lagd ${o.ordered_on.toISOString?.().slice(0,10) ?? o.ordered_on} · ETA ${o.eta_on?.toISOString?.().slice(0,10) ?? o.eta_on} · ${o.status}`);
