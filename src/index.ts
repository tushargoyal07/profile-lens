import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { LinkedInClient } from "./linkedin/client.js";
import { ProfileService } from "./services/profile-service.js";

function loadEnvFile(): void {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional when the host injects variables.
  }
}

loadEnvFile();

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new LinkedInClient(config);
  await client.authenticate();
  const service = new ProfileService(client, config);
  const app = createApp({ config, service });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`profile-lens listening on http://localhost:${info.port}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
