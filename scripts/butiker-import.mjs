// Import shop leads from CSV into retail_leads (the Butiker tab).
// Usage: node scripts/butiker-import.mjs file1.csv [file2.csv …] [--dry]
// Columns: namn,typ,adress,postnr,ort,lan,telefon,epost,webb,marken,bolagsform,kalla
// Re-running is safe: a shop already in the list (same name + city) only gets its
// EMPTY contact fields filled and new brands appended — status and call log are never touched.
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const files = args.filter((a) => !a.startsWith("--"));
if (!files.length) { console.error("usage: node scripts/butiker-import.mjs <file.csv> … [--dry]"); process.exit(1); }

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"]+)"?\s*$/);
    if (m) return m[1].trim();
  }
  throw new Error("DATABASE_URL not found");
}

function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const head = rows.shift().map((h) => h.trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim() || null])));
}

const key = (name, city) => `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${(city ?? "").trim().toLowerCase()}`;
const mergeBrands = (a, b) => {
  const set = new Set([...(a ?? "").split(/[;,|]/), ...(b ?? "").split(/[;,|]/)].map((x) => x.trim()).filter(Boolean));
  return set.size ? [...set].join(", ") : null;
};
const normForm = (f) => (!f ? null : /enskild|^ef$/i.test(f) ? "EF" : /aktiebolag|^ab$/i.test(f) ? "AB" : f);

// Merge all files in memory first, so the same shop from two sources becomes one row.
const merged = new Map();
for (const f of files) {
  for (const r of parseCsv(fs.readFileSync(f, "utf8"))) {
    if (!r.namn) continue;
    const k = key(r.namn, r.ort);
    const prev = merged.get(k);
    const next = {
      name: r.namn, type: r.typ, address: r.adress, postalCode: r.postnr, city: r.ort, county: r.lan,
      phone: r.telefon, email: r.epost, website: r.webb, brands: r.marken, companyForm: normForm(r.bolagsform), source: r.kalla,
    };
    if (!prev) { merged.set(k, next); continue; }
    for (const [f2, v] of Object.entries(next)) if (!prev[f2] && v) prev[f2] = v;
    prev.brands = mergeBrands(prev.brands, next.brands);
  }
}
console.log(`${merged.size} unika butiker i ${files.length} fil(er)`);
if (dry) process.exit(0);

const sql = neon(loadEnv().trim());
let inserted = 0, updated = 0;
for (const [k, l] of merged) {
  const res = await sql.query(
    `INSERT INTO retail_leads (id, dedupe_key, name, type, address, postal_code, city, county, phone, email, website, brands, company_form, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (dedupe_key) DO UPDATE SET
       type = COALESCE(retail_leads.type, EXCLUDED.type),
       address = COALESCE(retail_leads.address, EXCLUDED.address),
       postal_code = COALESCE(retail_leads.postal_code, EXCLUDED.postal_code),
       county = COALESCE(retail_leads.county, EXCLUDED.county),
       phone = COALESCE(retail_leads.phone, EXCLUDED.phone),
       email = COALESCE(retail_leads.email, EXCLUDED.email),
       website = COALESCE(retail_leads.website, EXCLUDED.website),
       company_form = COALESCE(retail_leads.company_form, EXCLUDED.company_form),
       brands = CASE WHEN retail_leads.brands IS NULL THEN EXCLUDED.brands
                     WHEN EXCLUDED.brands IS NULL OR position(EXCLUDED.brands in retail_leads.brands) > 0 THEN retail_leads.brands
                     ELSE retail_leads.brands || ', ' || EXCLUDED.brands END,
       updated_at = now()
     RETURNING (xmax = 0) AS inserted`,
    [crypto.randomUUID(), k, l.name, l.type, l.address, l.postalCode, l.city, l.county, l.phone, l.email, l.website, l.brands, l.companyForm, l.source],
  );
  if (res[0]?.inserted) inserted++; else updated++;
}
console.log(`klart: ${inserted} nya, ${updated} kompletterade`);
