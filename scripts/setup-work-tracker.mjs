/**
 * Founder time tracker — one-time setup / re-runnable seed.
 *
 *   node scripts/setup-work-tracker.mjs
 *
 * 1. Applies drizzle/0017_founder_time_tracker.sql (idempotent — IF NOT EXISTS everywhere)
 * 2. Seeds the default work categories + brands (skips ones that already exist)
 * 3. Flags the founder accounts so they can reach /time
 */
import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

// --- load DATABASE_URL from .env.local ---------------------------------------
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const sql = neon(url);

const FOUNDER_EMAILS = ["kristofferjakobsen21@gmail.com", "oskar@apotekhunden.se"];

const CATEGORIES = [
  ["Script Writing", "#38bdf8"],
  ["Static Creation", "#f472b6"],
  ["Video Editing", "#a78bfa"],
  ["Homepage / Landing Building", "#34d399"],
  ["Ad Launch & Optimization", "#fb923c"],
  ["Creative Strategy & Research", "#facc15"],
  ["Analytics & Reporting", "#22d3ee"],
  ["Email & CRM", "#f87171"],
  ["Product & Sourcing", "#4ade80"],
  ["Customer Support", "#60a5fa"],
  ["Admin & Finance", "#94a3b8"],
  ["Meetings & Planning", "#c084fc"],
  ["Learning & Research", "#2dd4bf"],
  ["Other", "#64748b"],
];

const BRANDS = [
  ["SmallDogCO", "#f59e0b"],
  ["ApotekHunden", "#10b981"],
  ["DogDivaCo", "#ec4899"],
  ["Internal / Company", "#64748b"],
];

async function main() {
  // 1. migration
  const migration = fs.readFileSync(
    path.join(process.cwd(), "drizzle", "0017_founder_time_tracker.sql"),
    "utf8"
  );
  const statements = migration
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s && !/^(--[^\n]*\n?)+$/.test(s));

  for (const stmt of statements) {
    await sql.query(stmt);
  }
  console.log(`✓ migration applied (${statements.length} statements)`);

  // 2. seeds
  for (let i = 0; i < CATEGORIES.length; i++) {
    const [name, color] = CATEGORIES[i];
    await sql.query(
      `insert into work_categories (id, name, color, sort_order)
       values (gen_random_uuid()::text, $1, $2, $3)
       on conflict (name) do nothing`,
      [name, color, i]
    );
  }
  for (let i = 0; i < BRANDS.length; i++) {
    const [name, color] = BRANDS[i];
    await sql.query(
      `insert into work_brands (id, name, color, sort_order)
       values (gen_random_uuid()::text, $1, $2, $3)
       on conflict (name) do nothing`,
      [name, color, i]
    );
  }
  const [{ count: catCount }] = await sql.query(`select count(*)::int as count from work_categories`);
  const [{ count: brandCount }] = await sql.query(`select count(*)::int as count from work_brands`);
  console.log(`✓ ${catCount} categories, ${brandCount} brands`);

  // 3. founders
  const founders = await sql.query(
    `update users set is_founder = true where email = any($1::text[]) returning name, email`,
    [FOUNDER_EMAILS]
  );
  console.log(`✓ founders: ${founders.map((f) => `${f.name} <${f.email}>`).join(", ") || "none matched"}`);

  const missing = FOUNDER_EMAILS.filter((e) => !founders.some((f) => f.email === e));
  if (missing.length) console.warn(`! no account for: ${missing.join(", ")}`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
