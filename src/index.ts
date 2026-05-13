import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLOSER_PATH = resolve(__dirname, "../CLOSER.md");

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
    description: "Sales principles and guidance based on the CLOSER framework",
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
    const token = process.env.SHOPIFY_ACCESS_TOKEN;
    const domain = process.env.SHOPIFY_STORE_DOMAIN;

    if (!token || !domain) {
      return {
        content: [
          {
            type: "text",
            text: "Missing SHOPIFY_ACCESS_TOKEN or SHOPIFY_STORE_DOMAIN environment variables.",
          },
        ],
      };
    }

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
        variants: Array<{ price: string; inventory_quantity: number }>;
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
        const price = p.variants[0]?.price ?? "N/A";
        const available = (p.variants[0]?.inventory_quantity ?? 0) > 0 ? "In stock" : "Out of stock";
        const description = p.body_html
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        return `**${p.title}** — £${price} | ${available}\n${description}`;
      })
      .join("\n\n");

    return {
      content: [{ type: "text", text: formatted }],
    };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("scalar-mcp running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
