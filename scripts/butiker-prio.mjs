// Rank the B2B shop list by local demand: how many of our Shopify customers live
// in the shop's town, per 1 000 inhabitants, against the national average
// (index 1.0 = average, shrunk towards 1.0 for small numbers).
// A shop in a town without enough data borrows the strongest town in the same
// postal area (first three digits of the postcode), discounted by 20 %.
//
// Usage: node scripts/butiker-prio.mjs ortdata.json
//   ortdata.json = { pop: { "<town lower>": inhabitants }, cust: { "<town lower>": customers } }
//   pop comes from SCB's tätort list, cust from ShopifyQL "customers GROUP BY shipping_city".
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/butiker-prio.mjs <ortdata.json>"); process.exit(1); }
const { pop, cust } = JSON.parse(fs.readFileSync(file, "utf8"));

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const raw = fs.readFileSync(".env.local", "utf8");
  const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n]+)"?/m);
  if (!m) throw new Error("DATABASE_URL not found");
  return m[1].trim();
}
const sql = neon(loadEnv().trim());

const TOTAL_CUSTOMERS = Number(process.env.TOTAL_CUSTOMERS ?? 31393);
const SWEDEN_POP = 10_450_000;
const NATIONAL = (TOTAL_CUSTOMERS / SWEDEN_POP) * 1000; // customers per 1 000 inhabitants
const MIN_CUSTOMERS = 5;
// Postal towns often cover the countryside around a small tätort, so raw rates
// overrate villages. Shrink towards the national average with a prior worth
// K customers: a town needs both a high share and real volume to rank high.
const K = 20;
const demandIndex = (customers, inhabitants) => (customers + K) / ((inhabitants * NATIONAL) / 1000 + K);
const sv = (n, d = 1) => n.toLocaleString("sv-SE", { maximumFractionDigits: d, minimumFractionDigits: d });
const norm = (c) => (c ?? "").replace(/\s+SE-[A-Z]$/, "").trim().toLowerCase();
const formRank = (f) => (f === "EF" ? 1 : f && /HB|KB|Enkelt/.test(f) ? 2 : f === "AB" ? 3 : 4);

const leads = await sql.query("select id, name, city, postal_code, company_form from retail_leads");

const rows = leads.map((l) => {
  const town = norm(l.city);
  const customers = town ? cust[town] ?? 0 : null;
  const inhabitants = town ? pop[town] ?? null : null;
  const direct = customers != null && inhabitants && customers >= MIN_CUSTOMERS
    ? demandIndex(customers, inhabitants)
    : null;
  return { ...l, town, customers, inhabitants, direct, area: (l.postal_code ?? "").replace(/\D/g, "").slice(0, 3) || null };
});

// Strongest town per postal area
const areaBest = new Map();
for (const r of rows) {
  if (r.direct == null || !r.area) continue;
  const cur = areaBest.get(r.area);
  if (!cur || r.direct > cur.direct) areaBest.set(r.area, r);
}

for (const r of rows) {
  if (r.direct != null) {
    r.score = r.direct;
    r.note = `${r.customers} kunder i ${r.city} (${sv((r.customers / r.inhabitants) * 1000)} per 1 000 inv.) – efterfrågeindex ${sv(r.direct)}`;
  } else {
    const best = r.area ? areaBest.get(r.area) : null;
    if (best && best.id !== r.id) {
      r.score = best.direct * 0.8;
      r.note = `Närområde: ${best.city} har ${best.customers} kunder, efterfrågeindex ${sv(best.direct)}`
        + (r.customers ? ` · ${r.customers} kunder i ${r.city}` : "");
    } else {
      r.score = null;
      r.note = r.customers ? `${r.customers} kunder i ${r.city} (för få för att jämföra)` : "Inga kunder på orten än";
    }
  }
}

rows.sort((a, b) =>
  (b.score ?? -1) - (a.score ?? -1)
  || formRank(a.company_form) - formRank(b.company_form)
  || (b.customers ?? 0) - (a.customers ?? 0)
  || a.name.localeCompare(b.name, "sv"));

let n = 0;
for (const [i, r] of rows.entries()) {
  await sql.query(
    "update retail_leads set local_customers = $1, local_population = $2, local_index = $3, priority = $4, priority_note = $5 where id = $6",
    [r.customers, r.inhabitants, r.score == null ? null : Math.round(r.score * 100) / 100, i + 1, r.note, r.id],
  );
  n++;
}
console.log(`ranked ${n} shops · national ${sv(NATIONAL, 2)} customers per 1 000`);
console.log(rows.slice(0, 15).map((r, i) => `${i + 1}. ${r.name} (${r.city}, ${r.company_form ?? "?"}) – ${r.note}`).join("\n"));
