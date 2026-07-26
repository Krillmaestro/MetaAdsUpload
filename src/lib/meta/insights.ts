import { metaApi, metaApiPaginated, getAdAccountId } from "./client";

export interface InsightData {
  date_start: string;
  date_stop: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
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
  video_thruplay_watched_actions?: Array<{ action_type: string; value: string }>;
}

// Core fields only — ctr/cpc/cpm are derivable from spend/clicks/impressions
const INSIGHT_FIELDS = [
  "campaign_id", "adset_id", "ad_id",
  "spend", "impressions", "reach", "clicks",
  "actions", "action_values",
].join(",");

// Extended fields for dashboard views that need video metrics
const INSIGHT_FIELDS_WITH_VIDEO = [
  "campaign_id", "adset_id", "ad_id",
  "spend", "impressions", "reach", "clicks",
  "actions", "action_values",
  "video_30_sec_watched_actions", "video_avg_time_watched_actions",
  "video_thruplay_watched_actions",
].join(",");

export async function getInsights(params: {
  entityId?: string;
  level?: "campaign" | "adset" | "ad";
  dateRange?: { since: string; until: string };
  breakdowns?: string[];
  actionBreakdowns?: string[];
  limit?: number;
  includeVideoMetrics?: boolean;
  /** When set (e.g. 1), Meta returns one row per day instead of one aggregated row. */
  timeIncrement?: number;
}) {
  const { entityId, level = "campaign", dateRange, breakdowns, actionBreakdowns, limit = 500, includeVideoMetrics = false, timeIncrement } = params;
  const adAccountId = entityId || await getAdAccountId();
  const endpoint = `/${adAccountId}/insights`;

  const queryParams: Record<string, string | number | boolean> = {
    fields: includeVideoMetrics ? INSIGHT_FIELDS_WITH_VIDEO : INSIGHT_FIELDS,
    level,
    limit,
  };

  if (timeIncrement) {
    queryParams.time_increment = timeIncrement;
  }

  if (dateRange) {
    queryParams.time_range = JSON.stringify({
      since: dateRange.since,
      until: dateRange.until,
    });
  }

  if (breakdowns?.length) {
    queryParams.breakdowns = breakdowns.join(",");
  }

  if (actionBreakdowns?.length) {
    queryParams.action_breakdowns = actionBreakdowns.join(",");
  }

  return metaApiPaginated<InsightData>(endpoint, {
    params: queryParams,
    // Callers delete a whole window before writing this back — a partial
    // result would silently shrink the table. Fail instead.
    strict: true,
  });
}

/**
 * Fetch insights for ONE ad directly (/{adId}/insights) — daily rows with video
 * metrics. Used by the targeted editor sync so we never scan the whole account.
 */
export async function getAdInsightsById(
  adId: string,
  dateRange: { since: string; until: string },
  timeIncrement = 1
) {
  return metaApiPaginated<InsightData>(`/${adId}/insights`, {
    params: {
      fields: INSIGHT_FIELDS_WITH_VIDEO,
      time_increment: timeIncrement,
      time_range: JSON.stringify(dateRange),
    },
    strict: true,
  });
}

/** Per-ad daily insights for ONE ad set (/{adsetId}/insights?level=ad). One call → all ads in the set. */
export async function getAdsetInsightsByAd(
  adsetId: string,
  dateRange: { since: string; until: string },
  timeIncrement = 1
) {
  return metaApiPaginated<InsightData>(`/${adsetId}/insights`, {
    params: {
      fields: INSIGHT_FIELDS_WITH_VIDEO,
      level: "ad",
      time_increment: timeIncrement,
      time_range: JSON.stringify(dateRange),
    },
    strict: true,
  });
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

/** ThruPlays (≥15s, or full play for shorter videos) — denominator-ish for hold rate. */
export function extractThruplays(thruplayActions?: Array<{ action_type: string; value: string }>) {
  if (!thruplayActions || thruplayActions.length === 0) return 0;
  return parseInt(thruplayActions[0]?.value || "0", 10);
}

/**
 * Extract click-to-purchase ratio from action breakdown data.
 * When action_breakdowns=action_type is used, purchases are broken down into
 * 1d_click, 7d_click, 1d_view, etc. This calculates the % from clicks.
 */
export function extractClickPurchaseRatio(
  actions?: Array<{ action_type: string; value: string; "1d_click"?: string; "7d_click"?: string; "1d_view"?: string }>
): number | undefined {
  if (!actions) return undefined;
  const purchase = actions.find((a) => a.action_type === "purchase");
  if (!purchase) return undefined;

  const click1d = parseInt(purchase["1d_click"] || "0", 10);
  const click7d = parseInt(purchase["7d_click"] || "0", 10);
  const view1d = parseInt(purchase["1d_view"] || "0", 10);
  const totalClick = Math.max(click1d, click7d); // use the larger window
  const total = totalClick + view1d;

  if (total === 0) return undefined;
  return totalClick / total;
}
