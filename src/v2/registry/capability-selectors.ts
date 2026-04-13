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

export function selectReferenceImageEditCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Iterable<ValueKind>,
): string[] {
  const available = new Set(availableKinds);
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) => {
      const imageInputs = node.ports.filter((port) =>
        port.direction === "input" && ((port.accepts || [port.kind]).includes("image") || port.kind === "image"),
      );
      const hasRequiredText = node.ports.some((port) =>
        port.direction === "input" && port.required && ((port.accepts || [port.kind]).includes("text") || port.kind === "text"),
      );
      const producesImage = node.capabilities.ioProfile.outputKinds.includes("image");
      return producesImage && hasRequiredText && imageInputs.length >= 2;
    }),
    (node) => {
      let score = 0;
      const modelText = `${node.displayName} ${node.model?.name || ""}`.toLowerCase();
      const imageInputs = node.ports.filter((port) =>
        port.direction === "input" && ((port.accepts || [port.kind]).includes("image") || port.kind === "image"),
      );
      const requiredImageInputs = imageInputs.filter((port) => port.required);
      const referenceLikeInputs = imageInputs.filter((port) => /reference|style|image_2|input_image_2|second/.test(port.key.toLowerCase()));
      if (requiredImageInputs.length >= 2) score += 10;
      if (referenceLikeInputs.length > 0) score += 8;
      if (/multi image|kontext/.test(modelText)) score += 8;
      if (/reference|style/.test(requestText.toLowerCase()) && referenceLikeInputs.length > 0) score += 6;
      if (/blend|combine|merge|composite/.test(requestText.toLowerCase()) && requiredImageInputs.length >= 2) score += 6;
      if (/background/.test(modelText)) score -= 6;
      if (available.has("image") && requiredImageInputs.length >= 1) score += 4;
      if (node.capabilities.dependencyComplexity === "simple") score += 2;
      if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
      return score;
    },
  ).slice(0, 1);
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
