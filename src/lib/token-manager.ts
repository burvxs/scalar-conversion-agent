import type { ClientInstance } from "../types/client-instance.js";

interface TokenCache {
  token: string;
  expires_at: number;
}

let cache: TokenCache | null = null;
const BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getShopifyToken(instance: ClientInstance): Promise<string> {
  if (cache && cache.expires_at > Date.now() + BUFFER_MS) {
    return cache.token;
  }

  const { shopify_client_id, shopify_client_secret } = instance.api_keys;
  const url = `https://${instance.store_domain}/admin/oauth/access_token`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: shopify_client_id,
      client_secret: shopify_client_secret,
    }),
  });

  if (!res.ok) {
    throw new Error(`Shopify token fetch failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    scope: string;
    expires_in: number;
  };

  cache = {
    token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return cache.token;
}
