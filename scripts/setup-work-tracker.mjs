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

// Colours come from the validated chart palette (src/lib/work-palette.ts):
// blue, orange, aqua, yellow, magenta, green, violet, red — the set that stays
// distinguishable (incl. colour-vision deficiency) on the #111827 surface.
// The first six categories get six distinct slots, since those are the ones
// most likely to share a chart; the tail wraps around.
const SLOTS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const NEUTRAL = "#64748b";

// Eight categories = eight distinct hues, so no two ever collide in a chart,
// plus a neutral catch-all. Add more in the UI when you know what you're
// actually missing — a shorter list is also faster to pick from at start.
const CATEGORIES = [
  ["Script Writing", SLOTS[0]],
  ["Static Creation", SLOTS[1]],
  ["Video Editing", SLOTS[2]],
  ["Homepage / Landing Building", SLOTS[3]],
  ["Ad Launch & Optimization", SLOTS[4]],
  ["Creative Strategy & Research", SLOTS[5]],
  ["Meetings & Planning", SLOTS[6]],
  ["Admin & Finance", SLOTS[7]],
  ["Other", NEUTRAL],
];

// Seeded in an earlier round, dropped to keep the palette collision-free.
// Only removed when nothing has been logged against them.
const RETIRED = [
  "Analytics & Reporting",
  "Email & CRM",
  "Product & Sourcing",
  "Customer Support",
  "Learning & Research",
];

const BRANDS = [
  ["SmallDogCO", SLOTS[0]],
  ["ApotekHunden", SLOTS[1]],
  ["DogDivaCo", SLOTS[2]],
  ["Internal / Company", SLOTS[3]],
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
  // Retire the extra categories from the first seed — but never one that
  // already has time logged against it.
  const removed = await sql.query(
    `delete from work_categories c
      where c.name = any($1::text[])
        and not exists (select 1 from work_sessions s where s.category_id = c.id)
      returning name`,
    [RETIRED]
  );
  if (removed.length) console.log(`✓ retired ${removed.length} unused categories`);

  // Re-apply the intended colour to the seeded categories (they may carry an
  // older palette), then snap anything still outside the palette onto a slot.
  for (const [name, color] of CATEGORIES) {
    await sql.query(`update work_categories set color = $1 where name = $2`, [color, name]);
  }

  let snapped = 0;
  for (const table of ["work_categories", "work_brands"]) {
    const strays = await sql.query(
      `select id, sort_order from ${table} where lower(color) <> all($1::text[]) order by sort_order`,
      [[...SLOTS, NEUTRAL]]
    );
    for (const row of strays) {
      await sql.query(`update ${table} set color = $1 where id = $2`, [
        SLOTS[row.sort_order % SLOTS.length],
        row.id,
      ]);
      snapped++;
    }
  }

  const [{ count: catCount }] = await sql.query(`select count(*)::int as count from work_categories`);
  const [{ count: brandCount }] = await sql.query(`select count(*)::int as count from work_brands`);
  console.log(`✓ ${catCount} categories, ${brandCount} brands${snapped ? ` (${snapped} colours snapped to palette)` : ""}`);

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
