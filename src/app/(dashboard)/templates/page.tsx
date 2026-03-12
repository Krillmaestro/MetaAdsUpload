"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";

interface Template {
  id: number;
  name: string;
  objective: string;
  budgetType: string;
  dailyBudget: number | null;
  headlines: string[];
  primaryTexts: string[];
  descriptions: string[];
  linkUrl: string | null;
  ctaType: string;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    objective: "OUTCOME_SALES",
    budgetType: "ABO",
    dailyBudget: 50,
    headlines: [""],
    primaryTexts: [""],
    linkUrl: "",
    ctaType: "SHOP_NOW",
  });

  const fetchTemplates = async () => {
    const res = await fetch("/api/templates");
    const data = await res.json();
    setTemplates(data.data || []);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleCreate = async () => {
    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          headlines: form.headlines.filter(Boolean),
          primaryTexts: form.primaryTexts.filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Template created");
      setDialogOpen(false);
      setForm({ name: "", objective: "OUTCOME_SALES", budgetType: "ABO", dailyBudget: 50, headlines: [""], primaryTexts: [""], linkUrl: "", ctaType: "SHOP_NOW" });
      fetchTemplates();
    } catch {
      toast.error("Failed to create template");
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Upload Templates</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="mr-2 h-4 w-4" /> New Template
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Template Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Objective</Label>
                  <Select value={form.objective} onValueChange={(v) => setForm({ ...form, objective: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OUTCOME_SALES">Sales</SelectItem>
                      <SelectItem value="OUTCOME_LEADS">Leads</SelectItem>
                      <SelectItem value="OUTCOME_TRAFFIC">Traffic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Budget Type</Label>
                  <Select value={form.budgetType} onValueChange={(v) => setForm({ ...form, budgetType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ABO">ABO</SelectItem>
                      <SelectItem value="CBO">CBO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Daily Budget (SEK)</Label>
                  <Input type="number" value={form.dailyBudget} onChange={(e) => setForm({ ...form, dailyBudget: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Headlines</Label>
                {form.headlines.map((h, i) => (
                  <Input key={i} value={h} onChange={(e) => {
                    const arr = [...form.headlines]; arr[i] = e.target.value;
                    setForm({ ...form, headlines: arr });
                  }} placeholder={`Headline ${i + 1}`} />
                ))}
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, headlines: [...form.headlines, ""] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add Headline
                </Button>
              </div>
              <div className="space-y-2">
                <Label>Primary Texts</Label>
                {form.primaryTexts.map((t, i) => (
                  <Textarea key={i} value={t} onChange={(e) => {
                    const arr = [...form.primaryTexts]; arr[i] = e.target.value;
                    setForm({ ...form, primaryTexts: arr });
                  }} placeholder={`Text ${i + 1}`} rows={2} />
                ))}
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, primaryTexts: [...form.primaryTexts, ""] })}>
                  <Plus className="mr-1 h-3 w-3" /> Add Text
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Link URL</Label>
                  <Input value={form.linkUrl} onChange={(e) => setForm({ ...form, linkUrl: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>CTA</Label>
                  <Select value={form.ctaType} onValueChange={(v) => setForm({ ...form, ctaType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SHOP_NOW">Shop Now</SelectItem>
                      <SelectItem value="LEARN_MORE">Learn More</SelectItem>
                      <SelectItem value="BUY_NOW">Buy Now</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button className="w-full" onClick={handleCreate}>Create Template</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <CardTitle className="text-base">{t.name}</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => handleDelete(t.id)}>
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Badge variant="secondary">{t.objective.replace("OUTCOME_", "")}</Badge>
                <Badge variant="outline">{t.budgetType}</Badge>
                {t.dailyBudget && <Badge variant="outline">{t.dailyBudget} SEK</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {t.headlines.length} headlines, {t.primaryTexts.length} texts
              </p>
              {t.linkUrl && <p className="truncate text-xs text-muted-foreground">{t.linkUrl}</p>}
            </CardContent>
          </Card>
        ))}
        {templates.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground">
            No templates yet. Create your first template to speed up uploads.
          </div>
        )}
      </div>
    </div>
  );
}
