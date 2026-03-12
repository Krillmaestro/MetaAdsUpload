"use client";

import { CampaignTree } from "@/components/campaigns/campaign-tree";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export default function CampaignsPage() {
  const handleEmergencyStop = async () => {
    if (!confirm("Are you sure you want to PAUSE ALL active campaigns?")) return;
    try {
      const res = await fetch("/api/meta/campaigns");
      const data = await res.json();
      const active = (data.data || []).filter((c: { status: string }) => c.status === "ACTIVE");

      for (const campaign of active) {
        await fetch("/api/meta/campaigns", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: campaign.id, status: "PAUSED" }),
        });
      }
      toast.success(`Paused ${active.length} campaigns`);
    } catch {
      toast.error("Emergency stop failed");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Campaign Management</h2>
        <Button variant="destructive" onClick={handleEmergencyStop}>
          <AlertTriangle className="mr-2 h-4 w-4" /> Emergency Stop
        </Button>
      </div>
      <CampaignTree />
    </div>
  );
}
