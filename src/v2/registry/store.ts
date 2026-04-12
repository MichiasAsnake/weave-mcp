import path from "node:path";

import type {
  LatestRegistryPointer,
  NormalizedRegistrySnapshot,
  RawRegistrySnapshot,
  RegistryFileWriteResult,
} from "./types.ts";

import { LatestRegistryPointerSchema, NormalizedRegistrySnapshotSchema, RawRegistrySnapshotSchema } from "./zod.ts";
import { readJsonFile, writeJsonFile } from "../shared/json.ts";

export function getRegistryRootDir(): string {
  return path.join(process.cwd(), "data", "registry");
}

export function getRawSnapshotPath(syncId: string): string {
  return path.join(getRegistryRootDir(), "raw", `${syncId}.json`);
}

export function getNormalizedSnapshotPath(syncId: string): string {
  return path.join(getRegistryRootDir(), "normalized", `${syncId}.json`);
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
  return NormalizedRegistrySnapshotSchema.parse(snapshot);
}

export async function readLatestNormalizedRegistrySnapshot(): Promise<NormalizedRegistrySnapshot> {
  const pointer = await readLatestRegistryPointer();
  const snapshot = await readJsonFile<NormalizedRegistrySnapshot>(
    getNormalizedSnapshotPath(pointer.syncId),
  );
  return NormalizedRegistrySnapshotSchema.parse(snapshot);
}

export async function writeRegistrySnapshots(args: {
  rawSnapshot: RawRegistrySnapshot;
  normalizedSnapshot: NormalizedRegistrySnapshot;
}): Promise<RegistryFileWriteResult> {
  const parsedRaw = RawRegistrySnapshotSchema.parse(args.rawSnapshot);
  const parsedNormalized = NormalizedRegistrySnapshotSchema.parse(args.normalizedSnapshot);

  const rawSnapshotPath = getRawSnapshotPath(parsedRaw.syncId);
  const normalizedSnapshotPath = getNormalizedSnapshotPath(parsedNormalized.syncId);
  const latestPointerPath = getLatestPointerPath();

  const latestPointer: LatestRegistryPointer = LatestRegistryPointerSchema.parse({
    syncId: parsedNormalized.syncId,
    fetchedAt: parsedNormalized.fetchedAt,
    registryVersion: parsedNormalized.registryVersion,
    apiBaseUrl: parsedNormalized.apiBaseUrl,
    authSource: parsedNormalized.authSource,
    rawSnapshotPath,
    normalizedSnapshotPath,
    nodeSpecCount: parsedNormalized.nodeSpecs.length,
    warningCount: parsedNormalized.warnings.length,
  });

  await writeJsonFile(rawSnapshotPath, parsedRaw);
  await writeJsonFile(normalizedSnapshotPath, parsedNormalized);
  await writeJsonFile(latestPointerPath, latestPointer);

  return {
    rawSnapshotPath,
    normalizedSnapshotPath,
    latestPointerPath,
  };
}
