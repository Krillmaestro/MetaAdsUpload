"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Minus, Trash2, FileText, Star, Edit2, Type, MessageSquare, Globe, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Template {
  id: number;
  name: string;
  isDefault: boolean;
  objective: string;
  budgetType: string;
  dailyBudget: number | null;
  headlines: string[];
  primaryTexts: string[];
  descriptions: string[];
  ctaType: string;
  landingPages: string[];
  targetCountries: string[];
  ageMin: number | null;
  ageMax: number | null;
  optimizationGoal: string;
  conversionEvent: string;
  bidStrategy: string;
  pixelId: string | null;
  productName: string | null;
  angleName: string | null;
  adAccountId: string | null;
}

interface AdAccountOption { id: string; name: string; currency: string; status?: number }

interface FormState {
  name: string;
  isDefault: boolean;
  objective: string;
  budgetType: string;
  dailyBudget: number | null;
  headlines: string[];
  primaryTexts: string[];
  ctaType: string;
  landingPages: string[];
  targetCountries: string[];
  optimizationGoal: string;
  conversionEvent: string;
  bidStrategy: string;
  pixelId: string;
  productName: string;
  adAccountId: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  isDefault: false,
  objective: "OUTCOME_SALES",
  budgetType: "ABO",
  dailyBudget: 50,
  headlines: ["", ""],
  primaryTexts: ["", ""],
  ctaType: "SHOP_NOW",
  landingPages: [""],
  targetCountries: ["SE"],
  optimizationGoal: "OFFSITE_CONVERSIONS",
  conversionEvent: "PURCHASE",
  bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  pixelId: "",
  productName: "",
  adAccountId: "",
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [adAccounts, setAdAccounts] = useState<AdAccountOption[]>([]);
  const [defaultAdAccountId, setDefaultAdAccountId] = useState<string | null>(null);

  const fetchTemplates = async () => {
    const res = await fetch("/api/templates");
    const data = await res.json();
    setTemplates(data.data || []);
  };

  useEffect(() => { fetchTemplates(); }, []);

  // Ad accounts on the active Meta connection (for the per-template account picker)
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/meta/connection");
        if (!res.ok) return;
        const data = await res.json();
        const active = (data.connections || []).find((c: { isActive: boolean }) => c.isActive);
        setAdAccounts(active?.adAccounts || []);
        setDefaultAdAccountId(active?.activeAdAccountId || null);
      } catch { /* ignore — picker just stays empty */ }
    })();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (t: Template) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      isDefault: t.isDefault,
      objective: t.objective || "OUTCOME_SALES",
      budgetType: t.budgetType || "ABO",
      dailyBudget: t.dailyBudget ?? 50,
      headlines: t.headlines && t.headlines.length > 0 ? [...t.headlines] : ["", ""],
      primaryTexts: t.primaryTexts && t.primaryTexts.length > 0 ? [...t.primaryTexts] : ["", ""],
      ctaType: t.ctaType || "SHOP_NOW",
      landingPages: t.landingPages && t.landingPages.length > 0 ? [...t.landingPages] : [""],
      targetCountries: t.targetCountries && t.targetCountries.length > 0 ? [...t.targetCountries] : ["SE"],
      optimizationGoal: t.optimizationGoal || "OFFSITE_CONVERSIONS",
      conversionEvent: t.conversionEvent || "PURCHASE",
      bidStrategy: t.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
      pixelId: t.pixelId || "",
      productName: t.productName || "",
      adAccountId: t.adAccountId || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Template name is required");
      return;
    }

    try {
      const payload = {
        ...form,
        headlines: form.headlines.filter(Boolean),
        primaryTexts: form.primaryTexts.filter(Boolean),
        landingPages: form.landingPages.filter(Boolean),
        targetCountries: form.targetCountries.filter(Boolean),
        pixelId: form.pixelId || null,
        productName: form.productName || null,
        adAccountId: form.adAccountId || null,
      };

      if (editingId) {
        const res = await fetch("/api/templates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        if (!res.ok) throw new Error();
        toast.success("Template updated");
      } else {
        const res = await fetch("/api/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        toast.success("Template created");
      }
      setDialogOpen(false);
      fetchTemplates();
    } catch {
      toast.error("Failed to save template");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch("/api/templates", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      toast.success("Template deleted");
      fetchTemplates();
    } catch {
      toast.error("Failed to delete template");
    }
  };

  const handleDuplicate = (t: Template) => {
    setEditingId(null);
    setForm({
      name: `${t.name} (Copy)`,
      isDefault: false,
      objective: t.objective || "OUTCOME_SALES",
      budgetType: t.budgetType || "ABO",
      dailyBudget: t.dailyBudget ?? 50,
      headlines: t.headlines && t.headlines.length > 0 ? [...t.headlines] : ["", ""],
      primaryTexts: t.primaryTexts && t.primaryTexts.length > 0 ? [...t.primaryTexts] : ["", ""],
      ctaType: t.ctaType || "SHOP_NOW",
      landingPages: t.landingPages && t.landingPages.length > 0 ? [...t.landingPages] : [""],
      targetCountries: t.targetCountries && t.targetCountries.length > 0 ? [...t.targetCountries] : ["SE"],
      optimizationGoal: t.optimizationGoal || "OFFSITE_CONVERSIONS",
      conversionEvent: t.conversionEvent || "PURCHASE",
      bidStrategy: t.bidStrategy || "LOWEST_COST_WITHOUT_CAP",
      pixelId: t.pixelId || "",
      productName: t.productName || "",
      adAccountId: t.adAccountId || "",
    });
    setDialogOpen(true);
  };

  // ─── List helpers ─────────────────────────────────────────────────────

  const updateListItem = (key: "headlines" | "primaryTexts" | "landingPages" | "targetCountries", index: number, value: string) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].map((v, i) => (i === index ? value : v)) }));
  };

  const addListItem = (key: "headlines" | "primaryTexts" | "landingPages" | "targetCountries", max = 5) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].length < max ? [...prev[key], ""] : prev[key] }));
  };

  const removeListItem = (key: "headlines" | "primaryTexts" | "landingPages" | "targetCountries", index: number) => {
    setForm((prev) => ({ ...prev, [key]: prev[key].length > 1 ? prev[key].filter((_, i) => i !== index) : prev[key] }));
  };

  const isDynamic = (t: Template) =>
    (t.headlines?.filter(Boolean).length || 0) > 1 || (t.primaryTexts?.filter(Boolean).length || 0) > 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText className="h-6 w-6 text-cyan-400" />
            Upload Templates
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Pre-fill headlines, copy, budget, targeting — select on upload page</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all">
          <Plus className="h-4 w-4" /> New Template
        </button>
      </div>

      {/* Template Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className={cn(
            "rounded-xl border overflow-hidden hover:border-white/10 transition-all group",
            t.isDefault ? "border-cyan-500/30 bg-[#111827]" : "border-white/5 bg-[#111827]"
          )}>
            <div className="p-4 space-y-3">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {t.isDefault && <Star className="h-3.5 w-3.5 text-cyan-400 fill-cyan-400 shrink-0" />}
                  <h3 className="text-sm font-semibold text-white truncate">{t.name}</h3>
                </div>
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleDuplicate(t)}
                    className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all" title="Duplicate">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => openEdit(t)}
                    className="p-1.5 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-all" title="Edit">
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(t.id)}
                    className="p-1.5 rounded hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-all" title="Delete">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {t.targetCountries?.map((c) => (
                  <span key={c} className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">{c}</span>
                ))}
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
                  {t.budgetType} {t.dailyBudget ? `${t.dailyBudget} SEK` : ""}
                </span>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-white/5 text-slate-400 border border-white/10">
                  {(t.ctaType || "SHOP_NOW").replace(/_/g, " ")}
                </span>
                {isDynamic(t) && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    Dynamic Creative
                  </span>
                )}
              </div>

              {/* Ad Copy Preview */}
              {(t.headlines?.length > 0 || t.primaryTexts?.length > 0) && (
                <div className="space-y-2 pt-1">
                  {t.headlines?.filter(Boolean).length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <Type className="h-3 w-3 text-slate-600" />
                        <span className="text-[9px] font-medium text-slate-600 uppercase">Headlines</span>
                      </div>
                      {t.headlines.filter(Boolean).map((h, i) => (
                        <p key={i} className="text-xs text-slate-300 truncate pl-4">{h}</p>
                      ))}
                    </div>
                  )}
                  {t.primaryTexts?.filter(Boolean).length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <MessageSquare className="h-3 w-3 text-slate-600" />
                        <span className="text-[9px] font-medium text-slate-600 uppercase">Primary Texts</span>
                      </div>
                      {t.primaryTexts.filter(Boolean).map((p, i) => (
                        <p key={i} className="text-xs text-slate-400 truncate pl-4">{p}</p>
                      ))}
                    </div>
                  )}
                  {t.landingPages?.filter(Boolean).length > 0 && (
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        <Globe className="h-3 w-3 text-slate-600" />
                        <span className="text-[9px] font-medium text-slate-600 uppercase">Landing Pages</span>
                      </div>
                      {t.landingPages.filter(Boolean).map((lp, i) => (
                        <p key={i} className="text-xs text-cyan-400/70 truncate pl-4">{lp}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Click to edit footer */}
            <button onClick={() => openEdit(t)}
              className="w-full py-2 text-[10px] text-slate-600 hover:text-slate-400 hover:bg-white/[0.02] border-t border-white/[0.03] transition-all">
              Click to edit
            </button>
          </div>
        ))}
        {templates.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-500">
            No templates yet. Create your first template to speed up uploads.
          </div>
        )}
      </div>

      {/* ─── Create/Edit Dialog ─── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[96vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto bg-[#0f1623] border-white/10">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              {editingId ? "Edit Template" : "Create Template"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Name + Default */}
            <div className="flex gap-4 items-end">
              <div className="flex-1 space-y-1.5">
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Template Name</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="bg-white/5 border-white/10 placeholder:text-slate-600" placeholder="e.g. SE Reluma LP3" />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch checked={form.isDefault} onCheckedChange={(v) => setForm({ ...form, isDefault: v })} />
                <label className="text-xs text-slate-400">Default</label>
              </div>
            </div>

            {/* ─── AD ACCOUNT ─── */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Annonskonto</label>
              <select
                value={form.adAccountId}
                onChange={(e) => setForm({ ...form, adAccountId: e.target.value })}
                className="w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm text-white [color-scheme:dark]"
              >
                <option value="">Kontots standard{defaultAdAccountId ? ` (${adAccounts.find((a) => a.id === defaultAdAccountId || `act_${a.id}` === defaultAdAccountId || a.id === `act_${defaultAdAccountId}`)?.name || defaultAdAccountId})` : ""}</option>
                {adAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.id.startsWith("act_") ? a.id : `act_${a.id}`} ({a.currency})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-600">
                Alla uploads med den här templaten skapas i valt konto (kampanjer/ad sets listas därifrån). Tomt = aktiva kontot i Settings.
              </p>
            </div>

            {/* ─── AD COPY ─── */}
            <div className="rounded-lg border border-cyan-500/10 bg-cyan-500/[0.02] p-4 space-y-4">
              <h3 className="text-xs font-medium text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" /> Ad Copy
              </h3>

              {/* Headlines */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">Headlines ({form.headlines.filter(Boolean).length}/5)</label>
                  {form.headlines.length < 5 && (
                    <button onClick={() => addListItem("headlines")}
                      className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300">
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {form.headlines.map((h, i) => (
                    <div key={i} className="flex gap-1.5">
                      <Input
                        value={h}
                        onChange={(e) => updateListItem("headlines", i, e.target.value)}
                        placeholder={`Headline ${i + 1}`}
                        className="bg-white/5 border-white/10 placeholder:text-slate-600 flex-1"
                      />
                      {form.headlines.length > 1 && (
                        <button onClick={() => removeListItem("headlines", i)}
                          className="px-2 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/5 transition-colors">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Primary Texts */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">Primary Texts ({form.primaryTexts.filter(Boolean).length}/5)</label>
                  {form.primaryTexts.length < 5 && (
                    <button onClick={() => addListItem("primaryTexts")}
                      className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300">
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {form.primaryTexts.map((t, i) => (
                    <div key={i} className="flex gap-1.5">
                      <Textarea
                        value={t}
                        onChange={(e) => updateListItem("primaryTexts", i, e.target.value)}
                        placeholder={`Primary text ${i + 1}`}
                        rows={2}
                        className="bg-white/5 border-white/10 placeholder:text-slate-600 flex-1 resize-none"
                      />
                      {form.primaryTexts.length > 1 && (
                        <button onClick={() => removeListItem("primaryTexts", i)}
                          className="px-2 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/5 transition-colors self-start mt-2">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">CTA Button</label>
                  <Select value={form.ctaType} onValueChange={(v) => setForm({ ...form, ctaType: v })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="SHOP_NOW">Shop Now</SelectItem>
                      <SelectItem value="LEARN_MORE">Learn More</SelectItem>
                      <SelectItem value="BUY_NOW">Buy Now</SelectItem>
                      <SelectItem value="ORDER_NOW">Order Now</SelectItem>
                      <SelectItem value="GET_OFFER">Get Offer</SelectItem>
                      <SelectItem value="SIGN_UP">Sign Up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Product Name (optional)</label>
                  <Input value={form.productName} onChange={(e) => setForm({ ...form, productName: e.target.value })}
                    className="bg-white/5 border-white/10 placeholder:text-slate-600" placeholder="e.g. Reluma" />
                </div>
              </div>
            </div>

            {/* ─── LANDING PAGES ─── */}
            <div className="rounded-lg border border-white/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" /> Landing Pages ({form.landingPages.filter(Boolean).length})
                </h3>
                <button onClick={() => addListItem("landingPages")}
                  className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300">
                  <Plus className="h-3 w-3" /> Add
                </button>
              </div>
              {form.landingPages.map((lp, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input value={lp} onChange={(e) => updateListItem("landingPages", i, e.target.value)}
                    placeholder="https://apotekhunden.se/..." className="bg-white/5 border-white/10 placeholder:text-slate-600 flex-1" />
                  {form.landingPages.length > 1 && (
                    <button onClick={() => removeListItem("landingPages", i)}
                      className="px-2 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/5 transition-colors">
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* ─── CAMPAIGN & TARGETING ─── */}
            <div className="rounded-lg border border-white/5 p-4 space-y-4">
              <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Campaign & Targeting
              </h3>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">Objective</label>
                  <Select value={form.objective} onValueChange={(v) => setForm({ ...form, objective: v })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="OUTCOME_SALES">Sales</SelectItem>
                      <SelectItem value="OUTCOME_LEADS">Leads</SelectItem>
                      <SelectItem value="OUTCOME_TRAFFIC">Traffic</SelectItem>
                      <SelectItem value="OUTCOME_AWARENESS">Awareness</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">Budget Type</label>
                  <Select value={form.budgetType} onValueChange={(v) => setForm({ ...form, budgetType: v })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="ABO">ABO (Ad Set Budget)</SelectItem>
                      <SelectItem value="CBO">CBO (Campaign Budget)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">Daily Budget (SEK)</label>
                  <Input type="number" value={String(form.dailyBudget ?? "")}
                    onChange={(e) => setForm({ ...form, dailyBudget: e.target.value ? Number(e.target.value) : null })}
                    className="bg-white/5 border-white/10" placeholder="50" />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">Optimization</label>
                  <Select value={form.optimizationGoal} onValueChange={(v) => setForm({ ...form, optimizationGoal: v })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="OFFSITE_CONVERSIONS">Conversions</SelectItem>
                      <SelectItem value="LANDING_PAGE_VIEWS">Landing Page Views</SelectItem>
                      <SelectItem value="LINK_CLICKS">Link Clicks</SelectItem>
                      <SelectItem value="IMPRESSIONS">Impressions</SelectItem>
                      <SelectItem value="REACH">Reach</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">Conversion Event</label>
                  <Select value={form.conversionEvent} onValueChange={(v) => setForm({ ...form, conversionEvent: v })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="PURCHASE">Purchase</SelectItem>
                      <SelectItem value="ADD_TO_CART">Add to Cart</SelectItem>
                      <SelectItem value="INITIATE_CHECKOUT">Initiate Checkout</SelectItem>
                      <SelectItem value="VIEW_CONTENT">View Content</SelectItem>
                      <SelectItem value="LEAD">Lead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-500">Bid Strategy</label>
                  <Select value={form.bidStrategy} onValueChange={(v) => setForm({ ...form, bidStrategy: v })}>
                    <SelectTrigger className="bg-white/5 border-white/10"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-[#111827] border-white/10">
                      <SelectItem value="LOWEST_COST_WITHOUT_CAP">Lowest Cost</SelectItem>
                      <SelectItem value="COST_CAP">Cost Cap</SelectItem>
                      <SelectItem value="BID_CAP">Bid Cap</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Countries */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-500">Target Countries</label>
                  {form.targetCountries.length < 6 && (
                    <button onClick={() => addListItem("targetCountries", 6)}
                      className="flex items-center gap-0.5 text-[10px] text-cyan-400 hover:text-cyan-300">
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {form.targetCountries.map((c, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <Select value={c} onValueChange={(v) => updateListItem("targetCountries", i, v)}>
                        <SelectTrigger className="bg-white/5 border-white/10 w-[150px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-[#111827] border-white/10">
                          <SelectItem value="BIG5">🌍 BIG 5</SelectItem>
                          <SelectItem value="SE">Sweden</SelectItem>
                          <SelectItem value="NO">Norway</SelectItem>
                          <SelectItem value="DK">Denmark</SelectItem>
                          <SelectItem value="FI">Finland</SelectItem>
                          <SelectItem value="US">United States</SelectItem>
                          <SelectItem value="CA">Canada</SelectItem>
                          <SelectItem value="GB">United Kingdom</SelectItem>
                          <SelectItem value="AU">Australia</SelectItem>
                          <SelectItem value="NZ">New Zealand</SelectItem>
                          <SelectItem value="DE">Germany</SelectItem>
                          <SelectItem value="NL">Netherlands</SelectItem>
                        </SelectContent>
                      </Select>
                      {form.targetCountries.length > 1 && (
                        <button onClick={() => removeListItem("targetCountries", i)}
                          className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors">
                          <Minus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <button onClick={() => setDialogOpen(false)}
              className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-all">
              Cancel
            </button>
            <button onClick={handleSave}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-cyan-600 text-sm font-medium text-white hover:from-cyan-400 hover:to-cyan-500 transition-all">
              {editingId ? "Save Changes" : "Create Template"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
