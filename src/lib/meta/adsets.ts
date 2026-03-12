import { metaApi, getAdAccountId } from "./client";

export interface AdSet {
  id: string;
  campaign_id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  targeting?: Record<string, unknown>;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  start_time?: string;
  end_time?: string;
}

const ADSET_FIELDS = "id,campaign_id,name,status,daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,start_time,end_time";

export async function getAdSets(campaignId?: string, limit = 100) {
  const endpoint = campaignId
    ? `/${campaignId}/adsets`
    : `/${await getAdAccountId()}/adsets`;
  const data = await metaApi<{ data: AdSet[] }>(endpoint, {
    params: { fields: ADSET_FIELDS, limit },
  });
  return data.data;
}

export async function createAdSet(params: {
  campaign_id: string;
  name: string;
  daily_budget?: number;
  targeting: Record<string, unknown>;
  optimization_goal: string;
  billing_event: string;
  bid_strategy?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  promoted_object?: Record<string, unknown>;
}) {
  return metaApi<{ id: string }>(`/${await getAdAccountId()}/adsets`, {
    method: "POST",
    body: { ...params, status: params.status || "PAUSED" },
  });
}

export async function updateAdSet(adsetId: string, params: Record<string, unknown>) {
  return metaApi(`/${adsetId}`, { method: "POST", body: params });
}
