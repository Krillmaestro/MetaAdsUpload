"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";

interface Template {
  id: number;
  name: string;
  objective: string;
  budgetType: string;
  dailyBudget: number | null;
  headlines: string[];
  primaryTexts: string[];
  linkUrl: string | null;
  ctaType: string;
}

interface TemplateSelectorProps {
  onSelect: (template: Template | null) => void;
  selected: Template | null;
}

export function TemplateSelector({ onSelect, selected }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setTemplates(d.data || []))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card
          className={`cursor-pointer transition-colors hover:border-primary ${!selected ? "border-primary bg-primary/5" : ""}`}
          onClick={() => onSelect(null)}
        >
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Plus className="mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">Start from Scratch</p>
          </CardContent>
        </Card>

        {templates.map((t) => (
          <Card
            key={t.id}
            className={`cursor-pointer transition-colors hover:border-primary ${selected?.id === t.id ? "border-primary bg-primary/5" : ""}`}
            onClick={() => onSelect(t)}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-2">
                <Badge variant="secondary">{t.objective}</Badge>
                <Badge variant="outline">{t.budgetType}</Badge>
              </div>
              {t.dailyBudget && (
                <p className="text-xs text-muted-foreground">{t.dailyBudget} SEK/day</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t.headlines.length} headlines, {t.primaryTexts.length} texts
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
