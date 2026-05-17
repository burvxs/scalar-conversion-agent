import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientInstance } from "../types/client-instance.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function loadClient(): Promise<ClientInstance> {
  const clientId = process.env.SCALAR_CLIENT_ID;
  if (!clientId) throw new Error("SCALAR_CLIENT_ID environment variable is not set.");

  const path = resolve(__dirname, "../../clients", `${clientId}.json`);

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(`Client config not found: ${path}`);
  }

  return JSON.parse(raw) as ClientInstance;
}
