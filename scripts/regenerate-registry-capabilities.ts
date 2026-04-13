import path from "node:path";
import { access } from "node:fs/promises";

import { readJsonFile } from "../src/v2/shared/json.ts";
import { normalizeRegistrySnapshot } from "../src/v2/registry/normalize.ts";
import { getRawSnapshotPath, readLatestRegistryPointer, writeRegistrySnapshots } from "../src/v2/registry/store.ts";

import type { RawRegistrySnapshot } from "../src/v2/registry/types.ts";

async function main(): Promise<void> {
  const latest = await readLatestRegistryPointer();
  const rawPath = await resolveRawSnapshotPath(latest.rawSnapshotPath, latest.syncId);
  const rawSnapshot = await readJsonFile<RawRegistrySnapshot>(rawPath);
  const normalizedSnapshot = normalizeRegistrySnapshot(rawSnapshot, {
    registryVersion: latest.registryVersion,
  });

  const result = await writeRegistrySnapshots({
    rawSnapshot,
    normalizedSnapshot,
  });

  console.log(JSON.stringify({
    syncId: normalizedSnapshot.syncId,
    nodeSpecCount: normalizedSnapshot.nodeSpecs.length,
    warningCount: normalizedSnapshot.warnings.length,
    capabilitySnapshotPath: result.capabilitySnapshotPath,
    capabilityCatalogPath: result.capabilityCatalogPath,
  }, null, 2));
}

async function resolveRawSnapshotPath(storedPath: string, syncId: string): Promise<string> {
  const canonical = getRawSnapshotPath(syncId);
  if (await pathExists(canonical)) {
    return canonical;
  }

  if (path.isAbsolute(storedPath) && await pathExists(storedPath)) {
    return storedPath;
  }

  const relative = path.resolve(process.cwd(), storedPath);
  if (await pathExists(relative)) {
    return relative;
  }

  throw new Error(`Could not resolve raw snapshot path for syncId ${syncId}`);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
