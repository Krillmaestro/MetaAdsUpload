import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getAdAccountId } from "@/lib/meta/client";
import { listDeliverableFiles, APPROVED } from "@/lib/deliverables";

// GET /api/assignments/:id/publish-defaults — everything the Upload-to-Meta
// dialog needs prefilled: the campaign this product+country last went into
// (or a guess by name), the copy template, landing page, budget, and the
// approved files that will become ads.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (session.user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;

    const [assignment] = await db.select().from(schema.assignments).where(eq(schema.assignments.id, id));
    if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });

    const [product] = assignment.productId ? await db.select().from(schema.products).where(eq(schema.products.id, assignment.productId)) : [];
    const [country] = assignment.countryId ? await db.select().from(schema.countries).where(eq(schema.countries.id, assignment.countryId)) : [];

    const words = (str: string) => str.toLowerCase().split(/[^a-z0-9åäö]+/).filter(Boolean);
    const [defaults] = await db
      .select()
      .from(schema.publishDefaults)
      .where(and(
        assignment.productId ? eq(schema.publishDefaults.productId, assignment.productId) : isNull(schema.publishDefaults.productId),
        assignment.countryId ? eq(schema.publishDefaults.countryId, assignment.countryId) : isNull(schema.publishDefaults.countryId),
      ));

    // Campaigns of the active ad account, newest first. Containers are never suggested.
    let accountId: string | null = null;
    try { accountId = await getAdAccountId(); } catch { /* no connection: show everything cached */ }
    const act = accountId ? (accountId.startsWith("act_") ? accountId : `act_${accountId}`) : null;
    const campaigns = (await db
      .select({ id: schema.campaignsCache.id, name: schema.campaignsCache.name, status: schema.campaignsCache.status, dailyBudget: schema.campaignsCache.dailyBudget, lifetimeBudget: schema.campaignsCache.lifetimeBudget, adAccountId: schema.campaignsCache.adAccountId, createdTime: schema.campaignsCache.createdTime })
      .from(schema.campaignsCache)
      .where(inArray(schema.campaignsCache.status, ["ACTIVE", "PAUSED"]))
      .orderBy(desc(schema.campaignsCache.createdTime)))
      .filter((c) => !act || !c.adAccountId || c.adAccountId === act)
      .map((c) => ({ id: c.id, name: c.name, status: c.status, isCbo: !!(c.dailyBudget || c.lifetimeBudget), dailyBudget: c.dailyBudget }));

    // Guess the product's ABO test campaign by name. "Munhälsa // ABO" must
    // beat "KattMunhälsa // ABO" for the dog product, so a whole-word match
    // counts more than a substring; containers never qualify.
    const container = /scaling|winners|postid|post id|bof|graveyard|zombie|retarget|costcap|sale/i;
    const needles = [product?.name, product?.code].filter((s): s is string => !!s).map((s) => s.toLowerCase());
    const score = (name: string, status: string) => {
      const n = name.toLowerCase();
      if (container.test(n)) return -1;
      const tokens = words(n);
      let s = 0;
      for (const w of needles) {
        if (tokens.includes(w)) s += 4;
        else if (n.includes(w)) s += 1;
      }
      if (country?.code && tokens.includes(country.code.toLowerCase())) s += 1;
      if (tokens.includes("abo")) s += 2;
      else if (tokens.includes("test") || tokens.includes("testing")) s += 1;
      if (status === "ACTIVE") s += 1;
      return s;
    };
    const remembered = defaults?.campaignId ? campaigns.find((c) => c.id === defaults.campaignId) : undefined;
    const best = [...campaigns].sort((a, b) => score(b.name, b.status) - score(a.name, a.status))[0];
    const suggestedCampaign = remembered ?? (best && score(best.name, best.status) >= 4 ? best : null);

    const templates = await db
      .select({ id: schema.templates.id, name: schema.templates.name, landingPages: schema.templates.landingPages, dailyBudget: schema.templates.dailyBudget, currency: schema.templates.currency })
      .from(schema.templates)
      .orderBy(desc(schema.templates.id));
    // Brief's template > last used for this product+country > a template named
    // after the product > nothing (the admin picks; never another product's copy).
    const byProduct = product ? templates.find((t) => words(t.name).includes(product.name.toLowerCase()) || words(t.name).includes(product.code.toLowerCase())) : undefined;
    const templateId = assignment.publishTemplateId ?? defaults?.templateId ?? byProduct?.id ?? null;
    const template = templates.find((t) => t.id === templateId) ?? null;

    const files = (await listDeliverableFiles(id)).map((f) => ({
      id: f.id, hookLabel: f.hookLabel, filename: f.filename, r2Url: f.r2Url, r2Key: f.r2Key, reviewStatus: f.reviewStatus, versionNumber: f.versionNumber, metaAdId: f.metaAdId,
      type: /\.(jpg|jpeg|png|webp)$/i.test(f.filename) ? "image" : "video",
    }));

    return NextResponse.json({
      product: product ? { id: product.id, name: product.name, code: product.code } : null,
      country: country ? { id: country.id, name: country.name, code: country.code } : null,
      campaigns,
      suggestedCampaignId: suggestedCampaign?.id ?? null,
      templates,
      templateId,
      landingPage: assignment.landingPage || defaults?.landingPage || template?.landingPages?.[0] || "",
      dailyBudget: defaults?.dailyBudget ?? template?.dailyBudget ?? 500,
      adsetName: assignment.autoName || assignment.title,
      files,
      readyFiles: files.filter((f) => f.reviewStatus === APPROVED && !f.metaAdId),
      lastUsed: defaults ? { campaignName: defaults.campaignName, updatedAt: defaults.updatedAt } : null,
    });
  } catch (error) {
    console.error("publish-defaults error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
