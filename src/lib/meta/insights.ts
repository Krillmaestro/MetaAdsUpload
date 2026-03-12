import { metaApi, getAdAccountId } from "./client";

export interface InsightData {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: Array<{ action_type: string; value: string }>;
  action_values?: Array<{ action_type: string; value: string }>;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  video_30_sec_watched_actions?: Array<{ action_type: string; value: string }>;
  video_avg_time_watched_actions?: Array<{ action_type: string; value: string }>;
  video_p25_watched_actions?: Array<{ action_type: string; value: string }>;
}

const INSIGHT_FIELDS = [
  "spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm",
  "actions", "action_values",
  "video_30_sec_watched_actions", "video_avg_time_watched_actions",
].join(",");

export async function getInsights(params: {
  entityId?: string;
  level?: "campaign" | "adset" | "ad";
  dateRange?: { since: string; until: string };
  breakdowns?: string[];
  limit?: number;
}) {
  const { entityId, level = "campaign", dateRange, breakdowns, limit = 500 } = params;
  const endpoint = entityId
    ? `/${entityId}/insights`
    : `/${getAdAccountId()}/insights`;

  const queryParams: Record<string, string | number | boolean> = {
    fields: INSIGHT_FIELDS,
    level,
    limit,
  };

  if (dateRange) {
    queryParams.time_range = JSON.stringify({
      since: dateRange.since,
      until: dateRange.until,
    });
  }

  if (breakdowns?.length) {
    queryParams.breakdowns = breakdowns.join(",");
  }

  const data = await metaApi<{ data: InsightData[] }>(endpoint, {
    params: queryParams,
  });
  return data.data;
}

export function extractPurchases(actions?: Array<{ action_type: string; value: string }>) {
  return parseInt(actions?.find((a) => a.action_type === "purchase")?.value || "0", 10);
}

export function extractPurchaseValue(actionValues?: Array<{ action_type: string; value: string }>) {
  return parseFloat(actionValues?.find((a) => a.action_type === "purchase")?.value || "0");
}

export function calculateROAS(purchaseValue: number, spend: number) {
  return spend > 0 ? purchaseValue / spend : 0;
}
