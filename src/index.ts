import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLOSER_PATH = resolve(__dirname, "../CLOSER.md");

const server = new McpServer({
  name: "scalar-mcp",
  version: "0.1.0",
});

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("scalar-mcp running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
