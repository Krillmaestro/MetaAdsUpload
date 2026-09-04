"use client";

// The one button: an approved assignment becomes an ad set on Meta.
// Everything is prefilled from what this product + country used last time
// (publish_defaults) or guessed by campaign name; the admin confirms.

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Rocket,
  Loader2,
  CheckCircle2,
  FileVideo,
  FileImage,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DialogAssignment {
  id: string;
  title: string;
  autoName: string | null;
}

interface Defaults {
  product: { id: string; name: string; code: string } | null;
  country: { id: string; name: string; code: string } | null;
  campaigns: Array<{ id: string; name: string; status: string; isCbo: boolean; dailyBudget: number | null }>;
  suggestedCampaignId: string | null;
  templates: Array<{ id: number; name: string; landingPages: string[] | null; dailyBudget: number | null; currency: string | null }>;
  templateId: number | null;
  landingPage: string;
  landingPages?: string[];
  dailyBudget: number;
  adsetName: string;
  readyFiles: Array<{ id: string; hookLabel: string | null; filename: string; r2Url: string; type: "video" | "image"; versionNumber: number }>;
  lastUsed: { campaignName: string | null; updatedAt: string } | null;
}

interface PublishResult {
  success: boolean;
  meta?: {
    campaignId: string;
    adsetId: string;
    adsetName: string;
    totalAds: number;
    formula: string;
    ads: Array<{ adId: string; adName: string; creativeName: string; landingPage: string }>;
  };
}

const NEW_CAMPAIGN = "__new__";

export function UploadToMetaDialog({
  assignment,
  open,
  onOpenChange,
  onPublished,
}: {
  assignment: DialogAssignment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);

  const [campaignId, setCampaignId] = useState<string>("");
  const [newCampaignName, setNewCampaignName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [landingPage, setLandingPage] = useState("");
  const [dailyBudget, setDailyBudget] = useState("");
  const [adsetName, setAdsetName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [optimizationGoal, setOptimizationGoal] = useState("OFFSITE_CONVERSIONS");
  const [conversionEvent, setConversionEvent] = useState("PURCHASE");
  const [bidStrategy, setBidStrategy] = useState("LOWEST_COST_WITHOUT_CAP");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setResult(null);
    setLoadError(null);
    setLoading(true);
    fetch(`/api/assignments/${assignment.id}/publish-defaults`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Could not load defaults");
        return data as Defaults;
      })
      .then((d) => {
        if (cancelled) return;
        setDefaults(d);
        setCampaignId(d.suggestedCampaignId ?? (d.campaigns[0]?.id ?? NEW_CAMPAIGN));
        setNewCampaignName(`${d.country?.code ?? ""} ${d.product?.name ?? assignment.autoName ?? assignment.title} ABO`.trim());
        setTemplateId(d.templateId != null ? String(d.templateId) : "");
        setLandingPage((d.landingPages?.length ? d.landingPages : [d.landingPage ?? ""]).join("\n"));
        setDailyBudget(d.dailyBudget != null ? String(Math.round(d.dailyBudget)) : "500");
        setAdsetName(d.adsetName ?? assignment.autoName ?? assignment.title);
        setSelectedFiles(new Set(d.readyFiles.map((f) => f.id)));
      })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load defaults"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, assignment.id, assignment.autoName, assignment.title]);

  const selectedCampaign = defaults?.campaigns.find((c) => c.id === campaignId) ?? null;
  const isCbo = !!selectedCampaign?.isCbo;
  const selectedCount = selectedFiles.size;
  const landingList = landingPage.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const totalAds = selectedCount * landingList.length;
  const canSubmit =
    !publishing && !loading && !!defaults && totalAds > 0 &&
    (campaignId === NEW_CAMPAIGN ? newCampaignName.trim().length > 0 : campaignId.length > 0) &&
    adsetName.trim().length > 0 &&
    (isCbo || (parseInt(dailyBudget, 10) > 0));

  const toggleFile = (id: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handlePublish = async () => {
    if (!defaults) return;
    setPublishing(true);
    try {
      const body: Record<string, unknown> = {
        adsetName: adsetName.trim(),
        landingPages: landingList,
        versionIds: Array.from(selectedFiles),
        optimizationGoal,
        conversionEvent,
        bidStrategy,
      };
      if (campaignId === NEW_CAMPAIGN) body.campaignName = newCampaignName.trim();
      else body.campaignId = campaignId;
      if (templateId) body.templateId = parseInt(templateId, 10);
      if (isCbo) body.budgetType = "CBO";
      else body.dailyBudget = Math.round(parseInt(dailyBudget, 10) * 100);

      const res = await fetch(`/api/assignments/${assignment.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      setResult(data);
      toast.success(`${data.meta?.totalAds ?? selectedCount} ads uploaded to Meta`);
      onPublished?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] sm:max-w-xl bg-[#111827] border-white/10 max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Rocket className="h-5 w-5 text-cyan-400" />
            Upload to Meta
          </DialogTitle>
          <p className="text-xs text-slate-500 font-mono">{assignment.autoName || assignment.title}</p>
        </DialogHeader>

        {result?.meta ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-center">
              <CheckCircle2 className="h-14 w-14 text-emerald-400" />
            </div>
            <div className="text-center">
              <h3 className="text-base font-semibold text-white">Uploaded</h3>
              <p className="text-sm text-slate-400 mt-1">{result.meta.formula}</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/5 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Ad set</span>
                <span className="text-slate-200 text-right">{result.meta.adsetName}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Ads</span>
                <span className="text-slate-200">{result.meta.totalAds}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Status</span>
                <span className="text-amber-300">Paused — turn on in Ads Manager</span>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-white/5 divide-y divide-white/5">
              {result.meta.ads.map((ad) => (
                <div key={ad.adId} className="px-3 py-1.5 text-xs text-slate-300 truncate">{ad.adName}</div>
              ))}
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading defaults…
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /> {loadError}
          </div>
        ) : defaults ? (
          <div className="space-y-4">
            {/* Campaign */}
            <Field label="Campaign" hint={defaults.lastUsed?.campaignName ? `Last time: ${defaults.lastUsed.campaignName}` : defaults.suggestedCampaignId ? "Suggested from the campaign name" : undefined}>
              <Select value={campaignId} onValueChange={setCampaignId} items={[...defaults.campaigns.map((c) => ({ value: c.id, label: c.isCbo ? `${c.name} · CBO` : c.name })), { value: NEW_CAMPAIGN, label: "+ New campaign" }]}>
                <SelectTrigger className="bg-white/[0.03] border-white/10">
                  <SelectValue placeholder="Choose campaign" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {defaults.campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className={cn("h-1.5 w-1.5 rounded-full", c.status === "ACTIVE" ? "bg-emerald-400" : "bg-slate-500")} />
                        <span className="truncate">{c.name}</span>
                        {c.isCbo && <span className="rounded bg-violet-500/15 px-1 text-[10px] text-violet-300">CBO</span>}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CAMPAIGN}>+ New campaign</SelectItem>
                </SelectContent>
              </Select>
              {campaignId === NEW_CAMPAIGN && (
                <Input
                  value={newCampaignName}
                  onChange={(e) => setNewCampaignName(e.target.value)}
                  placeholder="Campaign name"
                  className="mt-2 bg-white/[0.03] border-white/10"
                />
              )}
            </Field>

            {/* Template */}
            <Field label="Copy template">
              <Select value={templateId} onValueChange={setTemplateId} items={defaults.templates.map((t) => ({ value: String(t.id), label: t.name }))}>
                <SelectTrigger className="bg-white/[0.03] border-white/10">
                  <SelectValue placeholder="Choose template" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {defaults.templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Landing pages" className="col-span-2">
                <Textarea value={landingPage} onChange={(e) => setLandingPage(e.target.value)} placeholder="https://… (one per line — every file × every page becomes an ad)" rows={Math.min(4, Math.max(1, landingList.length || 1))} className="bg-white/[0.03] border-white/10 text-sm font-mono" />
              </Field>
              <Field label="Ad set name">
                <Input value={adsetName} onChange={(e) => setAdsetName(e.target.value)} className="bg-white/[0.03] border-white/10" />
              </Field>
              <Field label="Daily budget">
                {isCbo ? (
                  <div className="h-9 flex items-center rounded-md border border-white/5 bg-white/[0.02] px-3 text-xs text-slate-400">
                    Budget set on campaign (CBO)
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      type="number"
                      min={1}
                      value={dailyBudget}
                      onChange={(e) => setDailyBudget(e.target.value)}
                      className="bg-white/[0.03] border-white/10 pr-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                      {defaults.templates.find((t) => String(t.id) === templateId)?.currency || "kr"}
                    </span>
                  </div>
                )}
              </Field>
            </div>

            {/* Files */}
            <Field label={`Approved files (${selectedCount}/${defaults.readyFiles.length})`}>
              {defaults.readyFiles.length === 0 ? (
                <p className="text-xs text-amber-300 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
                  No approved files left to upload. Approve the files in the assignment first.
                </p>
              ) : (
                <div className="rounded-lg border border-white/5 divide-y divide-white/5">
                  {defaults.readyFiles.map((f) => {
                    const checked = selectedFiles.has(f.id);
                    return (
                      <label key={f.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-white/[0.02]">
                        <Checkbox checked={checked} onCheckedChange={() => toggleFile(f.id)} />
                        {f.hookLabel && (
                          <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-300">{f.hookLabel}</span>
                        )}
                        {f.type === "image" ? <FileImage className="h-3.5 w-3.5 text-slate-500" /> : <FileVideo className="h-3.5 w-3.5 text-slate-500" />}
                        <span className={cn("text-xs truncate", checked ? "text-slate-200" : "text-slate-500")}>{f.filename}</span>
                        {f.versionNumber > 1 && <span className="ml-auto text-[10px] text-slate-500">v{f.versionNumber}</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>

            {/* Advanced */}
            <button
              type="button"
              onClick={() => setShowAdvanced((s) => !s)}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300"
            >
              {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Advanced
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Optimization">
                  <Select value={optimizationGoal} onValueChange={setOptimizationGoal} items={[{ value: "OFFSITE_CONVERSIONS", label: "Conversions" }, { value: "LINK_CLICKS", label: "Link clicks" }, { value: "LANDING_PAGE_VIEWS", label: "Landing page views" }]}>
                    <SelectTrigger className="bg-white/[0.03] border-white/10 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OFFSITE_CONVERSIONS">Conversions</SelectItem>
                      <SelectItem value="LINK_CLICKS">Link clicks</SelectItem>
                      <SelectItem value="LANDING_PAGE_VIEWS">Landing page views</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Event">
                  <Select value={conversionEvent} onValueChange={setConversionEvent} items={[{ value: "PURCHASE", label: "Purchase" }, { value: "ADD_TO_CART", label: "Add to cart" }, { value: "INITIATED_CHECKOUT", label: "Initiated checkout" }, { value: "LEAD", label: "Lead" }]}>
                    <SelectTrigger className="bg-white/[0.03] border-white/10 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PURCHASE">Purchase</SelectItem>
                      <SelectItem value="ADD_TO_CART">Add to cart</SelectItem>
                      <SelectItem value="INITIATED_CHECKOUT">Initiated checkout</SelectItem>
                      <SelectItem value="LEAD">Lead</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Bid">
                  <Select value={bidStrategy} onValueChange={setBidStrategy} items={[{ value: "LOWEST_COST_WITHOUT_CAP", label: "Lowest cost" }, { value: "LOWEST_COST_WITH_BID_CAP", label: "Bid cap" }, { value: "COST_CAP", label: "Cost cap" }]}>
                    <SelectTrigger className="bg-white/[0.03] border-white/10 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOWEST_COST_WITHOUT_CAP">Lowest cost</SelectItem>
                      <SelectItem value="LOWEST_COST_WITH_BID_CAP">Bid cap</SelectItem>
                      <SelectItem value="COST_CAP">Cost cap</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            <DialogFooter className="pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={publishing}>Cancel</Button>
              <Button onClick={handlePublish} disabled={!canSubmit} className="bg-cyan-600 hover:bg-cyan-700">
                {publishing ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Uploading…</>
                ) : (
                  <><Rocket className="h-4 w-4 mr-1.5" /> Upload {totalAds} ad{totalAds === 1 ? "" : "s"}</>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</span>
        {hint && <span className="text-[11px] text-slate-500 truncate">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
