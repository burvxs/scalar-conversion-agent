import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as readline from "node:readline/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "../dist/index.js");

async function fetchCloserFramework(): Promise<string> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
  });

  const mcp = new Client(
    { name: "closer-client", version: "0.1.0" },
    { capabilities: {} }
  );

  await mcp.connect(transport);

  const result = await mcp.readResource({ uri: "closer://framework" });
  await mcp.close();

  const content = result.contents[0];
  return "text" in content ? (content.text as string) : "";
}

async function main() {
  console.error("Connecting to MCP server...");
  const closerContent = await fetchCloserFramework();
  console.error("CLOSER framework loaded.\n");

  const anthropic = new Anthropic();
  const messages: Anthropic.MessageParam[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("CLOSER Sales Agent ready. Type 'exit' to quit.\n");

  while (true) {
    const input = await rl.question("You: ");
    if (input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    messages.push({ role: "user", content: input });

    const stream = anthropic.messages.stream({
      model: "claude-opus-4-7",
      max_tokens: 16000,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: "adaptive" } as any,
      system: closerContent,
      messages,
    });

    process.stdout.write("Agent: ");
    let reply = "";

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        process.stdout.write(event.delta.text);
        reply += event.delta.text;
      }
    }

    console.log("\n");
    messages.push({ role: "assistant", content: reply });
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
