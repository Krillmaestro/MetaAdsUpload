import { NextRequest, NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { guardAdmin } from "@/lib/auth-helpers";
import { metaApi, withAdAccount } from "@/lib/meta/client";
import { hookLabelFromName, looseMediaKey } from "@/lib/learning-loop/derive";

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
  /** The original file in the library, even when it is too big to stream. */
  masterUrl: string | null;
}

const cache = new Map<string, { url: string | null; poster: string | null; at: number }>();
const previewCache = new Map<string, { embed: MediaVariant["embed"]; at: number }>();
const TTL = 4 * 3600 * 1000;

/**
 * Meta does not hand out a playable `source` for ad-account videos, but the
 * Ad Preview API returns an iframe that plays the ad exactly as served —
 * without a Facebook login. Token in the url expires, hence the short cache.
 */
export const PREVIEW_FORMATS = ["INSTAGRAM_STORY", "INSTAGRAM_REELS", "MOBILE_FEED_STANDARD"] as const;
export type PreviewFormat = (typeof PREVIEW_FORMATS)[number];

async function metaPreview(adId: string, format: PreviewFormat): Promise<MediaVariant["embed"]> {
  const key = `${adId}|${format}`;
  const hit = previewCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.embed;
  let embed: MediaVariant["embed"] = null;
  try {
    // INSTAGRAM_STORY renders the whole 9:16 frame (subtitles included) but
    // autoplays muted; the feed format has a play button (sound on click) but
    // crops to 4:5. The client lets the user pick.
    let body = "";
    for (const fmt of [format, "INSTAGRAM_STORY", "MOBILE_FEED_STANDARD"]) {
      const r = await metaApi<{ data?: Array<{ body: string }> }>(`/${adId}/previews`, { params: { ad_format: fmt } });
      body = r.data?.[0]?.body ?? "";
      if (body) break;
    }
    const src = body.match(/src="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? null;
    if (src) {
      embed = {
        src,
        width: parseInt(body.match(/width="(\d+)"/)?.[1] ?? "320", 10) || 320,
        height: parseInt(body.match(/height="(\d+)"/)?.[1] ?? "567", 10) || 567,
      };
    }
  } catch (e) {
    console.warn(`media: preview ${adId} unavailable:`, e instanceof Error ? e.message : e);
  }
  previewCache.set(key, { embed, at: Date.now() });
  return embed;
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
  const format = (PREVIEW_FORMATS as readonly string[]).includes(sp.get("format") ?? "") ? (sp.get("format") as PreviewFormat) : "INSTAGRAM_STORY";
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
          .select({ metaVideoId: schema.creatives.metaVideoId, metaImageHash: schema.creatives.metaImageHash, r2Url: schema.creatives.r2Url, thumbnailUrl: schema.creatives.thumbnailUrl, type: schema.creatives.type, fileSize: schema.creatives.fileSize, previewUrl: schema.creatives.previewUrl })
          .from(schema.creatives)
          .where(or(videoIds.length ? inArray(schema.creatives.metaVideoId, videoIds) : sql`false`, hashes.length ? inArray(schema.creatives.metaImageHash, hashes) : sql`false`))
      : [];
    // The library has duplicate rows for the same master (re-uploads); when
    // several rows share a video, the one with a transcoded preview wins.
    const preferPreview = <T extends { previewUrl: string | null }>(a: T, b: T) => (b.previewUrl ? 1 : 0) - (a.previewUrl ? 1 : 0);
    const libVideo = new Map<string, (typeof lib)[number]>();
    for (const l of [...lib].sort(preferPreview)) if (l.metaVideoId && l.r2Url && !libVideo.has(l.metaVideoId)) libVideo.set(l.metaVideoId, l);
    const libImage = new Map(lib.filter((l) => l.metaImageHash && l.r2Url).map((l) => [l.metaImageHash!, l]));

    // Second chance for videos: most batches were launched by script, so the
    // library row exists (uploader) but never got its meta video id. Match the
    // file by hook + editor + batch + format and heal the link while at it.
    const unlinkedVideoAds = ads.filter((a) => a.videoId && !libVideo.has(a.videoId));
    if (unlinkedVideoAds.length) {
      const wantKeys = new Map<string, (typeof ads)[number][]>();
      for (const a of unlinkedVideoAds) { const k = looseMediaKey(a.name); if (k) wantKeys.set(k, [...(wantKeys.get(k) ?? []), a]); }
      if (wantKeys.size) {
        const candidates = await db
          .select({ id: schema.creatives.id, name: schema.creatives.name, metaVideoId: schema.creatives.metaVideoId, r2Url: schema.creatives.r2Url, thumbnailUrl: schema.creatives.thumbnailUrl, fileSize: schema.creatives.fileSize, previewUrl: schema.creatives.previewUrl })
          .from(schema.creatives)
          .where(and(eq(schema.creatives.type, "video"), sql`${schema.creatives.r2Url} is not null`));
        const byKey = new Map<string, (typeof candidates)[number]>();
        for (const c of [...candidates].sort(preferPreview)) { const k = looseMediaKey(c.name); if (k && !byKey.has(k)) byKey.set(k, c); }
        for (const [k, list] of wantKeys) {
          const c = byKey.get(k);
          if (!c) continue;
          for (const a of list) {
            libVideo.set(a.videoId!, { metaVideoId: a.videoId!, metaImageHash: null, r2Url: c.r2Url, thumbnailUrl: c.thumbnailUrl, type: "video", fileSize: c.fileSize, previewUrl: c.previewUrl });
            if (!c.metaVideoId) {
              c.metaVideoId = a.videoId!;
              await db.update(schema.creatives).set({ metaVideoId: a.videoId! }).where(eq(schema.creatives.id, c.id));
            }
          }
        }
      }
    }

    // One variant per hook label: the biggest spender. Highlighted ads always keep their own slot.
    const byHook = new Map<string, (typeof ads)[number]>();
    for (const ad of ads.slice().sort((a, b) => (spendOf.get(b.id) ?? 0) - (spendOf.get(a.id) ?? 0))) {
      const key = hookLabelFromName(ad.name) ?? "—";
      const cur = byHook.get(key);
      if (!cur || (highlight.has(ad.id) && !highlight.has(cur.id))) byHook.set(key, ad);
    }
    const chosen = [...byHook.values()];

    // The library holds the editors' MASTERS: 170 MB .mov files with the
    // index at the end, which a browser cannot stream. Only a small mp4/webm
    // is offered as a direct <video>; everything else plays through Meta's
    // transcoded preview. Both are returned so the client can fall back.
    const streamable = (l: { r2Url: string | null; fileSize: number | null }) =>
      !!l.r2Url && /\.(mp4|webm)(\?|$)/i.test(l.r2Url) && (l.fileSize == null || l.fileSize < 60 * 1024 * 1024);

    // Meta, per account: previews for every video ad, image urls where the library has none.
    const acct = ads.find((a) => a.adAccountId)?.adAccountId ?? null;
    const needImage = chosen.filter((a) => a.imageHash && !libImage.has(a.imageHash)).map((a) => a.imageHash!);
    const previews = new Map<string, MediaVariant["embed"]>();
    let metaImgs = new Map<string, string>();
    const videoAds = chosen.filter((a) => a.videoId);
    if (videoAds.length || needImage.length) {
      await withAdAccount(acct, async () => {
        await Promise.all(videoAds.map(async (a) => previews.set(a.id, await metaPreview(a.id, format))));
        if (needImage.length && acct) metaImgs = await metaImages(acct, needImage);
      });
    }

    const variants: MediaVariant[] = chosen.map((ad) => {
      let kind: MediaVariant["kind"] = null, url: string | null = null, poster: string | null = null, source: MediaVariant["source"] = null, embed: MediaVariant["embed"] = null, masterUrl: string | null = null;
      if (ad.videoId) {
        kind = "video";
        const l = libVideo.get(ad.videoId);
        masterUrl = l?.r2Url ?? null;
        embed = previews.get(ad.id) ?? null;
        // Transcoded preview first (sound + full frame, streams instantly), then
        // a small streamable master, then Meta's preview iframe.
        if (l?.previewUrl) { url = l.previewUrl; poster = l.thumbnailUrl; source = "library"; }
        else if (l && streamable(l)) { url = l.r2Url; poster = l.thumbnailUrl; source = "library"; }
        else if (embed) source = "preview";
        if (l?.thumbnailUrl && !poster) poster = l.thumbnailUrl;
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
        kind, url, poster, embed, source, masterUrl,
        highlighted: highlight.has(ad.id),
      };
    });
    variants.sort((a, b) => {
      const ha = a.hookLabel ? parseInt(a.hookLabel.slice(1), 10) : 999;
      const hb = b.hookLabel ? parseInt(b.hookLabel.slice(1), 10) : 999;
      return ha - hb || b.spend - a.spend;
    });
    return NextResponse.json({ variants, adAccountId: acct, format });
  } catch (e) {
    console.error("learning-loop media failed:", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Kunde inte hämta media" }, { status: 500 });
  }
}
