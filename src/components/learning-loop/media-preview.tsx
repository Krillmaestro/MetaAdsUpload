"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Film, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtMoney } from "./format";

interface Variant {
  hookLabel: string | null;
  adId: string;
  adName: string;
  adsetId: string;
  status: string | null;
  spend: number;
  kind: "video" | "image" | null;
  url: string | null;
  poster: string | null;
  embed: { src: string; width: number; height: number } | null;
  source: "library" | "meta" | "preview" | null;
  highlighted: boolean;
}

/**
 * The ad itself, with one tab per hook (H1, H2 …). Opens on the hook that
 * spent the most — or the highlighted creative — so a learning is written
 * while watching the thing that actually ran.
 */
export function MediaPreview({
  adsetId,
  adIds,
  highlightAdIds,
  currency,
  className,
  compact = false,
}: {
  adsetId?: string | null;
  adIds?: string[];
  highlightAdIds?: string[];
  currency: string;
  className?: string;
  compact?: boolean;
}) {
  const [variants, setVariants] = useState<Variant[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const key = `${adsetId ?? ""}|${(adIds ?? []).join(",")}`;
  useEffect(() => {
    let alive = true;
    setVariants(null);
    setError(null);
    const params = new URLSearchParams();
    if (adsetId) params.set("adsetId", adsetId);
    if (adIds?.length) params.set("adIds", adIds.join(","));
    if (highlightAdIds?.length) params.set("highlight", highlightAdIds.join(","));
    fetch(`/api/learning-loop/media?${params}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Kunde inte hämta media"); return d; })
      .then((d) => {
        if (!alive) return;
        const list = (d.variants ?? []) as Variant[];
        setVariants(list);
        setAccount(d.adAccountId ?? null);
        const pick = list.find((v) => v.highlighted) ?? list.slice().sort((a, b) => b.spend - a.spend)[0] ?? null;
        setSelected(pick?.adId ?? null);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Kunde inte hämta media"); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = variants?.find((v) => v.adId === selected) ?? null;

  if (error) return <div className={cn("rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[11px] text-slate-500", className)}>{error}</div>;
  if (!variants) return <div className={cn("flex items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] p-6", className)}><Loader2 className="h-4 w-4 animate-spin text-slate-500" /></div>;
  if (!variants.length) return <div className={cn("rounded-lg border border-dashed border-white/10 p-3 text-[11px] text-slate-500", className)}>Inga annonser i cachen för det här ad setet än.</div>;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500"><Film className="h-3.5 w-3.5" /> Creative</div>
        <div className="flex flex-wrap items-center gap-1">
          {variants.map((v) => (
            <button
              key={v.adId}
              type="button"
              onClick={() => setSelected(v.adId)}
              title={`${v.adName} · ${fmtMoney(v.spend, currency)} lifetime`}
              className={cn(
                "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                selected === v.adId ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-200" : "border-white/10 text-slate-400 hover:text-white",
                v.highlighted && selected !== v.adId && "border-violet-500/40 text-violet-300",
              )}
            >
              {v.hookLabel ?? "—"}
            </button>
          ))}
        </div>
      </div>
      {current && (
        <div className="overflow-hidden rounded-lg border border-white/5 bg-black/40">
          {current.kind === "video" && current.url ? (
            <video
              key={current.adId}
              src={current.url}
              poster={current.poster ?? undefined}
              controls
              playsInline
              preload="metadata"
              className={cn("mx-auto w-full bg-black object-contain", compact ? "max-h-[260px]" : "max-h-[420px]")}
            />
          ) : current.embed ? (
            <div className="flex justify-center bg-black">
              <iframe
                key={current.adId}
                src={current.embed.src}
                width={compact ? Math.round(current.embed.width * 0.6) : current.embed.width}
                height={compact ? Math.round(current.embed.height * 0.6) : current.embed.height}
                allow="autoplay; encrypted-media; picture-in-picture"
                scrolling="no"
                className="border-0"
                title={current.adName}
              />
            </div>
          ) : current.kind === "image" && current.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={current.adId} src={current.url} alt={current.adName} className={cn("mx-auto w-full object-contain", compact ? "max-h-[260px]" : "max-h-[420px]")} />
          ) : (
            <div className="flex h-32 items-center justify-center px-3 text-center text-[11px] text-slate-500">
              {current.kind ? "Meta gav ingen spelbar länk för den här annonsen (kan vara ett post-id-creative)." : "Annonsen har varken video eller bild i cachen."}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-[10px] text-slate-500">
            <span className="truncate" title={current.adName}>
              <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full", current.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-600")} />
              {current.adName}
            </span>
            <span className="shrink-0">{fmtMoney(current.spend, currency)} lifetime{current.source === "library" ? " · bibliotek" : current.source === "preview" ? " · Meta-förhandsvisning" : ""}</span>
          </div>
        </div>
      )}
      {account && current && (
        <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${account.replace(/^act_/, "")}&selected_ad_ids=${current.adId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-400">
          Öppna annonsen i Ads Manager <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
