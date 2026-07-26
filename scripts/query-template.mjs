import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

// Load .env.local
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT id, name, is_default, objective, budget_type, daily_budget, currency, headlines, primary_texts, descriptions, cta_type, landing_pages, target_countries, age_min, age_max, genders, optimization_goal, conversion_event, bid_strategy, adset_name_template, ad_name_template, product_name, angle_name, pixel_id, ad_account_id FROM templates ORDER BY name`;

for (const r of rows) {
  const isMun = /munh|munhälsa|munhalsa|pp.*5r|fervin/i.test(r.name);
  console.log(`\n${isMun ? "★ " : "  "}[${r.id}] ${r.name}${r.is_default ? " (DEFAULT)" : ""}`);
  if (isMun) {
    console.log(JSON.stringify(r, null, 2));
  }
}
