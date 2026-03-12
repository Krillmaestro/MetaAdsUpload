import { updateCampaign } from "@/lib/meta/campaigns";
import { updateAdSet } from "@/lib/meta/adsets";
import { updateAd } from "@/lib/meta/ads";
import type { RuleAction } from "./conditions";

export async function executeAction(
  action: RuleAction,
  entityId: string,
  entityType: "campaign" | "adset" | "ad",
  currentBudget?: number
): Promise<string> {
  const updateFn =
    entityType === "campaign" ? updateCampaign :
    entityType === "adset" ? updateAdSet :
    updateAd;

  switch (action.type) {
    case "pause":
      await updateFn(entityId, { status: "PAUSED" });
      return `Paused ${entityType} ${entityId}`;

    case "activate":
      await updateFn(entityId, { status: "ACTIVE" });
      return `Activated ${entityType} ${entityId}`;

    case "adjust_budget": {
      if (!currentBudget || !action.value) return "No budget adjustment needed";
      const multiplier = 1 + action.value / 100;
      const newBudget = Math.round(currentBudget * multiplier);
      await updateFn(entityId, { daily_budget: newBudget });
      return `Adjusted budget from ${currentBudget} to ${newBudget} (${action.value > 0 ? "+" : ""}${action.value}%)`;
    }

    case "alert":
      return `Alert: ${entityType} ${entityId} triggered rule`;

    case "tag":
      return `Tagged ${entityType} ${entityId}`;

    default:
      return "Unknown action";
  }
}
