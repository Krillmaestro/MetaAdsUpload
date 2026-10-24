import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db, schema } from "@/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getAdAccountId, getPageId, withAdAccount } from "@/lib/meta/client";
import { getCampaigns, upsertCampaignsCache } from "@/lib/meta/campaigns";
import { listDeliverableFiles, APPROVED } from "@/lib/deliverables";
import { isElevated } from "@/lib/access";

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
    if (!isElevated(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    const templates = await db
      .select({ id: schema.templates.id, name: schema.templates.name, landingPages: schema.templates.landingPages, dailyBudget: schema.templates.dailyBudget, currency: schema.templates.currency, adAccountId: schema.templates.adAccountId, pageId: schema.templates.pageId })
      .from(schema.templates)
      .orderBy(desc(schema.templates.id));
    // Brief's template > last used for this product+country > a template named
    // after the product > nothing (the admin picks; never another product's copy).
    const byProduct = product ? templates.find((t) => words(t.name).includes(product.name.toLowerCase()) || words(t.name).includes(product.code.toLowerCase())) : undefined;
    const templateId = assignment.publishTemplateId ?? defaults?.templateId ?? byProduct?.id ?? null;
    const template = templates.find((t) => t.id === templateId) ?? null;

    // Campaigns of the account the template publishes to (else the active
    // account in Settings), newest first. Containers are never suggested.
    const formatAct = (a: string | null | undefined) => (a ? (a.startsWith("act_") ? a : `act_${a}`) : null);
    let accountId: string | null = null;
    try { accountId = await getAdAccountId(); } catch { /* no connection: show everything cached */ }
    const act = formatAct(template?.adAccountId) ?? formatAct(accountId);
    let settingsPageId: string | null = null;
    try { settingsPageId = await getPageId(); } catch { /* no page in Settings */ }
    const pageId = template?.pageId || settingsPageId;
    const pageSource: "template" | "settings" | null = template?.pageId ? "template" : settingsPageId ? "settings" : null;
    // Live from Meta for that account (and refresh the cache on the way), so a
    // campaign created an hour ago is in the list. The cache is only the
    // fallback when Meta cannot be reached — then say so in the dialog.
    type DialogCampaign = { id: string; name: string; status: string; isCbo: boolean; dailyBudget: number | null; createdTime: Date | null };
    let campaigns: DialogCampaign[] = [];
    let campaignsSource: "live" | "cache" = "cache";
    let campaignsWarning: string | null = null;
    if (act) {
      try {
        const live = await withAdAccount(act, () => getCampaigns());
        campaigns = live
          .filter((c) => c.status === "ACTIVE" || c.status === "PAUSED")
          .map((c) => ({ id: c.id, name: c.name, status: c.status, isCbo: !!(c.daily_budget || c.lifetime_budget), dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null, createdTime: c.created_time ? new Date(c.created_time) : null }));
        campaignsSource = "live";
        try { await upsertCampaignsCache(act, live); } catch (e) { console.error("campaigns_cache refresh failed:", e); }
      } catch (e) {
        campaignsWarning = `Could not list campaigns from Meta (${e instanceof Error ? e.message : String(e)}) – showing the cached list`;
      }
    } else {
      campaignsWarning = "No Meta connection – showing the cached list";
    }
    if (campaignsSource === "cache") {
      campaigns = (await db
        .select({ id: schema.campaignsCache.id, name: schema.campaignsCache.name, status: schema.campaignsCache.status, dailyBudget: schema.campaignsCache.dailyBudget, lifetimeBudget: schema.campaignsCache.lifetimeBudget, adAccountId: schema.campaignsCache.adAccountId, createdTime: schema.campaignsCache.createdTime })
        .from(schema.campaignsCache)
        .where(inArray(schema.campaignsCache.status, ["ACTIVE", "PAUSED"])))
        // rows without an account are legacy (written before the column existed): only usable when no account is known
        .filter((c) => (act ? c.adAccountId === act : true))
        .map((c) => ({ id: c.id, name: c.name, status: c.status, isCbo: !!(c.dailyBudget || c.lifetimeBudget), dailyBudget: c.dailyBudget, createdTime: c.createdTime }));
    }
    // Active first, then newest — the test campaign you want is almost always near the top.
    campaigns.sort((a, b) => (a.status === b.status ? (b.createdTime?.getTime() ?? 0) - (a.createdTime?.getTime() ?? 0) : a.status === "ACTIVE" ? -1 : 1));

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
        const parts = words(w);
        if (parts.length && parts.every((p) => tokens.includes(p))) s += 4;
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

    const files = (await listDeliverableFiles(id)).map((f) => ({
      id: f.id, hookLabel: f.hookLabel, filename: f.filename, r2Url: f.r2Url, r2Key: f.r2Key, reviewStatus: f.reviewStatus, versionNumber: f.versionNumber, metaAdId: f.metaAdId,
      type: /\.(jpg|jpeg|png|webp)$/i.test(f.filename) ? "image" : "video",
    }));

    return NextResponse.json({
      product: product ? { id: product.id, name: product.name, code: product.code } : null,
      country: country ? { id: country.id, name: country.name, code: country.code } : null,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, isCbo: c.isCbo, dailyBudget: c.dailyBudget })),
      campaignsSource,
      campaignsWarning,
      suggestedCampaignId: suggestedCampaign?.id ?? null,
      adAccountId: act,
      pageId,
      pageSource,
      templates,
      templateId,
      landingPage: assignment.landingPage || defaults?.landingPage || template?.landingPages?.[0] || "",
      // Several landers = ads multiply (creatives × landers). The brief's
      // template carries them; otherwise the assignment's single page.
      landingPages: template?.landingPages?.length ? template.landingPages : [assignment.landingPage || defaults?.landingPage || ""].filter(Boolean),
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
