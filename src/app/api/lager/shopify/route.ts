import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isElevated } from "@/lib/access";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { checkScopes, listVariants, pushStock, pullStock } from "@/lib/lager/shopify-stock";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Scope status, plus the variant list once the scopes allow reading it. */
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const scopes = await checkScopes();
    const wantVariants = new URL(request.url).searchParams.get("variants") === "1";
    if (!wantVariants || !scopes.canRead) return NextResponse.json({ scopes });

    const variants = await listVariants();
    return NextResponse.json({ scopes, ...variants });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Kunde inte läsa Shopify" }, { status: 500 });
  }
}

/** action: "map" | "push" | "pull" */
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const who = session.user.name ?? session.user.email ?? null;

    const body = await request.json();
    const action = body?.action as string;

    if (action === "map") {
      const { productId, variantId, inventoryItemId, locationId } = body;
      if (!productId) return NextResponse.json({ error: "Saknar produkt" }, { status: 400 });
      await db
        .update(schema.inventoryProducts)
        .set({
          shopifyVariantId: variantId || null,
          shopifyInventoryItemId: inventoryItemId || null,
          shopifyLocationId: locationId || null,
          updatedAt: new Date(),
        })
        .where(eq(schema.inventoryProducts.id, productId));
      await db.insert(schema.inventoryShopifyLog).values({
        productId, direction: "map", ok: true,
        message: variantId ? `Kopplad till variant ${variantId}` : "Koppling borttagen",
        createdByName: who,
      });
      return NextResponse.json({ saved: true });
    }

    if (action === "push") {
      const scopes = await checkScopes();
      if (!scopes.canWrite) {
        return NextResponse.json(
          { error: `Shopify saknar scopes: ${scopes.missing.join(", ")}. Lägg till dem på appen i Shopify-admin först.` },
          { status: 400 }
        );
      }
      if (body.productId) {
        const result = await pushStock(body.productId, who);
        return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.message }, { status: 400 });
      }
      const products = await db.select().from(schema.inventoryProducts);
      const results = [];
      for (const p of products.filter((x) => x.shopifyInventoryItemId && x.isActive)) {
        results.push({ code: p.code, ...(await pushStock(p.id, who)) });
      }
      return NextResponse.json({ pushed: results.filter((r) => r.ok).length, results });
    }

    if (action === "pull") {
      const scopes = await checkScopes();
      if (!scopes.canRead) {
        return NextResponse.json(
          { error: `Shopify saknar scopes: ${scopes.missing.join(", ")}.` },
          { status: 400 }
        );
      }
      return NextResponse.json(await pullStock(who));
    }

    return NextResponse.json({ error: `Okänd action: ${action}` }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Shopify-anropet misslyckades" }, { status: 500 });
  }
}
