export interface Condition {
  metric: string;
  operator: ">" | "<" | ">=" | "<=" | "==" | "!=";
  value: number;
  timeRange: string; // e.g., "3d", "7d", "14d", "30d"
}

export interface RuleAction {
  type: "pause" | "activate" | "adjust_budget" | "alert" | "tag";
  value?: number; // e.g., 20 for +20%, -30 for -30%
}

export function evaluateCondition(
  condition: Condition,
  metricValue: number
): boolean {
  switch (condition.operator) {
    case ">": return metricValue > condition.value;
    case "<": return metricValue < condition.value;
    case ">=": return metricValue >= condition.value;
    case "<=": return metricValue <= condition.value;
    case "==": return metricValue === condition.value;
    case "!=": return metricValue !== condition.value;
    default: return false;
  }
}

export function evaluateAllConditions(
  conditions: Condition[],
  metrics: Record<string, number>
): boolean {
  return conditions.every((c) => {
    const val = metrics[c.metric];
    return val !== undefined && evaluateCondition(c, val);
  });
}
