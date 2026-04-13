import type { NodeSpec, NormalizedRegistrySnapshot, ValueKind } from "./types.ts";
import { getBridgeDefinitionIdsForKinds, getPreferredDefinitionIdsForStep } from "./capabilities.ts";

function rankDefinitionIds(nodeSpecs: NodeSpec[], score: (nodeSpec: NodeSpec) => number): string[] {
  return [...nodeSpecs]
    .sort((left, right) => {
      const delta = score(right) - score(left);
      if (delta !== 0) return delta;
      return left.displayName.localeCompare(right.displayName) || left.source.definitionId.localeCompare(right.source.definitionId);
    })
    .map((nodeSpec) => nodeSpec.source.definitionId);
}

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

export function selectPromptEnhancerCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) =>
      node.capabilities.planningHints.includes("prefer_for_prompt_enhancement")
      || node.capabilities.taskTags.includes("prompt-enhance")
      || node.nodeType === "prompt_enhance"
    ),
    (node) => {
      let score = 0;
      if (node.capabilities.planningHints.includes("prefer_for_prompt_enhancement")) score += 8;
      if (node.capabilities.taskTags.includes("prompt-enhance")) score += 6;
      if (node.capabilities.ioProfile.summary === "text -> text") score += 4;
      if (node.capabilities.dependencyComplexity === "simple") score += 2;
      return score;
    },
  ).slice(0, 1);
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
