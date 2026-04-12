import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { WeavyClient } from "../../client.js";

import type { RawRegistrySnapshot, SyncWeaveRegistryResult } from "./types.ts";

import { normalizeRegistrySnapshot } from "./normalize.ts";
import { writeRegistrySnapshots } from "./store.ts";

const DEFAULT_API_BASE_URL = "https://api.weavy.ai/api";
const INITIAL_REGISTRY_VERSION = "0.1.0";

export async function syncWeaveRegistry(): Promise<SyncWeaveRegistryResult> {
  loadLocalEnv();

  const apiBaseUrl = String(process.env.WEAVY_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, "");
  const token = String(process.env.WEAVY_BEARER_TOKEN || process.env.WEAVY_TOKEN || "").trim();

  if (!token) {
    throw new Error(
      "WEAVY_BEARER_TOKEN or WEAVY_TOKEN is required for registry sync. v2 does not depend on the legacy auth path.",
    );
  }

  const client = new WeavyClient({
    apiBaseUrl,
    token,
    authSource: "env",
  });

  const fetchedAt = new Date().toISOString();
  const syncId = fetchedAt.replace(/[:.]/g, "-");

  console.log(`[sync-weave-registry] apiBaseUrl=${apiBaseUrl}`);
  console.log(`[sync-weave-registry] syncId=${syncId}`);
  console.log("[sync-weave-registry] fetching public node definitions...");
  const publicDefinitions = await client.getPublicNodeDefinitions();

  console.log("[sync-weave-registry] fetching user node definitions...");
  const userDefinitions = await client.getUserNodeDefinitions();

  console.log("[sync-weave-registry] fetching model prices...");
  const modelPrices = await client.getModelPrices();

  const rawSnapshot: RawRegistrySnapshot = {
    syncId,
    fetchedAt,
    apiBaseUrl,
    authSource: client.authSource || "env",
    sources: {
      public: publicDefinitions,
      user: userDefinitions,
      modelPrices,
    },
  };

  const normalizedSnapshot = normalizeRegistrySnapshot(rawSnapshot, {
    registryVersion: INITIAL_REGISTRY_VERSION,
  });
  const writeResult = await writeRegistrySnapshots({
    rawSnapshot,
    normalizedSnapshot,
  });

  console.log(
    `[sync-weave-registry] public=${normalizedSnapshot.sourceSummaries[0]?.fetchedCount ?? 0} user=${normalizedSnapshot.sourceSummaries[1]?.fetchedCount ?? 0} normalized=${normalizedSnapshot.nodeSpecs.length} warnings=${normalizedSnapshot.warnings.length}`,
  );
  console.log(`[sync-weave-registry] rawSnapshot=${writeResult.rawSnapshotPath}`);
  console.log(`[sync-weave-registry] normalizedSnapshot=${writeResult.normalizedSnapshotPath}`);
  console.log(`[sync-weave-registry] latest=${writeResult.latestPointerPath}`);

  return {
    ...writeResult,
    snapshot: normalizedSnapshot,
  };
}

function loadLocalEnv(): void {
  const candidates = [
    path.join(process.cwd(), "local.env"),
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "src", "local.env"),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }

    const content = fs.readFileSync(candidate, "utf8");
    applyEnvContent(content);
    process.env.WEAVY_LOCAL_ENV = candidate;
    return;
  }
}

function applyEnvContent(content: string): void {
  const lines = String(content || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  syncWeaveRegistry().catch((error) => {
    console.error(`[sync-weave-registry] error=${error.message}`);
    process.exitCode = 1;
  });
}
