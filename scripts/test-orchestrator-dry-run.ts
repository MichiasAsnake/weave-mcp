import fs from "node:fs";
import path from "node:path";

import { openai } from "@ai-sdk/openai";

import { createOrchestratorGraph } from "../src/v2/orchestrator/graph.ts";
import { closeSharedPostgresPool } from "../src/v2/db/connection.ts";

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

  const modelName =
    process.env.ORCHESTRATOR_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o";

  const { graph } = await createOrchestratorGraph({
    model: openai(modelName),
  });

  const input = {
    userRequest: "build a workflow that takes an uploaded image, upscales it, and exports the result",
    maxRevisionCount: 3,
  };

  try {
    const finalState = await graph.invoke(input, {
      configurable: {
        thread_id: `dry-run-${Date.now()}`,
      },
    });

    console.log(
      JSON.stringify(
        {
          status: finalState.status,
          requestMode: finalState.requestMode ?? null,
          revisionCount: finalState.revisionCount,
          validationOk: finalState.validationResult?.ok ?? null,
          validationErrorCount: finalState.validationResult?.errorCount ?? null,
          workingGraphNodeTypes: (finalState.workingGraph?.nodes || []).map((node) => node.nodeType),
          failureReason: finalState.failureReason ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || "" : "";
    const failedAtMatch = stack.match(/src\/v2\/orchestrator\/nodes\/([a-z-]+)\.ts/);

    console.log(
      JSON.stringify(
        {
          failedAtNode: failedAtMatch ? failedAtMatch[1] : null,
          error: message,
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await closeSharedPostgresPool();
  }
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        failedAtNode: null,
        error: error instanceof Error ? error.stack || error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
