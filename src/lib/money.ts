// ─── Account currency → USD (server-only) ──────────────────────────────────
// Insight rows are stored in the ad account's own currency. Glimmora is SEK,
// DogDivaCOmain is USD. Every editor number and every bonus is in USD, so each
// row is converted by ITS account's currency — dividing a USD account's spend
// by the SEK rate under-counted it ~10x.

import { db, schema } from "@/db";
import { sql, type SQL } from "drizzle-orm";

function act(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

/** act_… ids of every connected ad account whose currency is USD. */
export async function getUsdAccountIds(): Promise<string[]> {
  const conns = await db.select({ adAccounts: schema.metaConnections.adAccounts }).from(schema.metaConnections);
  const ids = new Set<string>();
  for (const c of conns) {
    for (const a of (c.adAccounts ?? []) as Array<{ id: string; currency?: string }>) {
      if ((a.currency || "").toUpperCase() === "USD") ids.add(act(a.id));
    }
  }
  return [...ids];
}

/**
 * SQL factor that turns one insights row's money into USD: 1 for USD accounts,
 * 1/sekPerUsd for everything else (SEK, and legacy rows with a NULL account,
 * which are all Glimmora/SEK).
 */
export function usdFactor(usdAccountIds: string[], sekPerUsd: number): SQL {
  const rate = sekPerUsd > 0 ? sekPerUsd : 10.5;
  if (usdAccountIds.length === 0) return sql`(1.0 / ${rate}::float8)`;
  return sql`(CASE WHEN ${schema.insights.adAccountId} IN (${sql.join(usdAccountIds.map((id) => sql`${id}`), sql`, `)}) THEN 1.0 ELSE 1.0 / ${rate}::float8 END)`;
}
