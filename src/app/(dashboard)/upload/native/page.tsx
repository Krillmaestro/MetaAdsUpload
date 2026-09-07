"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { KNOWN_PIXELS, pixelLabel } from "@/lib/meta/pixels";
import { countriesForSelection, COUNTRY_SELECT_GROUPS } from "@/lib/meta/geo";
import {
  ArrowLeft, Plus, Trash2, Loader2, CheckCircle2, XCircle, Upload,
  Globe, Crosshair, ImageIcon, FileVideo, Rocket,
} from "lucide-react";

interface Campaign { id: string; name: string }
interface AdSet { id: string; name: string }
interface Page { id: string; name: string }

interface Creative {
  id: string;
  file: File;
  filename: string;
  mediaType: "video" | "image";
  headline: string;
  primaryText: string;
  status: "pending" | "uploading" | "creating" | "done" | "failed";
  step: string;
  error?: string;
  adId?: string;
  adsetId?: string;
}

const CTA_OPTIONS = [
  "SHOP_NOW", "LEARN_MORE", "SIGN_UP", "GET_OFFER", "ORDER_NOW", "BUY_NOW", "SEE_MORE",
];

// Persist the shared setup (campaign, ad set, page, pixel, LP, CTA…) across
// batches so uploading many in a row doesn't mean re-picking everything.
const NATIVE_PREFS_KEY = "meta-native-upload-prefs";

const inputCls = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40";
const inputSmCls = "w-full rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500/40";
const labelCls = "text-[10px] font-medium text-slate-400 uppercase tracking-wider";
const cardCls = "rounded-xl border border-white/[0.06] bg-[#111827] p-4";

export default function NativeUploadPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [adAccountId, setAdAccountId] = useState(""); // "" = connection default
  const [adAccountOptions, setAdAccountOptions] = useState<Array<{ id: string; name: string; currency: string }>>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [pixelId, setPixelId] = useState("");

  const [adsets, setAdsets] = useState<AdSet[]>([]);
  const [adsetMode, setAdsetMode] = useState<"new" | "existing">("new");
  const [selectedAdsetId, setSelectedAdsetId] = useState("");

  // New ad set config (shared across all creatives)
  const [newAdsetName, setNewAdsetName] = useState("");
  const [newAdsetBudget, setNewAdsetBudget] = useState(50);
  const [newAdsetCountry, setNewAdsetCountry] = useState("BIG5");
  const [newAdsetOptGoal, setNewAdsetOptGoal] = useState("OFFSITE_CONVERSIONS");
  const [newAdsetBidStrategy, setNewAdsetBidStrategy] = useState("LOWEST_COST_WITHOUT_CAP");
  const [newAdsetConvEvent, setNewAdsetConvEvent] = useState("PURCHASE");
  const [scheduleForTomorrow, setScheduleForTomorrow] = useState(false);

  // Shared creative settings
  // One batch = ONE ad set; every creative becomes one ad per landing page.
  const [landingPages, setLandingPages] = useState<Array<{ label: string; url: string }>>([{ label: "PP", url: "" }]);
  const [ctaType, setCtaType] = useState("SHOP_NOW");

  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hydrated = useRef(false);

  // ─── Restore saved setup (runs before connection defaults apply) ───────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(NATIVE_PREFS_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.campaignId) setSelectedCampaignId(p.campaignId);
        if (p.adsetMode) setAdsetMode(p.adsetMode);
        if (p.selectedAdsetId) setSelectedAdsetId(p.selectedAdsetId);
        if (p.pageId) setSelectedPageId(p.pageId);
        if (p.pixelId) setPixelId(p.pixelId);
        if (p.country) setNewAdsetCountry(p.country);
        if (typeof p.budget === "number") setNewAdsetBudget(p.budget);
        if (p.optGoal) setNewAdsetOptGoal(p.optGoal);
        if (p.bidStrategy) setNewAdsetBidStrategy(p.bidStrategy);
        if (p.convEvent) setNewAdsetConvEvent(p.convEvent);
        if (Array.isArray(p.landingPages) && p.landingPages.length) setLandingPages(p.landingPages);
        else if (p.landingPage) setLandingPages([{ label: "PP", url: p.landingPage }]);
        if (p.cta) setCtaType(p.cta);
        if (p.adAccountId) setAdAccountId(p.adAccountId);
      }
    } catch { /* ignore */ }
    hydrated.current = true;
  }, []);

  // Persist the shared setup on change (creatives themselves are never saved).
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(NATIVE_PREFS_KEY, JSON.stringify({
        campaignId: selectedCampaignId, adsetMode, selectedAdsetId,
        pageId: selectedPageId, pixelId, country: newAdsetCountry,
        budget: newAdsetBudget, optGoal: newAdsetOptGoal, bidStrategy: newAdsetBidStrategy,
        convEvent: newAdsetConvEvent, landingPages, cta: ctaType, adAccountId,
      }));
    } catch { /* ignore */ }
  }, [selectedCampaignId, adsetMode, selectedAdsetId, selectedPageId, pixelId, newAdsetCountry,
      newAdsetBudget, newAdsetOptGoal, newAdsetBidStrategy, newAdsetConvEvent, landingPages, ctaType, adAccountId]);

  // ─── Load connection (pages, ad accounts, defaults) ────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const connRes = await fetch("/api/meta/connection");
        if (connRes.ok) {
          const connData = await connRes.json();
          const active = connData.active;
          const activeConn = connData.connections?.find((c: { isActive: boolean }) => c.isActive);
          if (activeConn?.pages) setPages(activeConn.pages);
          if (activeConn?.adAccounts) setAdAccountOptions(activeConn.adAccounts);
          // Only fall back to the connection defaults if the user hasn't saved a choice.
          const savedPrefs = localStorage.getItem(NATIVE_PREFS_KEY);
          const prefs = savedPrefs ? JSON.parse(savedPrefs) : {};
          if (!prefs.pageId && active?.activePageId) setSelectedPageId(active.activePageId);
          if (!prefs.pixelId && active?.pixelId) setPixelId(active.pixelId);
        }
      } catch {
        toast.error("Failed to load connection");
      }
    })();
  }, []);

  // ─── Load campaigns scoped to the chosen ad account ────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const qs = adAccountId ? `?adAccountId=${encodeURIComponent(adAccountId)}` : "";
        const campRes = await fetch(`/api/meta/campaigns${qs}`);
        if (campRes.ok) {
          const { data } = await campRes.json();
          setCampaigns(data || []);
        }
      } catch {
        toast.error("Failed to load campaigns");
      }
    })();
  }, [adAccountId]);

  // ─── Load ad sets when campaign changes ────────────────────────────────────
  useEffect(() => {
    if (!selectedCampaignId) { setAdsets([]); return; }
    (async () => {
      try {
        const actQs = adAccountId ? `&adAccountId=${encodeURIComponent(adAccountId)}` : "";
        const res = await fetch(`/api/meta/adsets?campaign_id=${selectedCampaignId}${actQs}`);
        if (res.ok) {
          const { data } = await res.json();
          setAdsets(data || []);
        }
      } catch { toast.error("Failed to load ad sets"); }
    })();
  }, [selectedCampaignId, adAccountId]);

  // ─── Creatives ─────────────────────────────────────────────────────────────
  const onFilesPicked = (files: FileList | null) => {
    if (!files) return;
    const added: Creative[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      filename: file.name,
      mediaType: file.type.startsWith("video/") ? "video" : "image",
      headline: "",
      primaryText: "",
      status: "pending",
      step: "",
    }));
    setCreatives((prev) => [...prev, ...added]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateCreative = (id: string, patch: Partial<Creative>) =>
    setCreatives((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeCreative = (id: string) =>
    setCreatives((prev) => prev.filter((c) => c.id !== id));

  // ─── R2 upload (presigned URL, proxy fallback) ─────────────────────────────
  const uploadFileToR2 = async (file: File): Promise<{ key: string; url: string }> => {
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type, fileSize: file.size, purpose: "library" }),
      });
      const presignData = await presignRes.json();
      if (!presignRes.ok) throw new Error(presignData.error || "Could not get a presigned URL");
      const { uploadUrl, publicUrl, key } = presignData;
      const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error(`R2 PUT failed: ${putRes.status}`);
      return { key, url: publicUrl };
    } catch (presignErr) {
      // Fallback: server proxy
      console.warn("Presigned upload failed, using proxy:", presignErr);
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/direct", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not upload to R2");
      return { key: data.key, url: data.publicUrl };
    }
  };

  const buildAdsetConfig = () => {
    const cfg: Record<string, unknown> = {
      name: newAdsetName || `Native AdSet ${new Date().toLocaleDateString("sv")} - ${landingPages.map((l) => l.label.trim() || "LP").join(" + ")}`,
      dailyBudget: newAdsetBudget,
      targeting: { geo_locations: { countries: countriesForSelection(newAdsetCountry) } },
      optimizationGoal: newAdsetOptGoal,
      bidStrategy: newAdsetBidStrategy,
      conversionEvent: newAdsetConvEvent,
    };
    if (scheduleForTomorrow) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(2, 0, 0, 0);
      cfg.startTime = tomorrow.toISOString();
    }
    return cfg;
  };

  // Process ONE creative -> its own ad. Returns the ad set id it landed in.
  const processCreative = async (c: Creative, adsetIdToUse?: string): Promise<string | undefined> => {
    updateCreative(c.id, { status: "uploading", step: "Uploading to R2…", error: undefined });
    let r2Key: string, r2Url: string;
    try {
      const up = await uploadFileToR2(c.file);
      r2Key = up.key; r2Url = up.url;
    } catch (e) {
      updateCreative(c.id, { status: "failed", step: "Failed", error: e instanceof Error ? e.message : "R2 upload failed" });
      return undefined;
    }

    const lps = landingPages.filter((l) => l.url.trim());
    const baseName = (c.headline.trim() || c.filename.replace(/\.[^.]+$/, "")).slice(0, 60);
    let adsetId = adsetIdToUse ?? (adsetMode === "existing" && selectedAdsetId ? selectedAdsetId : undefined);
    let lastAdId: string | undefined;
    for (let i = 0; i < lps.length; i++) {
      const lp = lps[i];
      updateCreative(c.id, { status: "creating", step: lps.length > 1 ? `Creating ad ${i + 1}/${lps.length} (${lp.label.trim()})…` : "Creating ad on Meta…" });
      const payload: Record<string, unknown> = {
        r2Key, r2Url,
        filename: c.filename,
        mediaType: c.mediaType,
        campaignId: selectedCampaignId,
        adCopy: {
          headlines: [c.headline.trim()],
          primaryTexts: [c.primaryText.trim()],
          linkUrl: lp.url.trim(),
          ctaType,
        },
        adName: lps.length > 1 ? `${baseName} [${lp.label.trim()}]` : baseName,
      };
      if (selectedPageId) payload.pageId = selectedPageId;
      if (pixelId) payload.pixelId = pixelId;
      if (adAccountId) payload.adAccountId = adAccountId;
      if (adsetId) payload.adsetId = adsetId;
      else payload.adsetConfig = buildAdsetConfig();

      try {
        const res = await fetch("/api/meta/upload-from-r2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (!res.ok) {
          updateCreative(c.id, { status: "failed", step: "Failed", error: `${lp.label.trim()}: ${result.error || "Meta upload failed"}`, adsetId });
          return adsetId;
        }
        lastAdId = result.adId;
        adsetId = adsetId || (result.adsetId as string | undefined);
      } catch (e) {
        updateCreative(c.id, { status: "failed", step: "Failed", error: e instanceof Error ? e.message : "Request failed", adsetId });
        return adsetId;
      }
    }
    updateCreative(c.id, { status: "done", step: lps.length > 1 ? `Done — ${lps.length} ads` : "Done!", adId: lastAdId, adsetId });
    return adsetId;
  };

  const validate = (): string | null => {
    if (!selectedCampaignId) return "Select a campaign";
    if (adsetMode === "existing" && !selectedAdsetId) return "Select an ad set or switch to 'Create new'";
    const lps = landingPages.filter((l) => l.url.trim());
    if (lps.length === 0) return "Add at least one landing page URL";
    if (landingPages.some((l) => l.url.trim() && !l.label.trim())) return "Give every landing page a label (PP, 5R, LP1 …)";
    if (creatives.length === 0) return "Add at least one creative";
    for (const c of creatives) {
      if (!c.headline.trim()) return `Missing headline for "${c.filename}"`;
      if (!c.primaryText.trim()) return `Missing primary text for "${c.filename}"`;
    }
    return null;
  };

  const launch = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }

    setIsUploading(true);

    // Only (re)process creatives that aren't already live — never re-create a
    // done ad. Reset just those to a clean pending state.
    const todo = creatives.filter((c) => c.status !== "done");
    setCreatives((prev) => prev.map((c) => (c.status !== "done" ? { ...c, status: "pending", step: "", error: undefined } : c)));

    // Reuse the ad set the done creatives already landed in (existing mode uses
    // the picked one). This keeps every creative in ONE ad set across retries.
    let adsetId: string | undefined = adsetMode === "existing"
      ? selectedAdsetId
      : creatives.find((c) => c.status === "done" && c.adsetId)?.adsetId;
    let ok = 0, failed = 0;

    // Sequential: first creative creates the ad set (new mode), the rest reuse it.
    for (const c of todo) {
      const landedAdset = await processCreative(c, adsetId);
      if (landedAdset) {
        ok++;
        adsetId = adsetId || landedAdset;
      } else {
        failed++;
        // In "new" mode, if we still have no ad set, abort so the next creative
        // doesn't spawn a second ad set.
        if (adsetMode === "new" && !adsetId) {
          toast.error("First creative failed before the ad set was created — fix it and retry.");
          break;
        }
      }
    }

    setIsUploading(false);
    if (ok > 0) toast.success(`${ok} native ad(s) created${failed ? `, ${failed} failed` : ""}`);
    else if (failed > 0) toast.error("All creatives failed — check the errors below.");
  };

  const allDone = creatives.length > 0 && creatives.every((c) => c.status === "done");

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-cyan-400" />
            <h1 className="text-lg font-semibold text-white">Native Ad Uploader</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">One image/video per ad — each with its own headline &amp; primary text.</p>
        </div>
        <Link href="/upload" className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Standard uploader
        </Link>
      </div>

      {/* Campaign + Ad set */}
      <div className={cardCls}>
        {/* Ad account — campaigns/ad sets below are listed from (and ads created in) this account */}
        <div className="mb-3 space-y-1.5">
          <label className={labelCls}>Annonskonto</label>
          <select
            value={adAccountId}
            onChange={(e) => {
              setAdAccountId(e.target.value);
              // A campaign id belongs to ONE account — never carry the selection across.
              setSelectedCampaignId("");
              setSelectedAdsetId("");
              setAdsets([]);
            }}
            className={inputSmCls}
          >
            <option value="">Kontots standard (Settings)</option>
            {adAccountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.id.startsWith("act_") ? a.id : `act_${a.id}`} ({a.currency})
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className={labelCls}>Campaign</label>
            <select value={selectedCampaignId} onChange={(e) => setSelectedCampaignId(e.target.value)} className={inputSmCls}>
              <option value="">Select campaign…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>Ad set</label>
            <div className="flex gap-1.5">
              <button onClick={() => setAdsetMode("new")} className={cn("flex-1 rounded-lg px-2 py-1.5 text-xs border transition-all", adsetMode === "new" ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-200" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10")}>Create new</button>
              <button onClick={() => setAdsetMode("existing")} className={cn("flex-1 rounded-lg px-2 py-1.5 text-xs border transition-all", adsetMode === "existing" ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-200" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10")}>Existing</button>
            </div>
          </div>
        </div>

        {adsetMode === "existing" ? (
          <div className="mt-3 space-y-1.5">
            <label className={labelCls}>Select ad set</label>
            <select value={selectedAdsetId} onChange={(e) => setSelectedAdsetId(e.target.value)} className={inputSmCls}>
              <option value="">Select ad set…</option>
              {adsets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <input value={newAdsetName} onChange={(e) => setNewAdsetName(e.target.value)} placeholder="Ad set name (auto if empty)" className={inputCls} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Budget (per day)</label>
                <input type="number" value={newAdsetBudget} onChange={(e) => setNewAdsetBudget(Number(e.target.value))} className={inputSmCls} />
              </div>
              <div>
                <label className={labelCls}>Country</label>
                <select value={newAdsetCountry} onChange={(e) => setNewAdsetCountry(e.target.value)} className={inputSmCls}>
                  {COUNTRY_SELECT_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Optimization</label>
                <select value={newAdsetOptGoal} onChange={(e) => setNewAdsetOptGoal(e.target.value)} className={inputSmCls}>
                  <option value="OFFSITE_CONVERSIONS">Conversions</option>
                  <option value="LANDING_PAGE_VIEWS">Landing Page Views</option>
                  <option value="LINK_CLICKS">Link Clicks</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Conversion</label>
                <select value={newAdsetConvEvent} onChange={(e) => setNewAdsetConvEvent(e.target.value)} className={inputSmCls}>
                  <option value="PURCHASE">Purchase</option>
                  <option value="ADD_TO_CART">Add to Cart</option>
                  <option value="INITIATED_CHECKOUT">Initiate Checkout</option>
                  <option value="LEAD">Lead</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Bid strategy</label>
                <select value={newAdsetBidStrategy} onChange={(e) => setNewAdsetBidStrategy(e.target.value)} className={inputSmCls}>
                  <option value="LOWEST_COST_WITHOUT_CAP">Lowest Cost</option>
                  <option value="COST_CAP">Cost Cap</option>
                  <option value="LOWEST_COST_WITH_BID_CAP">Bid Cap</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={scheduleForTomorrow} onChange={(e) => setScheduleForTomorrow(e.target.checked)} />
              Schedule start 02:00 tomorrow
            </label>
          </div>
        )}
      </div>

      {/* Page + Pixel */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className={cardCls}>
          <div className="flex items-center gap-2 mb-2.5"><Globe className="h-4 w-4 text-blue-400" /><h3 className={labelCls}>Facebook Page</h3></div>
          <select value={selectedPageId} onChange={(e) => setSelectedPageId(e.target.value)} className={inputCls}>
            <option value="">Select page…</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className={cardCls}>
          <div className="flex items-center gap-2 mb-2.5"><Crosshair className="h-4 w-4 text-purple-400" /><h3 className={labelCls}>Pixel</h3></div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_PIXELS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPixelId(p.id)}
                  className={cn("text-[11px] px-2 py-1 rounded-md border transition-all", pixelId === p.id ? "bg-purple-500/20 border-purple-500/40 text-purple-200" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10")}>
                  {p.label}
                </button>
              ))}
            </div>
            <input value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="Pixel ID" className={inputCls} />
            {pixelLabel(pixelId) && <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300">{pixelLabel(pixelId)}</span>}
          </div>
        </div>
      </div>

      {/* Landing page + CTA (shared) */}
      <div className={cardCls}>
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <div className="space-y-1.5">
            <label className={labelCls}>Landing pages (shared) — every creative becomes one ad per page, all in the same ad set</label>
            <div className="space-y-1.5">
              {landingPages.map((lp, i) => (
                <div key={i} className="flex gap-2">
                  <input value={lp.label} onChange={(e) => setLandingPages((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="PP" className={`${inputCls} w-20 shrink-0 font-mono`} />
                  <input value={lp.url} onChange={(e) => setLandingPages((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…" className={inputCls} />
                  {landingPages.length > 1 && (
                    <button type="button" onClick={() => setLandingPages((prev) => prev.filter((_, j) => j !== i))} className="px-2 text-slate-500 hover:text-red-400" aria-label="Remove landing page">×</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setLandingPages((prev) => [...prev, { label: prev.length === 1 ? "5R" : `LP${prev.length + 1}`, url: "" }])} className="text-xs text-cyan-400 hover:text-cyan-300">+ Add landing page</button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className={labelCls}>CTA</label>
            <select value={ctaType} onChange={(e) => setCtaType(e.target.value)} className={inputSmCls}>
              {CTA_OPTIONS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Creatives */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><ImageIcon className="h-4 w-4 text-cyan-400" /><h3 className={labelCls}>Creatives — own copy each ({creatives.length})</h3></div>
          <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/20 transition-all">
            <Plus className="h-3.5 w-3.5" /> Add creatives
          </button>
          <input ref={fileInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => onFilesPicked(e.target.files)} />
        </div>

        {creatives.length === 0 ? (
          <button onClick={() => fileInputRef.current?.click()} className="w-full py-8 rounded-lg border border-dashed border-white/10 text-slate-500 text-sm hover:border-cyan-500/30 hover:text-slate-400 transition-all flex flex-col items-center gap-1.5">
            <Upload className="h-5 w-5" />
            Add images or videos — each becomes its own ad
          </button>
        ) : (
          <div className="space-y-2.5">
            {creatives.map((c, idx) => (
              <div key={c.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <div className="flex items-center gap-2 mb-2">
                  {c.mediaType === "video" ? <FileVideo className="h-4 w-4 text-slate-400 shrink-0" /> : <ImageIcon className="h-4 w-4 text-slate-400 shrink-0" />}
                  <span className="text-xs text-slate-300 truncate flex-1">{idx + 1}. {c.filename}</span>
                  {c.status === "done" && <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />}
                  {c.status === "failed" && <XCircle className="h-4 w-4 text-red-400 shrink-0" />}
                  {(c.status === "uploading" || c.status === "creating") && <Loader2 className="h-4 w-4 text-cyan-400 animate-spin shrink-0" />}
                  {!isUploading && c.status !== "done" && (
                    <button onClick={() => removeCreative(c.id)} className="text-slate-500 hover:text-red-400 transition-colors shrink-0"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <input value={c.headline} onChange={(e) => updateCreative(c.id, { headline: e.target.value })} placeholder="Headline for this creative" disabled={isUploading} className={inputSmCls} />
                  <textarea value={c.primaryText} onChange={(e) => updateCreative(c.id, { primaryText: e.target.value })} placeholder="Primary text for this creative" disabled={isUploading} rows={1} className={cn(inputSmCls, "resize-y min-h-[34px]")} />
                </div>
                {c.step && <p className={cn("text-[10px] mt-1.5", c.status === "failed" ? "text-red-400" : c.status === "done" ? "text-green-400" : "text-cyan-400")}>{c.step}{c.error ? ` — ${c.error}` : ""}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Launch */}
      <div className="flex items-center justify-between sticky bottom-4 rounded-xl border border-white/10 bg-[#0f1629]/95 backdrop-blur p-3">
        <span className="text-xs text-slate-400">
          {creatives.length} creative(s) → {creatives.length} ad(s) in {adsetMode === "new" ? "a new ad set" : "the selected ad set"}
        </span>
        <button
          onClick={launch}
          disabled={isUploading || allDone}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan-500 text-[#0a0e1a] font-semibold text-sm hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {isUploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</> : allDone ? <><CheckCircle2 className="h-4 w-4" /> Done</> : <><Rocket className="h-4 w-4" /> Create native ads</>}
        </button>
      </div>
    </div>
  );
}
