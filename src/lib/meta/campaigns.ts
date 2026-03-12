import { metaApi, getAdAccountId } from "./client";

export interface Campaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  budget_remaining?: string;
  buying_type?: string;
  start_time?: string;
  stop_time?: string;
  created_time?: string;
  updated_time?: string;
}

const CAMPAIGN_FIELDS = "id,name,status,objective,daily_budget,lifetime_budget,budget_remaining,buying_type,start_time,stop_time,created_time,updated_time";

export async function getCampaigns(limit = 100) {
  const data = await metaApi<{ data: Campaign[] }>(
    `/${await getAdAccountId()}/campaigns`,
    { params: { fields: CAMPAIGN_FIELDS, limit } }
  );
  return data.data;
}

export async function createCampaign(params: {
  name: string;
  objective: string;
  status?: string;
  daily_budget?: number;
  special_ad_categories?: string[];
}) {
  return metaApi<{ id: string }>(
    `/${await getAdAccountId()}/campaigns`,
    {
      method: "POST",
      body: {
        ...params,
        status: params.status || "PAUSED",
        special_ad_categories: params.special_ad_categories || [],
      },
    }
  );
}

export async function updateCampaign(campaignId: string, params: Record<string, unknown>) {
  return metaApi(`/${campaignId}`, { method: "POST", body: params });
}
