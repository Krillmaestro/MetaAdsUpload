import { db, schema } from "@/db";
import { eq, and, gte } from "drizzle-orm";
import { evaluateAllConditions } from "./conditions";
import { executeAction } from "./actions";

export async function runAllRules() {
  const rules = await db.select().from(schema.automationRules).where(eq(schema.automationRules.enabled, true));
  const results: Array<{ ruleId: number; entityId: string; action: string }> = [];

  for (const rule of rules) {
    const conditions = rule.conditions as Array<{ metric: string; operator: string; value: number; timeRange: string }>;
    const action = rule.action as { type: string; value?: number };

    // Get entities based on level
    let entities: Array<{ id: string; daily_budget: number | null }> = [];
    if (rule.level === "campaign") {
      const campaigns = await db.select().from(schema.campaignsCache);
      entities = campaigns.map((c) => ({ id: c.id, daily_budget: c.dailyBudget }));
    } else if (rule.level === "adset") {
      const adsets = await db.select().from(schema.adsetsCache);
      entities = adsets.map((a) => ({ id: a.id, daily_budget: a.dailyBudget }));
    } else {
      const ads = await db.select().from(schema.adsCache);
      entities = ads.map((a) => ({ id: a.id, daily_budget: null }));
    }

    for (const entity of entities) {
      // Check cooldown
      const cooldownDate = new Date(Date.now() - (rule.cooldownHours || 24) * 60 * 60 * 1000);
      const recentExecs = await db.select().from(schema.ruleExecutions).where(
        and(
          eq(schema.ruleExecutions.ruleId, rule.id),
          eq(schema.ruleExecutions.entityId, entity.id),
          gte(schema.ruleExecutions.executedAt, cooldownDate)
        )
      );
      if (recentExecs.length > 0) continue;

      // Get aggregated metrics for entity
      const insightRows = await db.select().from(schema.insights).where(
        eq(schema.insights.entityId, entity.id)
      );

      if (insightRows.length === 0) continue;

      const metrics: Record<string, number> = {};
      let totalSpend = 0, totalPurchaseValue = 0, totalImpressions = 0;
      let totalLinkClicks = 0, totalPurchases = 0, totalVideoViews3s = 0;

      for (const row of insightRows) {
        totalSpend += row.spend || 0;
        totalPurchaseValue += row.purchaseValue || 0;
        totalImpressions += row.impressions || 0;
        totalLinkClicks += row.linkClicks || 0;
        totalPurchases += row.purchases || 0;
        totalVideoViews3s += row.videoViews3s || 0;
      }

      metrics.spend = totalSpend;
      metrics.roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;
      metrics.ctr = totalImpressions > 0 ? (totalLinkClicks / totalImpressions) * 100 : 0;
      metrics.cpa = totalPurchases > 0 ? totalSpend / totalPurchases : 0;
      metrics.purchases = totalPurchases;
      metrics.hook_rate = totalImpressions > 0 ? (totalVideoViews3s / totalImpressions) * 100 : 0;
      metrics.impressions = totalImpressions;

      const conditionsTyped = conditions.map((c) => ({
        ...c,
        operator: c.operator as ">" | "<" | ">=" | "<=" | "==" | "!=",
      }));

      if (evaluateAllConditions(conditionsTyped, metrics)) {
        const actionTyped = { type: action.type as "pause" | "activate" | "adjust_budget" | "alert" | "tag", value: action.value };
        const result = await executeAction(actionTyped, entity.id, rule.level as "campaign" | "adset" | "ad", entity.daily_budget || undefined);

        await db.insert(schema.ruleExecutions).values({
          ruleId: rule.id,
          entityId: entity.id,
          entityType: rule.level,
          actionTaken: result,
        });

        results.push({ ruleId: rule.id, entityId: entity.id, action: result });
      }
    }
  }

  return results;
}
