import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { getDocumentProxy } from "unpdf";
import { ensureCatalog, matchLineItem } from "./catalog";
import { syncTracking } from "./tracking";

export type ReportRow = { sku: string | null; title: string; units: number };
export type ParsedReport = { createdAt: Date; reportDate: string; rows: ReportRow[] };

/** Report clocks are Swedish local time; find the matching UTC instant across DST. */
export function stockholmToUtc(date: string, time: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  const wall = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(guess);
  const asUtc = new Date(`${wall.replace(" ", "T")}Z`);
  return new Date(guess.getTime() - (asUtc.getTime() - guess.getTime()));
}

export const stockholmDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

const ROW = /^(\S+)\s+(.+?)\s+(-?\d{1,3}(?: \d{3})*)\s+(?:—|[\d ,.]+(?:kr)?)\s+(?:—|[\d ,.]+(?:kr)?)$/;

/** Rebuild the visual table rows, because PDF text comes back as loose positioned pieces. */
export async function parseKonsidoReport(data: Uint8Array): Promise<ParsedReport> {
  const pdf = await getDocumentProxy(data);
  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as { str?: string; transform?: number[] }[]) {
      if (!item.str?.trim() || !item.transform) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      byY.set(y, [...(byY.get(y) ?? []), { x: item.transform[4], s: item.str.trim() }]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      lines.push(byY.get(y)!.sort((a, b) => a.x - b.x).map((p) => p.s).join(" "));
    }
  }

  const clean = lines.map((l) => l.replace(/[   ]/g, " ").replace(/−/g, "-").replace(/\s+/g, " ").trim());
  const stamp = clean.join("\n").match(/Rapport skapad (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
  if (!stamp) throw new Error("Hittar inte klockslaget (\"Rapport skapad\") i rapporten");

  const rows: ReportRow[] = [];
  for (const line of clean) {
    const m = line.match(ROW);
    if (!m || m[1] === "Totalt") continue;
    rows.push({ sku: m[1] === "-" || m[1] === "—" ? null : m[1], title: m[2], units: Number(m[3].replace(/ /g, "")) });
  }
  if (rows.length < 3) throw new Error("Hittar inga produktrader i rapporten");
  return { createdAt: stockholmToUtc(stamp[1], stamp[2]), reportDate: stamp[1], rows };
}

/**
 * Store one report as the new anchor. Rows for the same physical goods are netted: the
 * warehouse can book arrivals and picks on different articles, which leaves one row
 * positive and another negative, and the sum is what is really on the shelf.
 */
export async function saveReport(report: ParsedReport, who: string | null) {
  const products = await ensureCatalog();
  const totals = new Map<string, { units: number; parts: string[] }>();
  const unmatched: string[] = [];
  for (const row of report.rows) {
    const id = matchLineItem({ title: row.title, sku: row.sku }, products);
    if (!id) {
      unmatched.push(`${row.title} (${row.units})`);
      continue;
    }
    const slot = totals.get(id) ?? { units: 0, parts: [] };
    slot.units += row.units;
    slot.parts.push(`${row.sku ?? "utan sku"}: ${row.units}`);
    totals.set(id, slot);
  }

  for (const [productId, t] of totals) {
    await db
      .delete(schema.inventoryCounts)
      .where(and(
        eq(schema.inventoryCounts.productId, productId),
        eq(schema.inventoryCounts.source, "konsido"),
        eq(schema.inventoryCounts.countedAt, report.createdAt),
      ));
    await db.insert(schema.inventoryCounts).values({
      productId, units: t.units, countedOn: stockholmDate(report.createdAt), countedAt: report.createdAt,
      source: "konsido", note: `Konsido-rapport · ${t.parts.join(" · ")}`.slice(0, 500), createdByName: who,
    });
  }
  const tracking = await syncTracking({ since: report.createdAt });
  return { createdAt: report.createdAt.toISOString(), products: totals.size, unmatched, tracking };
}
