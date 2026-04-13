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
      summary: "Upscale the image.",
      expectedOutputs: ["image"],
    },
    registry,
    { requestText, availableKinds },
  );
}

export function selectImageEditCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
): string[] {
  return getPreferredDefinitionIdsForStep(
    {
      summary: "Apply prompt-guided edits to the image.",
      expectedOutputs: ["image"],
    },
    registry,
    { requestText, availableKinds },
  );
}



export function selectTextToImageCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
): string[] {
  return getPreferredDefinitionIdsForStep(
    {
      summary: "Generate an image from a text prompt.",
      expectedOutputs: ["image"],
    },
    registry,
    { requestText, availableKinds },
  );
}

export function selectTextToVideoCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
): string[] {
  return getPreferredDefinitionIdsForStep(
    {
      summary: "Generate a video from a text prompt.",
      expectedOutputs: ["video"],
    },
    registry,
    { requestText, availableKinds },
  );
}

export function selectOutputCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
): string[] {
  return getPreferredDefinitionIdsForStep(
    {
      summary: "Expose the resulting image in the app output.",
      expectedOutputs: [],
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
