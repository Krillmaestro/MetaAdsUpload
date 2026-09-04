"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Film, Loader2 } from "lucide-react";
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
  /** Original file in the library (may be a 170 MB master — offered as a download, not streamed). */
  masterUrl?: string | null;
}

type PreviewFormat = "INSTAGRAM_STORY" | "INSTAGRAM_REELS" | "MOBILE_FEED_STANDARD";
const FORMATS: Array<{ v: PreviewFormat; l: string; hint: string }> = [
  { v: "INSTAGRAM_STORY", l: "Hel ruta", hint: "Hela 9:16-rutan med undertexter — Metas story-spelare, autospelar utan ljud" },
  { v: "MOBILE_FEED_STANDARD", l: "Med ljud", hint: "Play-knappen spelar med ljud, men feed-formatet beskär till 4:5" },
];
function readFormat(): PreviewFormat {
  try { const v = localStorage.getItem("learning-loop-preview-format"); return FORMATS.some((f) => f.v === v) ? (v as PreviewFormat) : "INSTAGRAM_STORY"; } catch { return "INSTAGRAM_STORY"; }
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
  const [format, setFormat] = useState<PreviewFormat>("INSTAGRAM_STORY");
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Ads whose direct file failed to load — shown through Meta's preview instead. */
  const [fellBack, setFellBack] = useState<Set<string>>(new Set());

  useEffect(() => { setFormat(readFormat()); }, []);
  const changeFormat = (f: PreviewFormat) => { setFormat(f); try { localStorage.setItem("learning-loop-preview-format", f); } catch { /* ignore */ } };

  const key = `${adsetId ?? ""}|${(adIds ?? []).join(",")}|${format}`;
  useEffect(() => {
    let alive = true;
    setVariants((v) => (v ? v : null));
    setError(null);
    const params = new URLSearchParams();
    if (adsetId) params.set("adsetId", adsetId);
    if (adIds?.length) params.set("adIds", adIds.join(","));
    if (highlightAdIds?.length) params.set("highlight", highlightAdIds.join(","));
    params.set("format", format);
    fetch(`/api/learning-loop/media?${params}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Kunde inte hämta media"); return d; })
      .then((d) => {
        if (!alive) return;
        const list = (d.variants ?? []) as Variant[];
        setVariants(list);
        setAccount(d.adAccountId ?? null);
        setSelected((prev) => (prev && list.some((v) => v.adId === prev)) ? prev : (list.find((v) => v.highlighted) ?? list.slice().sort((a, b) => b.spend - a.spend)[0] ?? null)?.adId ?? null);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Kunde inte hämta media"); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const current = variants?.find((v) => v.adId === selected) ?? null;
  const useEmbed = !!current && (!current.url || fellBack.has(current.adId)) && !!current.embed;

  // A master file that has not produced metadata within a few seconds is not
  // going to (index at the end of a 170 MB .mov) — fall back to Meta's copy.
  useEffect(() => {
    if (!current?.url || current.kind !== "video" || !current.embed || fellBack.has(current.adId)) return;
    const id = current.adId;
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLVideoElement>(`video[data-ad="${id}"]`);
      if (el && el.readyState === 0) setFellBack((s) => new Set(s).add(id));
    }, 6000);
    return () => clearTimeout(t);
  }, [current, fellBack]);

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
          {current.kind === "video" && current.url && !useEmbed ? (
            <video
              key={current.adId}
              data-ad={current.adId}
              src={current.url}
              poster={current.poster ?? undefined}
              controls
              playsInline
              preload="metadata"
              onError={() => setFellBack((s) => new Set(s).add(current.adId))}
              className={cn("mx-auto w-full bg-black object-contain", compact ? "max-h-[260px]" : "max-h-[480px]")}
            />
          ) : useEmbed && current.embed ? (
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
            <span className="shrink-0">{fmtMoney(current.spend, currency)} lifetime{useEmbed ? " · Meta" : current.source === "library" ? " · originalfil" : ""}</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {current?.kind === "video" && useEmbed ? (
          <div className="flex items-center gap-0.5 rounded-md border border-white/10 p-0.5">
            {FORMATS.map((f) => (
              <button key={f.v} type="button" onClick={() => changeFormat(f.v)} title={f.hint} className={cn("rounded px-2 py-0.5 text-[10px] transition-colors", format === f.v ? "bg-white/10 text-white" : "text-slate-500 hover:text-white")}>
                {f.l}
              </button>
            ))}
          </div>
        ) : <span />}
        <div className="flex items-center gap-3">
          {current?.masterUrl && (
            <a href={current.masterUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-400" title="Originalfilen i R2 (kan vara stor)">
              Original <Download className="h-3 w-3" />
            </a>
          )}
          {account && current && (
            <a href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${account.replace(/^act_/, "")}&selected_ad_ids=${current.adId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-cyan-400">
              Ads Manager <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
