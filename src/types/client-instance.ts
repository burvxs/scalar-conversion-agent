export interface Offer {
  code: string;
  percentage: number;
  expires_at?: string;
  description?: string;
}

export interface PersonaConfig {
  name: string;
  role: string;
  background: string;
  tone: string;
  vocabulary_preferred: string[];
  vocabulary_forbidden: string[];
}

export interface DynamicCartContext {
  current_cart: Record<string, unknown>;
  customer_profile: Record<string, unknown>;
}

export interface ClientInstance {
  client_id: string;
  store_domain: string;
  api_keys: {
    shopify_access_token: string;
  };
  billing_status: "active" | "trial" | "suspended";
  max_discount_percentage: number;
  offers: Record<string, Offer>;
  discount_code_prefix: string;
  escalation_contact: string;
  persona: PersonaConfig;
  dynamic_cart_context: DynamicCartContext;
}
