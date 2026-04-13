import type { NormalizedRegistrySnapshot, ValueKind } from "./types.ts";
import { getBridgeDefinitionIdsForKinds, getPreferredDefinitionIdsForStep } from "./capabilities.ts";

export function selectImportCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
): string[] {
  return getPreferredDefinitionIdsForStep(
    {
      summary: "Allow the user to upload an image file.",
      expectedOutputs: ["file"],
    },
    registry,
    { requestText },
  );
}

export function selectUpscaleCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
): string[] {
  return getPreferredDefinitionIdsForStep(
    {
      summary: "Upscale the uploaded image.",
      expectedOutputs: ["image"],
    },
    registry,
    { requestText, availableKinds },
  );
}

export function selectExportCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
  explicitFormat?: string | null,
): string[] {
  const summary = explicitFormat
    ? `Export the upscaled image as ${explicitFormat.toUpperCase()}.`
    : /user-specified|chosen format/i.test(requestText)
      ? "Export the upscaled image in a user-specified format."
      : "Export the upscaled image.";

  return getPreferredDefinitionIdsForStep(
    {
      summary,
      expectedOutputs: ["file"],
    },
    registry,
    { requestText, availableKinds },
  );
}

export function selectBridgeCandidates(
  registry: NormalizedRegistrySnapshot,
  fromKind: ValueKind,
  toKind: ValueKind,
): string[] {
  return getBridgeDefinitionIdsForKinds(registry, fromKind, toKind, 1);
}
