"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, Eye, MousePointerClick, TrendingUp, Target } from "lucide-react";

interface KPICardsProps {
  summary: {
    spend: number;
    impressions: number;
    linkClicks: number;
    ctr: number;
    roas: number;
  } | null;
  loading: boolean;
}

export function KPICards({ summary, loading }: KPICardsProps) {
  const cards = [
    {
      title: "Total Spend",
      value: summary ? `${summary.spend.toLocaleString("sv-SE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} SEK` : "-",
      icon: DollarSign,
    },
    {
      title: "Impressions",
      value: summary ? summary.impressions.toLocaleString("sv-SE") : "-",
      icon: Eye,
    },
    {
      title: "Link Clicks",
      value: summary ? summary.linkClicks.toLocaleString("sv-SE") : "-",
      icon: MousePointerClick,
    },
    {
      title: "CTR",
      value: summary ? `${summary.ctr.toFixed(2)}%` : "-",
      icon: Target,
    },
    {
      title: "ROAS",
      value: summary ? `${summary.roas.toFixed(2)}x` : "-",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
            <card.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${loading ? "animate-pulse" : ""}`}>
              {loading ? "..." : card.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
