import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";
import { metaApi, withAdAccount } from "@/lib/meta/client";
import { hookLabelFromName } from "@/lib/learning-loop/derive";

export const dynamic = "force-dynamic";

/**
 * The creative itself, per hook — so a learning is written while WATCHING the
 * ad, not from the name. One variant per hook label (H1, H2 …), the biggest
 * spender of each. Media comes from the app's own library (permanent R2 url)
 * when the file was uploaded through the app, otherwise from Meta's video /
 * image endpoints (CDN urls that expire, so they are fetched on demand and
 * cached briefly per server instance).
 */

export interface MediaVariant {
  hookLabel: string | null;
  adId: string;
  adName: string;
  adsetId: string;
  status: string | null;
  spend: number;
  kind: "video" | "image" | null;
  url: string | null;
  poster: string | null;
  /** Meta's official ad-preview iframe (renders unpublished ad videos playable). */
  embed: { src: string; width: number; height: number } | null;
  source: "library" | "meta" | "preview" | null;
  highlighted: boolean;
}

const cache = new Map<string, { url: string | null; poster: string | null; at: number }>();
const previewCache = new Map<string, { embed: MediaVariant["embed"]; at: number }>();
const TTL = 4 * 3600 * 1000;

/**
 * Meta does not hand out a playable `source` for ad-account videos, but the
 * Ad Preview API returns an iframe that plays the ad exactly as served —
 * without a Facebook login. Token in the url expires, hence the short cache.
 */
async function metaPreview(adId: string): Promise<MediaVariant["embed"]> {
  const hit = previewCache.get(adId);
  if (hit && Date.now() - hit.at < TTL) return hit.embed;
  let embed: MediaVariant["embed"] = null;
  try {
    const r = await metaApi<{ data?: Array<{ body: string }> }>(`/${adId}/previews`, { params: { ad_format: "MOBILE_FEED_STANDARD" } });
    const body = r.data?.[0]?.body ?? "";
    const src = body.match(/src="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;
    if (src) {
      embed = {
        src,
        width: parseInt(body.match(/width="(\d+)"/)?.[1] ?? "320", 10) || 320,
        height: parseInt(body.match(/height="(\d+)"/)?.[1] ?? "640", 10) || 640,
      };
    }
  } catch (e) {
    console.warn(`media: preview ${adId} unavailable:`, e instanceof Error ? e.message : e);
  }
  previewCache.set(adId, { embed, at: Date.now() });
  return embed;
}

async function metaVideo(videoId: string): Promise<{ url: string | null; poster: string | null }> {
  const hit = cache.get(`v:${videoId}`);
  if (hit && Date.now() - hit.at < TTL) return hit;
  let out = { url: null as string | null, poster: null as string | null };
  try {
    const v = await metaApi<{ source?: string; picture?: string }>(`/${videoId}`, { params: { fields: "source,picture" } });
    out = { url: v.source ?? null, poster: v.picture ?? null };
  } catch (e) {
    console.warn(`media: video ${videoId} unavailable:`, e instanceof Error ? e.message : e);
  }
  cache.set(`v:${videoId}`, { ...out, at: Date.now() });
  return out;
}

async function metaImages(adAccountId: string, hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const missing = hashes.filter((h) => {
    const hit = cache.get(`i:${h}`);
    if (hit && Date.now() - hit.at < TTL) { if (hit.url) out.set(h, hit.url); return false; }
    return true;
  });
  if (missing.length) {
    try {
      const r = await metaApi<{ data?: Array<{ hash: string; url?: string; permalink_url?: string }> }>(`/${adAccountId}/adimages`, {
        params: { hashes: JSON.stringify(missing), fields: "hash,url,permalink_url" },
      });
      for (const img of r.data ?? []) {
        const url = img.url ?? img.permalink_url ?? null;
        cache.set(`i:${img.hash}`, { url, poster: null, at: Date.now() });
        if (url) out.set(img.hash, url);
      }
    } catch (e) {
      console.warn("media: adimages unavailable:", e instanceof Error ? e.message : e);
    }
  }
  return out;
}

/** GET ?adsetId=…  or  ?adIds=a,b  (+ &highlight=a,b) */
export async function GET(request: NextRequest) {
  const { error } = await guardAdmin();
  if (error) return error;
  const sp = request.nextUrl.searchParams;
  const adsetId = sp.get("adsetId");
  const adIds = (sp.get("adIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const highlight = new Set((sp.get("highlight") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  if (!adsetId && !adIds.length) return NextResponse.json({ error: "adsetId eller adIds krävs" }, { status: 400 });

  try {
    const ads = await db
      .select({ id: schema.adsCache.id, name: schema.adsCache.name, status: schema.adsCache.status, adsetId: schema.adsCache.adsetId, adAccountId: schema.adsCache.adAccountId, videoId: schema.adsCache.videoId, imageHash: schema.adsCache.imageHash })
      .from(schema.adsCache)
      .where(adsetId && adIds.length ? or(eq(schema.adsCache.adsetId, adsetId), inArray(schema.adsCache.id, adIds)) : adsetId ? eq(schema.adsCache.adsetId, adsetId) : inArray(schema.adsCache.id, adIds));
    if (!ads.length) return NextResponse.json({ variants: [] });

    // Lifetime spend per ad, to pick the biggest hook.
    const spendRows = await db
      .select({ adId: schema.insights.entityId, spend: sql<number>`coalesce(sum(${schema.insights.spend}), 0)` })
      .from(schema.insights)
      .where(and(eq(schema.insights.entityType, "ad"), inArray(schema.insights.entityId, ads.map((a) => a.id))))
      .groupBy(schema.insights.entityId);
    const spendOf = new Map(spendRows.map((r) => [r.adId, Number(r.spend) || 0]));

    // Library first: permanent urls for anything uploaded through the app.
    const videoIds = [...new Set(ads.map((a) => a.videoId).filter((v): v is string => !!v))];
    const hashes = [...new Set(ads.map((a) => a.imageHash).filter((v): v is string => !!v))];
    const lib = (videoIds.length || hashes.length)
      ? await db
          .select({ metaVideoId: schema.creatives.metaVideoId, metaImageHash: schema.creatives.metaImageHash, r2Url: schema.creatives.r2Url, thumbnailUrl: schema.creatives.thumbnailUrl, type: schema.creatives.type })
          .from(schema.creatives)
          .where(or(videoIds.length ? inArray(schema.creatives.metaVideoId, videoIds) : sql`false`, hashes.length ? inArray(schema.creatives.metaImageHash, hashes) : sql`false`))
      : [];
    const libVideo = new Map(lib.filter((l) => l.metaVideoId && l.r2Url).map((l) => [l.metaVideoId!, l]));
    const libImage = new Map(lib.filter((l) => l.metaImageHash && l.r2Url).map((l) => [l.metaImageHash!, l]));

    // One variant per hook label: the biggest spender. Highlighted ads always keep their own slot.
    const byHook = new Map<string, (typeof ads)[number]>();
    for (const ad of ads.slice().sort((a, b) => (spendOf.get(b.id) ?? 0) - (spendOf.get(a.id) ?? 0))) {
      const key = hookLabelFromName(ad.name) ?? "—";
      const cur = byHook.get(key);
      if (!cur || (highlight.has(ad.id) && !highlight.has(cur.id))) byHook.set(key, ad);
    }
    const chosen = [...byHook.values()];

    // Meta fallback, per account.
    const acct = ads.find((a) => a.adAccountId)?.adAccountId ?? null;
    const needVideo = chosen.filter((a) => a.videoId && !libVideo.has(a.videoId)).map((a) => a.videoId!);
    const needImage = chosen.filter((a) => a.imageHash && !libImage.has(a.imageHash)).map((a) => a.imageHash!);
    const metaVideos = new Map<string, { url: string | null; poster: string | null }>();
    const previews = new Map<string, MediaVariant["embed"]>();
    let metaImgs = new Map<string, string>();
    if (needVideo.length || needImage.length) {
      await withAdAccount(acct, async () => {
        for (const v of needVideo) metaVideos.set(v, await metaVideo(v));
        // Videos with no direct source → the ad-preview iframe (fetched in parallel).
        const needPreview = chosen.filter((a) => a.videoId && !libVideo.has(a.videoId) && !metaVideos.get(a.videoId!)?.url);
        await Promise.all(needPreview.map(async (a) => previews.set(a.id, await metaPreview(a.id))));
        if (needImage.length && acct) metaImgs = await metaImages(acct, needImage);
      });
    }

    const variants: MediaVariant[] = chosen.map((ad) => {
      let kind: MediaVariant["kind"] = null, url: string | null = null, poster: string | null = null, source: MediaVariant["source"] = null, embed: MediaVariant["embed"] = null;
      if (ad.videoId) {
        kind = "video";
        const l = libVideo.get(ad.videoId);
        if (l) { url = l.r2Url; poster = l.thumbnailUrl; source = "library"; }
        else {
          const m = metaVideos.get(ad.videoId);
          url = m?.url ?? null; poster = m?.poster ?? null; source = url ? "meta" : null;
          if (!url) { embed = previews.get(ad.id) ?? null; if (embed) source = "preview"; }
        }
      } else if (ad.imageHash) {
        kind = "image";
        const l = libImage.get(ad.imageHash);
        if (l) { url = l.r2Url; source = "library"; }
        else { url = metaImgs.get(ad.imageHash) ?? null; source = url ? "meta" : null; }
      }
      return {
        hookLabel: hookLabelFromName(ad.name),
        adId: ad.id,
        adName: ad.name,
        adsetId: ad.adsetId,
        status: ad.status,
        spend: spendOf.get(ad.id) ?? 0,
        kind, url, poster, embed, source,
        highlighted: highlight.has(ad.id),
      };
    });
    variants.sort((a, b) => {
      const ha = a.hookLabel ? parseInt(a.hookLabel.slice(1), 10) : 999;
      const hb = b.hookLabel ? parseInt(b.hookLabel.slice(1), 10) : 999;
      return ha - hb || b.spend - a.spend;
    });
    return NextResponse.json({ variants, adAccountId: acct });
  } catch (e) {
    console.error("learning-loop media failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte hämta media" }, { status: 500 });
  }
}
