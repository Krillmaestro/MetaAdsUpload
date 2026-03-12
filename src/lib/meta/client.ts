const META_API_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

interface MetaRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | boolean>;
  body?: Record<string, unknown> | FormData;
}

export async function metaApi<T = unknown>(
  endpoint: string,
  options: MetaRequestOptions = {}
): Promise<T> {
  const { method = "GET", params = {}, body } = options;
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) throw new Error("META_ACCESS_TOKEN is not configured");

  const url = new URL(`${META_BASE_URL}${endpoint}`);
  url.searchParams.set("access_token", token);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const fetchOptions: RequestInit = { method };
  if (body) {
    if (body instanceof FormData) {
      fetchOptions.body = body;
    } else {
      fetchOptions.headers = { "Content-Type": "application/json" };
      fetchOptions.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url.toString(), fetchOptions);
  const data = await res.json();

  if (!res.ok) {
    const errorMsg = data?.error?.message || `Meta API error: ${res.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export function getAdAccountId() {
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error("META_AD_ACCOUNT_ID is not configured");
  return id.startsWith("act_") ? id : `act_${id}`;
}
