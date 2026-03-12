import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

const META_API_VERSION = "v21.0";
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

interface MetaRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  params?: Record<string, string | number | boolean>;
  body?: Record<string, unknown> | FormData;
  token?: string;
}

export async function getActiveConnection() {
  const connections = await db
    .select()
    .from(schema.metaConnections)
    .where(eq(schema.metaConnections.isActive, true))
    .limit(1);

  if (connections.length === 0) return null;
  return connections[0];
}

export async function getAccessToken(): Promise<string> {
  // First try DB connection
  const conn = await getActiveConnection();
  if (conn?.accessToken) return conn.accessToken;

  // Fallback to env var
  const envToken = process.env.META_ACCESS_TOKEN;
  if (envToken) return envToken;

  throw new Error("No Meta connection configured. Go to Settings to connect your Meta account.");
}

export async function metaApi<T = unknown>(
  endpoint: string,
  options: MetaRequestOptions = {}
): Promise<T> {
  const { method = "GET", params = {}, body } = options;
  const token = options.token || await getAccessToken();

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

export async function getAdAccountId(): Promise<string> {
  // First try DB connection
  const conn = await getActiveConnection();
  if (conn?.activeAdAccountId) {
    const id = conn.activeAdAccountId;
    return id.startsWith("act_") ? id : `act_${id}`;
  }

  // Fallback to env var
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error("No ad account selected. Go to Settings to connect your Meta account.");
  return id.startsWith("act_") ? id : `act_${id}`;
}

export async function getPageId(): Promise<string> {
  const conn = await getActiveConnection();
  if (conn?.activePageId) return conn.activePageId;

  const id = process.env.META_PAGE_ID;
  if (!id) throw new Error("No page selected. Go to Settings to configure your Meta page.");
  return id;
}

export async function getPixelId(): Promise<string | null> {
  const conn = await getActiveConnection();
  if (conn?.pixelId) return conn.pixelId;
  return process.env.META_PIXEL_ID || null;
}
