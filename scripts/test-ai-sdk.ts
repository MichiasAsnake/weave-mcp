import fs from "node:fs";
import path from "node:path";

import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

function loadDotEnvLocalIfPresent(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (process.env[key] !== undefined) {
      continue;
    }

    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnvLocalIfPresent();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const result = await generateText({
    model: openai(process.env.OPENAI_MODEL || "gpt-4o"),
    prompt: "Reply with the single word ok.",
    maxTokens: 20,
  });

  console.log(result.text);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
