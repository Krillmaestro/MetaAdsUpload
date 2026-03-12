"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TemplateSelector } from "./template-selector";
import { CreativePicker } from "./creative-picker";
import { campaignName, adsetName, adName } from "@/lib/naming";
import { ArrowLeft, ArrowRight, Plus, Save, Upload } from "lucide-react";

interface WizardData {
  // Template
  templateId: number | null;
  // Campaign
  campaignName: string;
  objective: string;
  budgetType: string;
  dailyBudget: number;
  // Ad Set
  adsetName: string;
  country: string;
  product: string;
  audience: string;
  ageMin: number;
  ageMax: number;
  genders: number[];
  optimizationGoal: string;
  conversionEvent: string;
  bidStrategy: string;
  // Creative
  file: File | null;
  fileSource: string;
  headlines: string[];
  primaryTexts: string[];
  descriptions: string[];
  linkUrl: string;
  ctaType: string;
  angle: string;
  hook: string;
  format: string;
  // Ad
  adNameValue: string;
}

const defaultData: WizardData = {
  templateId: null,
  campaignName: "",
  objective: "OUTCOME_SALES",
  budgetType: "ABO",
  dailyBudget: 50,
  adsetName: "",
  country: "SE",
  product: "",
  audience: "Broad",
  ageMin: 25,
  ageMax: 54,
  genders: [0],
  optimizationGoal: "OFFSITE_CONVERSIONS",
  conversionEvent: "Purchase",
  bidStrategy: "LOWEST_COST_WITHOUT_CAP",
  file: null,
  fileSource: "",
  headlines: [""],
  primaryTexts: [""],
  descriptions: [""],
  linkUrl: "",
  ctaType: "SHOP_NOW",
  angle: "",
  hook: "Hook1",
  format: "Reel",
  adNameValue: "",
};

const steps = ["Template", "Campaign", "Ad Set", "Creative", "Review"];

interface UploadWizardProps {
  onAddToQueue: (config: Record<string, unknown>) => void;
  onSaveTemplate: (data: Record<string, unknown>) => void;
}

export function UploadWizard({ onAddToQueue, onSaveTemplate }: UploadWizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(defaultData);

  const update = <K extends keyof WizardData>(key: K, value: WizardData[K]) => {
    setData((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-generate names
      if (["country", "product", "budgetType"].includes(key as string)) {
        next.campaignName = campaignName({ country: next.country, product: next.product, type: next.budgetType === "CBO" ? "CBO" : "CT" });
      }
      if (["country", "product", "audience", "optimizationGoal"].includes(key as string)) {
        next.adsetName = adsetName({ country: next.country, product: next.product, audience: next.audience });
      }
      if (["product", "angle", "hook", "format"].includes(key as string)) {
        next.adNameValue = adName({ product: next.product, angle: next.angle, hook: next.hook, format: next.format });
      }
      return next;
    });
  };

  const addListItem = (key: "headlines" | "primaryTexts" | "descriptions") => {
    setData((prev) => ({ ...prev, [key]: [...prev[key], ""] }));
  };

  const updateListItem = (key: "headlines" | "primaryTexts" | "descriptions", index: number, value: string) => {
    setData((prev) => {
      const arr = [...prev[key]];
      arr[index] = value;
      return { ...prev, [key]: arr };
    });
  };

  const handleSubmit = async () => {
    // Convert file to base64 if present
    let imageBase64: string | undefined;
    let videoBase64: string | undefined;
    if (data.file) {
      const buffer = await data.file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      if (data.file.type.startsWith("video/")) {
        videoBase64 = base64;
      } else {
        imageBase64 = base64;
      }
    }

    const config = {
      campaign: {
        name: data.campaignName,
        objective: data.objective,
        budgetType: data.budgetType,
        dailyBudget: data.dailyBudget,
      },
      adset: {
        name: data.adsetName,
        dailyBudget: data.dailyBudget * 100,
        targeting: {
          geo_locations: { countries: [data.country] },
          age_min: data.ageMin,
          age_max: data.ageMax,
          genders: data.genders[0] === 0 ? undefined : data.genders,
        },
        optimizationGoal: data.optimizationGoal,
        conversionEvent: data.conversionEvent,
        bidStrategy: data.bidStrategy,
      },
      creative: {
        headlines: data.headlines.filter(Boolean),
        primaryTexts: data.primaryTexts.filter(Boolean),
        descriptions: data.descriptions.filter(Boolean),
        linkUrl: data.linkUrl,
        ctaType: data.ctaType,
        filename: data.file?.name,
        imageBase64,
        videoBase64,
      },
      ad: {
        name: data.adNameValue,
      },
    };

    onAddToQueue(config);
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <button
              onClick={() => setStep(i)}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}
            </button>
            <span className={`text-sm ${i === step ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
            {i < steps.length - 1 && <Separator className="w-8" />}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 0 && (
        <TemplateSelector
          selected={null}
          onSelect={(t) => {
            if (t) {
              setData((prev) => ({
                ...prev,
                templateId: t.id,
                objective: t.objective,
                budgetType: t.budgetType,
                dailyBudget: t.dailyBudget || prev.dailyBudget,
                headlines: t.headlines.length > 0 ? t.headlines : prev.headlines,
                primaryTexts: t.primaryTexts.length > 0 ? t.primaryTexts : prev.primaryTexts,
                linkUrl: t.linkUrl || prev.linkUrl,
                ctaType: t.ctaType,
              }));
            }
            setStep(1);
          }}
        />
      )}

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>Campaign Setup</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Product Name</Label>
                <Input value={data.product} onChange={(e) => update("product", e.target.value)} placeholder="e.g., Reluma" />
              </div>
              <div className="space-y-2">
                <Label>Campaign Name (auto)</Label>
                <Input value={data.campaignName} onChange={(e) => update("campaignName", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Objective</Label>
                <Select value={data.objective} onValueChange={(v) => update("objective", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OUTCOME_SALES">Sales</SelectItem>
                    <SelectItem value="OUTCOME_LEADS">Leads</SelectItem>
                    <SelectItem value="OUTCOME_TRAFFIC">Traffic</SelectItem>
                    <SelectItem value="OUTCOME_AWARENESS">Awareness</SelectItem>
                    <SelectItem value="OUTCOME_ENGAGEMENT">Engagement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Budget Type</Label>
                <Select value={data.budgetType} onValueChange={(v) => update("budgetType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ABO">Ad Set Budget (ABO)</SelectItem>
                    <SelectItem value="CBO">Campaign Budget (CBO)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Daily Budget (SEK)</Label>
                <Input type="number" value={data.dailyBudget} onChange={(e) => update("dailyBudget", Number(e.target.value))} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>Ad Set Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Audience Name</Label>
                <Input value={data.audience} onChange={(e) => update("audience", e.target.value)} placeholder="e.g., BroadF2554" />
              </div>
              <div className="space-y-2">
                <Label>Ad Set Name (auto)</Label>
                <Input value={data.adsetName} onChange={(e) => update("adsetName", e.target.value)} />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="space-y-2">
                <Label>Country</Label>
                <Select value={data.country} onValueChange={(v) => update("country", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SE">Sweden</SelectItem>
                    <SelectItem value="NO">Norway</SelectItem>
                    <SelectItem value="DK">Denmark</SelectItem>
                    <SelectItem value="FI">Finland</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Age Min</Label>
                <Input type="number" value={data.ageMin} onChange={(e) => update("ageMin", Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Age Max</Label>
                <Input type="number" value={data.ageMax} onChange={(e) => update("ageMax", Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={String(data.genders[0])} onValueChange={(v) => update("genders", [Number(v)])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">All</SelectItem>
                    <SelectItem value="1">Male</SelectItem>
                    <SelectItem value="2">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Optimization Goal</Label>
                <Select value={data.optimizationGoal} onValueChange={(v) => update("optimizationGoal", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OFFSITE_CONVERSIONS">Conversions</SelectItem>
                    <SelectItem value="LANDING_PAGE_VIEWS">Landing Page Views</SelectItem>
                    <SelectItem value="LINK_CLICKS">Link Clicks</SelectItem>
                    <SelectItem value="IMPRESSIONS">Impressions</SelectItem>
                    <SelectItem value="REACH">Reach</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Conversion Event</Label>
                <Select value={data.conversionEvent} onValueChange={(v) => update("conversionEvent", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Purchase">Purchase</SelectItem>
                    <SelectItem value="AddToCart">Add to Cart</SelectItem>
                    <SelectItem value="InitiateCheckout">Initiate Checkout</SelectItem>
                    <SelectItem value="ViewContent">View Content</SelectItem>
                    <SelectItem value="Lead">Lead</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bid Strategy</Label>
                <Select value={data.bidStrategy} onValueChange={(v) => update("bidStrategy", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LOWEST_COST_WITHOUT_CAP">Lowest Cost</SelectItem>
                    <SelectItem value="LOWEST_COST_WITH_BID_CAP">Bid Cap</SelectItem>
                    <SelectItem value="COST_CAP">Cost Cap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <CreativePicker
            selectedFile={data.file}
            onFileSelect={(file, source) => {
              setData((prev) => ({ ...prev, file, fileSource: source }));
            }}
          />
          <Card>
            <CardHeader><CardTitle>Ad Copy</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Headlines</Label>
                  <Button variant="ghost" size="sm" onClick={() => addListItem("headlines")}>
                    <Plus className="mr-1 h-3 w-3" /> Add
                  </Button>
                </div>
                {data.headlines.map((h, i) => (
                  <Input key={i} value={h} onChange={(e) => updateListItem("headlines", i, e.target.value)} placeholder={`Headline ${i + 1}`} />
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Primary Texts</Label>
                  <Button variant="ghost" size="sm" onClick={() => addListItem("primaryTexts")}>
                    <Plus className="mr-1 h-3 w-3" /> Add
                  </Button>
                </div>
                {data.primaryTexts.map((t, i) => (
                  <Textarea key={i} value={t} onChange={(e) => updateListItem("primaryTexts", i, e.target.value)} placeholder={`Primary text ${i + 1}`} rows={3} />
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Link URL</Label>
                  <Input value={data.linkUrl} onChange={(e) => update("linkUrl", e.target.value)} placeholder="https://apotekhunden.se/..." />
                </div>
                <div className="space-y-2">
                  <Label>CTA Button</Label>
                  <Select value={data.ctaType} onValueChange={(v) => update("ctaType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SHOP_NOW">Shop Now</SelectItem>
                      <SelectItem value="LEARN_MORE">Learn More</SelectItem>
                      <SelectItem value="SIGN_UP">Sign Up</SelectItem>
                      <SelectItem value="BUY_NOW">Buy Now</SelectItem>
                      <SelectItem value="ORDER_NOW">Order Now</SelectItem>
                      <SelectItem value="GET_OFFER">Get Offer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Angle</Label>
                  <Input value={data.angle} onChange={(e) => update("angle", e.target.value)} placeholder="e.g., SkinAging" />
                </div>
                <div className="space-y-2">
                  <Label>Hook</Label>
                  <Input value={data.hook} onChange={(e) => update("hook", e.target.value)} placeholder="e.g., Hook3" />
                </div>
                <div className="space-y-2">
                  <Label>Format</Label>
                  <Select value={data.format} onValueChange={(v) => update("format", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Reel">Reel</SelectItem>
                      <SelectItem value="Story">Story</SelectItem>
                      <SelectItem value="Feed">Feed</SelectItem>
                      <SelectItem value="Square">Square</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ad Name (auto)</Label>
                <Input value={data.adNameValue} onChange={(e) => update("adNameValue", e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 4 && (
        <Card>
          <CardHeader><CardTitle>Review & Queue</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-medium">Campaign</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> {data.campaignName}</p>
                  <p><span className="text-muted-foreground">Objective:</span> {data.objective}</p>
                  <p><span className="text-muted-foreground">Budget:</span> {data.dailyBudget} SEK/day ({data.budgetType})</p>
                </div>
              </div>
              <div>
                <h3 className="mb-2 font-medium">Ad Set</h3>
                <div className="space-y-1 text-sm">
                  <p><span className="text-muted-foreground">Name:</span> {data.adsetName}</p>
                  <p><span className="text-muted-foreground">Targeting:</span> {data.country}, {data.ageMin}-{data.ageMax}</p>
                  <p><span className="text-muted-foreground">Optimization:</span> {data.optimizationGoal}</p>
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="mb-2 font-medium">Creative & Copy</h3>
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">File:</span> {data.file?.name || "None"}</p>
                <p><span className="text-muted-foreground">Headlines:</span> {data.headlines.filter(Boolean).join(" | ")}</p>
                <p><span className="text-muted-foreground">Primary Texts:</span> {data.primaryTexts.filter(Boolean).length} variants</p>
                <p><span className="text-muted-foreground">Link:</span> {data.linkUrl}</p>
                <p><span className="text-muted-foreground">CTA:</span> {data.ctaType}</p>
                <p><span className="text-muted-foreground">Ad Name:</span> {data.adNameValue}</p>
              </div>
            </div>
            <Separator />
            <div className="flex gap-2">
              <Button onClick={handleSubmit}>
                <Upload className="mr-2 h-4 w-4" /> Add to Queue
              </Button>
              <Button variant="outline" onClick={() => onSaveTemplate({
                name: data.campaignName,
                objective: data.objective,
                budgetType: data.budgetType,
                dailyBudget: data.dailyBudget,
                headlines: data.headlines.filter(Boolean),
                primaryTexts: data.primaryTexts.filter(Boolean),
                descriptions: data.descriptions.filter(Boolean),
                linkUrl: data.linkUrl,
                ctaType: data.ctaType,
              })}>
                <Save className="mr-2 h-4 w-4" /> Save as Template
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        {step < 4 && (
          <Button onClick={() => setStep((s) => Math.min(4, s + 1))}>
            Next <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
