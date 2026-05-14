import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { loadClient } from "./lib/load-client.js";
import type { ClientInstance } from "./types/client-instance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLOSER_PATH = resolve(__dirname, "../CLOSER.md");

const instance: ClientInstance = await loadClient();

const server = new McpServer({
  name: "scalar-mcp",
  version: "0.1.0",
});

// --- Resources ---

server.registerResource(
  "closer",
  "closer://framework",
  {
    title: "CLOSER Sales Framework",
    description: "Sales framework, SOPs, and guardrails",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: await readFile(CLOSER_PATH, "utf-8"),
      },
    ],
  })
);

server.registerResource(
  "instance",
  "client://instance",
  {
    title: "Client Instance",
    description: "Current client configuration including persona, offers, and dynamic cart context",
    mimeType: "application/json",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(instance, null, 2),
      },
    ],
  })
);

// --- Tools ---

server.registerTool(
  "read_product_listings",
  {
    title: "Read Product Listings",
    description:
      "Fetch live product listings from the Shopify store. Returns title, price, availability, and description for each product.",
    inputSchema: z.object({
      limit: z
        .number()
        .optional()
        .describe("Max number of products to return (default 10, max 250)"),
    }),
  },
  async ({ limit = 10 }) => {
    const token = instance.api_keys.shopify_access_token;
    const domain = instance.store_domain;

    const url = `https://${domain}/admin/api/2025-01/products.json?limit=${limit}`;

    const res = await fetch(url, {
      headers: { "X-Shopify-Access-Token": token },
    });

    if (!res.ok) {
      return {
        content: [
          {
            type: "text",
            text: `Shopify API error: ${res.status} ${res.statusText}`,
          },
        ],
      };
    }

    const data = (await res.json()) as {
      products: Array<{
        title: string;
        body_html: string;
        status: string;
        variants: Array<{ id: number; price: string; inventory_quantity: number }>;
      }>;
    };

    const listings = data.products;

    if (!listings.length) {
      return {
        content: [{ type: "text", text: "No product listings found." }],
      };
    }

    const formatted = listings
      .map((p) => {
        const variant = p.variants[0];
        const price = variant?.price ?? "N/A";
        const available = (variant?.inventory_quantity ?? 0) > 0 ? "In stock" : "Out of stock";
        const variantId = variant?.id ?? "N/A";
        const description = p.body_html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        return `**${p.title}** — £${price} | ${available} | variant:${variantId}\n${description}`;
      })
      .join("\n\n");

    return {
      content: [{ type: "text", text: formatted }],
    };
  }
);

server.registerTool(
  "create_checkout_link",
  {
    title: "Create Checkout Link",
    description:
      "Generate a Shopify cart URL for a product variant. Returns a direct checkout link to send to the customer.",
    inputSchema: z.object({
      variant_id: z
        .number()
        .describe("Shopify variant ID from read_product_listings"),
      quantity: z.number().optional().describe("Quantity (default 1)"),
      discount_code: z
        .string()
        .optional()
        .describe("Discount code to pre-apply"),
    }),
  },
  async ({ variant_id, quantity = 1, discount_code }) => {
    const domain = instance.store_domain;
    let url = `https://${domain}/cart/${variant_id}:${quantity}`;
    if (discount_code) url += `?discount=${encodeURIComponent(discount_code)}`;

    return {
      content: [{ type: "text", text: url }],
    };
  }
);

server.registerTool(
  "update_cart_context",
  {
    title: "Update Cart Context",
    description:
      "Update the live customer cart and/or profile for this session. Merges provided data into the existing dynamic context.",
    inputSchema: z.object({
      current_cart: z.record(z.string(), z.unknown()).optional().describe("Cart items to merge"),
      customer_profile: z.record(z.string(), z.unknown()).optional().describe("Customer data to merge"),
    }),
  },
  async ({ current_cart, customer_profile }) => {
    if (current_cart) {
      instance.dynamic_cart_context.current_cart = {
        ...instance.dynamic_cart_context.current_cart,
        ...current_cart,
      };
    }
    if (customer_profile) {
      instance.dynamic_cart_context.customer_profile = {
        ...instance.dynamic_cart_context.customer_profile,
        ...customer_profile,
      };
    }
    return {
      content: [{ type: "text", text: "Cart context updated." }],
    };
  }
);

// --- Dev Tools ---

if (process.env.MODE === "DEV") {
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "DEV: Health check. Returns 'pong' with a timestamp to confirm MCP tool calls are working.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text", text: `pong | ${new Date().toISOString()}` }],
    })
  );

  server.registerTool(
    "echo",
    {
      title: "Echo",
      description:
        "DEV: Returns the message you send. Verifies argument passing through the MCP layer.",
      inputSchema: z.object({
        message: z.string().describe("Any string to echo back"),
      }),
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }],
    })
  );

  server.registerTool(
    "test_shopify_connection",
    {
      title: "Test Shopify Connection",
      description:
        "DEV: Hits the Shopify shop endpoint and returns the shop name and currency. Verifies API credentials are valid.",
      inputSchema: z.object({}),
    },
    async () => {
      const { shopify_access_token } = instance.api_keys;
      const domain = instance.store_domain;

      const res = await fetch(
        `https://${domain}/admin/api/2025-01/shop.json`,
        { headers: { "X-Shopify-Access-Token": shopify_access_token } }
      );

      if (!res.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Shopify API error: ${res.status} ${res.statusText}`,
            },
          ],
        };
      }

      const { shop } = (await res.json()) as {
        shop: { name: string; currency: string; domain: string };
      };

      return {
        content: [
          {
            type: "text",
            text: `OK | shop:${shop.name} | currency:${shop.currency} | domain:${shop.domain}`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_client_instance",
    {
      title: "Get Client Instance",
      description: "DEV: Returns the full current ClientInstance config for inspection.",
      inputSchema: z.object({}),
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(instance, null, 2) }],
    })
  );
}

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`scalar-mcp running | client:${instance.client_id} | mode:${process.env.MODE ?? "PRODUCTION"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
