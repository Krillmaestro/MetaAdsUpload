import { db, schema } from "@/db";

/**
 * Default catalogue, derived from 60 days of real ApotekHunden line items (Sep 2026).
 *
 * Matching runs sku-first, then a case-insensitive title substring, because the store
 * has renamed products over time while keeping the sku ("Klåda & Allergi" -> "Quercetin+",
 * both sku 5) and because ~5 % of line items carry no sku at all.
 *
 * Multi-packs are NOT separate variants in this store: a 2-pack is quantity 2 on one
 * line, so `quantity` already equals the number of jars leaving the shelf.
 *
 * Gifts count. FingerBorste, Tandstensskrapa and Belöningsbitar ship free with the
 * Munhälsa kit and the 2+ offer, but they are physical units that run out.
 */
export type CatalogSeed = {
  code: string;
  name: string;
  matchSkus: string[];
  matchTitles: string[];
  unitLabel: string;
  sortOrder: number;
};

export const DEFAULT_CATALOG: CatalogSeed[] = [
  { code: "PRO", name: "3-i-1 Probiotika", matchSkus: ["1", "1D", "1E"], matchTitles: ["probiotika"], unitLabel: "burkar", sortOrder: 10 },
  { code: "KLA", name: "Quercetin+ (Klåda & Allergi)", matchSkus: ["5"], matchTitles: ["klåda & allergi", "quercetin+", "hud+ tuggor"], unitLabel: "burkar", sortOrder: 20 },
  { code: "MUN", name: "MUNHÄLSA+ hund", matchSkus: ["2"], matchTitles: ["munhälsa"], unitLabel: "burkar", sortOrder: 30 },
  { code: "CLM", name: "Calming Chews", matchSkus: ["7"], matchTitles: ["calming chews", "daglig+ tuggor"], unitLabel: "burkar", sortOrder: 40 },
  { code: "SC", name: "Skin & Coat", matchSkus: ["6"], matchTitles: ["skin & coat"], unitLabel: "burkar", sortOrder: 50 },
  { code: "LT", name: "Ledtillskott", matchSkus: ["4"], matchTitles: ["ledtillskott"], unitLabel: "burkar", sortOrder: 60 },
  { code: "BEL", name: "Belöningsbitar+ Kalkon (gåva)", matchSkus: ["8", "8B"], matchTitles: ["belöningsbitar"], unitLabel: "påsar", sortOrder: 70 },
  { code: "FB", name: "FingerBorste (gåva)", matchSkus: ["9-1", "9-3", "9-4"], matchTitles: ["fingerborste"], unitLabel: "st", sortOrder: 80 },
  { code: "TSK", name: "Tandstensskrapa (gåva)", matchSkus: ["10"], matchTitles: ["tandstensskrapa"], unitLabel: "st", sortOrder: 90 },
];

/** Digital or service lines that never touch the shelf. */
const IGNORE_TITLES = ["svenska guiden", "leverans skydd", "e-bok", "tandvårdsguiden"];

export type MatchableProduct = {
  id: string;
  code: string;
  name: string;
  matchSkus: string[];
  matchTitles: string[];
};

/**
 * Resolve one Shopify line item to a product id, or null when it is digital,
 * a shipping add-on, or something we do not stock.
 */
export function matchLineItem(
  line: { title?: string | null; sku?: string | null },
  products: MatchableProduct[]
): string | null {
  const title = (line.title ?? "").toLowerCase().trim();
  if (!title) return null;
  if (IGNORE_TITLES.some((t) => title.includes(t))) return null;

  const sku = (line.sku ?? "").trim();
  if (sku) {
    // A sku is only trusted when the title does not contradict it: sku "2" appears on
    // both MUNHÄLSA+ and a stray Probiotika listing.
    const bySku = products.filter((p) => p.matchSkus.includes(sku));
    if (bySku.length === 1) {
      const p = bySku[0];
      const titleFits = p.matchTitles.some((t) => title.includes(t.toLowerCase()));
      const claimedByOther = products.some(
        (o) => o.id !== p.id && o.matchTitles.some((t) => title.includes(t.toLowerCase()))
      );
      if (titleFits || !claimedByOther) return p.id;
    }
  }

  for (const p of products) {
    if (p.matchTitles.some((t) => title.includes(t.toLowerCase()))) return p.id;
  }
  return null;
}

/** Create the default catalogue once, so the page is never empty on first visit. */
export async function ensureCatalog(): Promise<MatchableProduct[]> {
  const existing = await db.select().from(schema.inventoryProducts);
  if (existing.length === 0) {
    await db.insert(schema.inventoryProducts).values(
      DEFAULT_CATALOG.map((c) => ({
        name: c.name,
        code: c.code,
        matchSkus: c.matchSkus,
        matchTitles: c.matchTitles,
        unitLabel: c.unitLabel,
        sortOrder: c.sortOrder,
      }))
    );
    const seeded = await db.select().from(schema.inventoryProducts);
    return seeded.map(toMatchable);
  }
  return existing.map(toMatchable);
}

function toMatchable(p: typeof schema.inventoryProducts.$inferSelect): MatchableProduct {
  return { id: p.id, code: p.code, name: p.name, matchSkus: p.matchSkus ?? [], matchTitles: p.matchTitles ?? [] };
}
