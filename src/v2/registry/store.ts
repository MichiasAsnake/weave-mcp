import fs from "node:fs/promises";
import path from "node:path";

import {
  buildRegistryCapabilitySnapshot,
  refreshRegistryCapabilities,
  renderRegistryCapabilityCatalog,
} from "./capabilities.ts";
import type {
  LatestRegistryPointer,
  NormalizedRegistrySnapshot,
  RawRegistrySnapshot,
  RegistryCapabilitySnapshot,
  RegistryFileWriteResult,
} from "./types.ts";

import {
  LatestRegistryPointerSchema,
  NormalizedRegistrySnapshotSchema,
  RawRegistrySnapshotSchema,
  RegistryCapabilitySnapshotSchema,
} from "./zod.ts";
import { ensureDir } from "../shared/fs.ts";
import { readJsonFile, writeJsonFile } from "../shared/json.ts";
import { normalizeRegistrySnapshot } from "./normalize.ts";

export function getRegistryRootDir(): string {
  return path.join(process.cwd(), "data", "registry");
}

export function getRawSnapshotPath(syncId: string): string {
  return path.join(getRegistryRootDir(), "raw", `${syncId}.json`);
}

export function getNormalizedSnapshotPath(syncId: string): string {
  return path.join(getRegistryRootDir(), "normalized", `${syncId}.json`);
}

export function getCapabilitySnapshotPath(syncId: string): string {
  return path.join(getRegistryRootDir(), "capabilities", `${syncId}.json`);
}

export function getCapabilityCatalogPath(syncId: string): string {
  return path.join(getRegistryRootDir(), "catalog", `${syncId}.md`);
}

export function getLatestPointerPath(): string {
  return path.join(getRegistryRootDir(), "latest.json");
}

export async function readLatestRegistryPointer(): Promise<LatestRegistryPointer> {
  const pointer = await readJsonFile<LatestRegistryPointer>(getLatestPointerPath());
  return LatestRegistryPointerSchema.parse(pointer);
}

export async function readNormalizedRegistrySnapshot(syncId: string): Promise<NormalizedRegistrySnapshot> {
  const snapshot = await readJsonFile<NormalizedRegistrySnapshot>(getNormalizedSnapshotPath(syncId));
  return refreshNormalizedSnapshotOnRead(
    NormalizedRegistrySnapshotSchema.parse(snapshot),
    getRawSnapshotPath(syncId),
  );
}

export async function readLatestNormalizedRegistrySnapshot(): Promise<NormalizedRegistrySnapshot> {
  const pointer = await readLatestRegistryPointer();
  const snapshot = await readJsonFile<NormalizedRegistrySnapshot>(
    resolveRegistryArtifactPath(pointer.normalizedSnapshotPath, getNormalizedSnapshotPath(pointer.syncId)),
  );
  return refreshNormalizedSnapshotOnRead(
    NormalizedRegistrySnapshotSchema.parse(snapshot),
    resolveRegistryArtifactPath(pointer.rawSnapshotPath, getRawSnapshotPath(pointer.syncId)),
  );
}

export async function readLatestRegistryCapabilitySnapshot(): Promise<RegistryCapabilitySnapshot> {
  const normalizedSnapshot = await readLatestNormalizedRegistrySnapshot();
  return RegistryCapabilitySnapshotSchema.parse(
    buildRegistryCapabilitySnapshot(normalizedSnapshot),
  );
}

export async function writeRegistrySnapshots(args: {
  rawSnapshot: RawRegistrySnapshot;
  normalizedSnapshot: NormalizedRegistrySnapshot;
}): Promise<RegistryFileWriteResult> {
  const parsedRaw = RawRegistrySnapshotSchema.parse(args.rawSnapshot);
  const parsedNormalized = NormalizedRegistrySnapshotSchema.parse(args.normalizedSnapshot);
  const capabilitySnapshot = RegistryCapabilitySnapshotSchema.parse(
    buildRegistryCapabilitySnapshot(parsedNormalized),
  );
  const capabilityCatalog = renderRegistryCapabilityCatalog(parsedNormalized);

  const rawSnapshotPath = getRawSnapshotPath(parsedRaw.syncId);
  const normalizedSnapshotPath = getNormalizedSnapshotPath(parsedNormalized.syncId);
  const capabilitySnapshotPath = getCapabilitySnapshotPath(parsedNormalized.syncId);
  const capabilityCatalogPath = getCapabilityCatalogPath(parsedNormalized.syncId);
  const latestPointerPath = getLatestPointerPath();

  const latestPointer: LatestRegistryPointer = LatestRegistryPointerSchema.parse({
    syncId: parsedNormalized.syncId,
    fetchedAt: parsedNormalized.fetchedAt,
    registryVersion: parsedNormalized.registryVersion,
    apiBaseUrl: parsedNormalized.apiBaseUrl,
    authSource: parsedNormalized.authSource,
    rawSnapshotPath: toPortableRegistryPath(rawSnapshotPath),
    normalizedSnapshotPath: toPortableRegistryPath(normalizedSnapshotPath),
    capabilitySnapshotPath: toPortableRegistryPath(capabilitySnapshotPath),
    capabilityCatalogPath: toPortableRegistryPath(capabilityCatalogPath),
    nodeSpecCount: parsedNormalized.nodeSpecs.length,
    warningCount: parsedNormalized.warnings.length,
  });

  await writeJsonFile(rawSnapshotPath, parsedRaw);
  await writeJsonFile(normalizedSnapshotPath, parsedNormalized);
  await writeJsonFile(capabilitySnapshotPath, capabilitySnapshot);
  await writeJsonFile(latestPointerPath, latestPointer);
  await writeCatalogFile(capabilityCatalogPath, capabilityCatalog);

  return {
    rawSnapshotPath,
    normalizedSnapshotPath,
    capabilitySnapshotPath,
    capabilityCatalogPath,
    latestPointerPath,
  };
}

function toPortableRegistryPath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
}

function resolveRegistryArtifactPath(storedPath: string, fallbackAbsolutePath: string): string {
  if (!storedPath) {
    return fallbackAbsolutePath;
  }

  if (path.isAbsolute(storedPath) && storedPath.startsWith(process.cwd())) {
    return storedPath;
  }

  if (path.isAbsolute(storedPath)) {
    return fallbackAbsolutePath;
  }

  return path.resolve(process.cwd(), storedPath);
}

async function refreshNormalizedSnapshotOnRead(
  snapshot: NormalizedRegistrySnapshot,
  rawSnapshotPath: string,
): Promise<NormalizedRegistrySnapshot> {
  try {
    const rawSnapshot = RawRegistrySnapshotSchema.parse(
      await readJsonFile<RawRegistrySnapshot>(rawSnapshotPath),
    );

    return NormalizedRegistrySnapshotSchema.parse(
      normalizeRegistrySnapshot(rawSnapshot, {
        registryVersion: snapshot.registryVersion,
      }),
    );
  } catch {
    return NormalizedRegistrySnapshotSchema.parse(refreshRegistryCapabilities(snapshot));
  }
}

async function writeCatalogFile(filePath: string, contents: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents, "utf8");
}
