// Apply one SQL migration file to DATABASE_URL, statement by statement.
// Usage: node scripts/apply-migration.mjs drizzle/0021_learning_loop.sql
// Every statement in our migrations is IF NOT EXISTS, so re-running is safe.
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/apply-migration.mjs <file.sql>"); process.exit(1); }

function loadEnv() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const raw = fs.readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"]+)"?\s*$/);
    if (m) return m[1].trim();
  }
  throw new Error("DATABASE_URL not found");
}

const sql = neon(loadEnv().trim());
const statements = fs
  .readFileSync(file, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
  .filter(Boolean);

let n = 0;
for (const stmt of statements) {
  await sql.query(stmt);
  n++;
  console.log("ok:", stmt.split("\n")[0].slice(0, 90));
}
console.log(`applied ${n} statements from ${file}`);
