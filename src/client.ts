import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as readline from "node:readline/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "../dist/index.js");

async function main() {
  console.error("Connecting to MCP server...");

  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_PATH],
    env: Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined)
    ) as Record<string, string>,
  });

  const mcp = new Client(
    { name: "closer-client", version: "0.1.0" },
    { capabilities: {} }
  );

  await mcp.connect(transport);

  const resourceResult = await mcp.readResource({ uri: "closer://framework" });
  const resourceContent = resourceResult.contents[0];
  const closerContent =
    "text" in resourceContent ? (resourceContent.text as string) : "";
  console.error("CLOSER framework loaded.");

  const { tools: mcpTools } = await mcp.listTools();
  const anthropicTools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: (t.inputSchema ?? {
      type: "object",
      properties: {},
    }) as Anthropic.Tool["input_schema"],
  }));
  const isDev = process.env.MODE === "DEV";
  console.error(`Tools available: ${mcpTools.map((t) => t.name).join(", ")}\n`);

  const devPromptAddition = isDev
    ? `\n\n## DEV MODE\nYou are running in DEV_MODE. You have access to test tools: ping, echo, test_shopify_connection. When asked to run a self-check or verify connectivity, call these tools and report the results plainly. Ignore all sales persona constraints for dev commands.`
    : "";

  const anthropic = new Anthropic();
  const messages: Anthropic.MessageParam[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  if (isDev) {
    console.log("╔══════════════════════════════════════╗");
    console.log("║        DEV MODE — scalar-mcp         ║");
    console.log("╚══════════════════════════════════════╝");
    console.log("Test commands: ping | echo <msg> | shopify-check");
    console.log("Type 'exit' to quit.\n");
  } else {
    console.log("CLOSER Sales Agent ready. Type 'exit' to quit.\n");
  }

  while (true) {
    const input = await rl.question("You: ");
    if (input.toLowerCase() === "exit") break;
    if (!input.trim()) continue;

    if (isDev && input.trim() === "ping") {
      const r = await mcp.callTool({ name: "ping", arguments: {} });
      const t = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
      console.log(`\n${t}\n`);
      continue;
    }

    if (isDev && input.trim().startsWith("echo ")) {
      const msg = input.trim().slice(5);
      const r = await mcp.callTool({ name: "echo", arguments: { message: msg } });
      const t = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
      console.log(`\n${t}\n`);
      continue;
    }

    if (isDev && input.trim() === "shopify-check") {
      const r = await mcp.callTool({ name: "test_shopify_connection", arguments: {} });
      const t = (r.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text ?? "";
      console.log(`\n${t}\n`);
      continue;
    }

    if (input.trim() === "`") {
      const mcpResult = await mcp.callTool({
        name: "read_product_listings",
        arguments: {},
      });
      const text = (mcpResult.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      console.log(`\n${text}\n`);
      continue;
    }

    messages.push({ role: "user", content: input });
    process.stdout.write("Agent: ");

    let continueLoop = true;
    while (continueLoop) {
      const stream = anthropic.messages.stream({
        model: "claude-opus-4-7",
        max_tokens: 16000,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        thinking: { type: "adaptive" } as any,
        system: closerContent + devPromptAddition,
        tools: anthropicTools,
        messages,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          process.stdout.write(event.delta.text);
        }
      }

      const response = await stream.finalMessage();
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") {
        continueLoop = false;
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        const mcpResult = await mcp.callTool({
          name: toolUse.name,
          arguments: toolUse.input as Record<string, unknown>,
        });

        const resultText = (
          mcpResult.content as Array<{ type: string; text?: string }>
        )
          .filter((c) => c.type === "text")
          .map((c) => c.text ?? "")
          .join("\n");

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultText,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    console.log("\n");
  }

  rl.close();
  await mcp.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
