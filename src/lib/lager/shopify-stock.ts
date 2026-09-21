import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { buildForecast } from "./forecast";

const API_VERSION = "2024-01";

/**
 * Two-way link between the Lager tab and Shopify's inventory.
 *
 * MetaAdsUpload is the master: you count and order here, and the resulting stock is
 * pushed to Shopify. `pullStock` exists to reconcile — it reads what Shopify believes
 * and records it as a count, which is useful right after the scopes are granted.
 *
 * Needs three scopes the app does not have yet (each returns 403 until a merchant
 * approves them on the custom app): read_products, read_locations,
 * read_inventory and write_inventory.
 */

export type ScopeState = { scopes: string[]; canRead: boolean; canWrite: boolean; missing: string[] };

const REQUIRED = ["read_products", "read_locations", "read_inventory", "write_inventory"];

/** Vercel env values can carry invisible trailing characters — always trim. */
const env = (key: string) => (process.env[key] ?? "").trim();

function getStore(): string {
  const store = env("SHOPIFY_STORE");
  if (!store) throw new Error("SHOPIFY_STORE saknas");
  return store;
}

async function tokenAndScopes(): Promise<{ token: string; scopes: string[] }> {
  const permanent = env("SHOPIFY_ACCESS_TOKEN");
  if (permanent) return { token: permanent, scopes: [] };
  const clientId = env("SHOPIFY_CLIENT_ID");
  const clientSecret = env("SHOPIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("SHOPIFY_CLIENT_ID/SECRET saknas i miljön");
  const res = await fetch(`https://${getStore()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(
      `Shopify nekade inloggningen (${res.status}): ${detail}. ` +
      `Kontrollera SHOPIFY_CLIENT_ID/SECRET för butiken ${getStore()} i Vercel.`
    );
  }
  const j = await res.json();
  return { token: j.access_token as string, scopes: String(j.scope ?? "").split(",").filter(Boolean) };
}

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://${getStore()}/admin/api/${API_VERSION}${path}`, {
    ...init,
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Shopify ${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function checkScopes(): Promise<ScopeState> {
  const { scopes } = await tokenAndScopes();
  // Shopify collapses read_x into write_x when both are requested, so a granted
  // write_inventory also covers reading stock.
  const has = (scope: string) =>
    scopes.includes(scope) || scopes.includes(scope.replace(/^read_/, "write_"));
  const missing = REQUIRED.filter((s) => !has(s));
  return {
    scopes,
    canRead: ["read_products", "read_locations", "read_inventory"].every(has),
    canWrite: has("write_inventory"),
    missing,
  };
}

export type VariantCandidate = {
  productTitle: string;
  variantTitle: string | null;
  sku: string | null;
  variantId: string;
  inventoryItemId: string;
  tracked: boolean;
  available: number | null;
  status: string;
};

/**
 * List every variant in the store with its stock, so each Lager product can be
 * pointed at the one variant that actually carries inventory.
 */
export async function listVariants(): Promise<{ locationId: string | null; locationName: string | null; variants: VariantCandidate[] }> {
  const { token } = await tokenAndScopes();
  const locs = await api<{ locations: { id: number; active: boolean; name: string }[] }>("/locations.json", token);

  const variants: VariantCandidate[] = [];
  const body = await api<{ products: { title: string; status: string; variants: { id: number; title: string | null; sku: string | null; inventory_item_id: number; inventory_management: string | null }[] }[] }>(
    "/products.json?limit=250&fields=id,title,status,variants",
    token
  );
  for (const p of body.products ?? []) {
    for (const v of p.variants ?? []) {
      variants.push({
        productTitle: p.title,
        variantTitle: v.title === "Default Title" ? null : v.title,
        sku: v.sku,
        variantId: String(v.id),
        inventoryItemId: String(v.inventory_item_id),
        tracked: v.inventory_management === "shopify",
        available: null,
        status: p.status,
      });
    }
  }

  // A store can have several locations; only one of them actually holds the goods.
  // Pick the one that reports the most stock lines rather than the first active one.
  const tracked = variants.filter((v) => v.tracked);
  let best: { id: number; name: string; levels: Map<string, number> } | null = null;
  for (const loc of locs.locations ?? []) {
    const levels = new Map<string, number>();
    for (let i = 0; i < tracked.length; i += 50) {
      const chunk = tracked.slice(i, i + 50).map((v) => v.inventoryItemId).join(",");
      if (!chunk) break;
      const r = await api<{ inventory_levels: { inventory_item_id: number; available: number }[] }>(
        `/inventory_levels.json?location_ids=${loc.id}&inventory_item_ids=${chunk}&limit=250`,
        token
      );
      for (const lvl of r.inventory_levels ?? []) levels.set(String(lvl.inventory_item_id), lvl.available);
    }
    if (!best || levels.size > best.levels.size) best = { id: loc.id, name: loc.name, levels };
  }

  if (best) for (const v of variants) v.available = best.levels.get(v.inventoryItemId) ?? null;

  return { locationId: best ? String(best.id) : null, locationName: best?.name ?? null, variants };
}

/** Write the computed stock for one product to its linked Shopify variant. */
export async function pushStock(productId: string, who: string | null): Promise<{ ok: boolean; units?: number; message?: string }> {
  const [product] = await db.select().from(schema.inventoryProducts).where(eq(schema.inventoryProducts.id, productId)).limit(1);
  if (!product) return { ok: false, message: "Produkten finns inte" };
  if (!product.shopifyInventoryItemId || !product.shopifyLocationId) {
    return { ok: false, message: "Produkten är inte kopplad till någon Shopify-variant" };
  }

  const forecast = await buildForecast();
  const row = forecast.products.find((p) => p.id === productId);
  if (!row || row.stock === null) return { ok: false, message: "Saknar räknat saldo — kan inte pusha" };
  const units = Math.max(0, Math.round(row.stock));

  try {
    const { token } = await tokenAndScopes();
    await api("/inventory_levels/set.json", token, {
      method: "POST",
      body: JSON.stringify({
        location_id: Number(product.shopifyLocationId),
        inventory_item_id: Number(product.shopifyInventoryItemId),
        available: units,
      }),
    });
    await db
      .update(schema.inventoryProducts)
      .set({ shopifySyncedAt: new Date(), shopifyLastPushedUnits: units, updatedAt: new Date() })
      .where(eq(schema.inventoryProducts.id, productId));
    await db.insert(schema.inventoryShopifyLog).values({
      productId, direction: "push", units, previousUnits: product.shopifyLastPushedUnits ?? null, ok: true, createdByName: who,
    });
    return { ok: true, units };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel";
    await db.insert(schema.inventoryShopifyLog).values({ productId, direction: "push", units, ok: false, message, createdByName: who });
    return { ok: false, message };
  }
}

/**
 * Read Shopify's stock and record it as a count.
 *
 * A product usually has several listings selling against the same shelf — the store
 * has seven Probiotika variants, where the main one is positive and the duplicates
 * have drifted negative. The count is the SUM across all of them, so a minus on a
 * duplicate is deducted from the listing that carries the stock.
 */
export async function pullStock(who: string | null): Promise<{ pulled: number; skipped: number; message?: string; detail?: string[] }> {
  const products = await db.select().from(schema.inventoryProducts);
  const linked = products.filter((p) => p.shopifyInventoryItemId && p.shopifyLocationId);
  if (!linked.length) return { pulled: 0, skipped: products.length, message: "Inga produkter är kopplade ännu" };

  const { variants } = await listVariants();
  const today = new Date().toISOString().slice(0, 10);
  const detail: string[] = [];
  let pulled = 0;

  for (const p of linked) {
    try {
      const skus = (p.matchSkus ?? []).map((x) => x.trim()).filter(Boolean);
      const titles = (p.matchTitles ?? []).map((x) => x.toLowerCase());
      const mine = variants.filter((v) => {
        if (!v.tracked || v.available === null) return false;
        const title = v.productTitle.toLowerCase();
        if (titles.some((t) => title.includes(t))) return true;
        return !!v.sku && skus.includes(v.sku.trim()) && !titles.length;
      });
      if (!mine.length) continue;

      const units = mine.reduce((n, v) => n + (v.available ?? 0), 0);
      const parts = mine.map((v) => `${v.productTitle.slice(0, 28)}: ${v.available}`).join(" · ");
      await db.insert(schema.inventoryCounts).values({
        productId: p.id, countedOn: today, units, source: "shopify",
        note: `Summerat från ${mine.length} Shopify-listningar — ${parts}`.slice(0, 500),
        createdByName: who,
      });
      await db.insert(schema.inventoryShopifyLog).values({ productId: p.id, direction: "pull", units, ok: true, message: parts.slice(0, 500), createdByName: who });
      detail.push(`${p.code}: ${units} st från ${mine.length} listningar`);
      pulled++;
    } catch (error) {
      await db.insert(schema.inventoryShopifyLog).values({
        productId: p.id, direction: "pull", ok: false,
        message: error instanceof Error ? error.message : "Okänt fel", createdByName: who,
      });
    }
  }
  return { pulled, skipped: products.length - linked.length, detail };
}
