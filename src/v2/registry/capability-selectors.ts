import type { NodeSpec, NormalizedRegistrySnapshot, ValueKind } from "./types.ts";
import { getBridgeDefinitionIdsForKinds, getPreferredDefinitionIdsForStep } from "./capabilities.ts";

function rankNodeSpecs(nodeSpecs: NodeSpec[], score: (nodeSpec: NodeSpec) => number): NodeSpec[] {
  return [...nodeSpecs].sort((left, right) => {
    const delta = score(right) - score(left);
    if (delta !== 0) return delta;
    return left.displayName.localeCompare(right.displayName) || left.source.definitionId.localeCompare(right.source.definitionId);
  });
}

function rankDefinitionIds(nodeSpecs: NodeSpec[], score: (nodeSpec: NodeSpec) => number): string[] {
  return rankNodeSpecs(nodeSpecs, score).map((nodeSpec) => nodeSpec.source.definitionId);
}

function distinctTopDefinitionIds(
  nodeSpecs: NodeSpec[],
  score: (nodeSpec: NodeSpec) => number,
  keyForNode: (nodeSpec: NodeSpec) => string,
  limit: number,
): string[] {
  const ranked = rankNodeSpecs(nodeSpecs, score);
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const node of ranked) {
    const key = keyForNode(node);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(node.source.definitionId);
    if (selected.length >= limit) break;
  }

  return selected;
}

function normalizeDisplayKey(node: NodeSpec): string {
  return node.displayName.toLowerCase().replace(/\s+/g, " ").trim();
}

function isPromptToImageGenerator(node: NodeSpec): boolean {
  const acceptedInputKinds = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
  return node.capabilities.ioProfile.outputKinds.includes("image")
    && node.capabilities.ioProfile.requiredInputKinds.includes("text")
    && !node.capabilities.ioProfile.requiredInputKinds.includes("image")
    && !node.capabilities.ioProfile.requiredInputKinds.includes("video")
    && !node.capabilities.ioProfile.requiredInputKinds.includes("audio")
    && !acceptedInputKinds.includes("any")
    && !node.capabilities.taskTags.includes("image-edit")
    && !node.capabilities.planningHints.includes("avoid_without_model_source")
    && (node.capabilities.functionalRole === "generate"
      || node.capabilities.taskTags.includes("text-to-image")
      || node.capabilities.taskTags.includes("prompt-to-image")
      || node.capabilities.planningHints.includes("prefer_for_prompt_to_image_app"));
}

function scorePromptToImageGenerator(node: NodeSpec): number {
  let score = 0;
  const modelText = `${node.displayName} ${node.model?.name || ""}`.toLowerCase();
  if (node.capabilities.planningHints.includes("prefer_for_prompt_to_image_app")) score += 8;
  if (node.capabilities.taskTags.includes("text-to-image") || node.capabilities.taskTags.includes("prompt-to-image")) score += 6;
  if (node.capabilities.functionalRole === "generate") score += 4;
  if (node.capabilities.ioProfile.summary === "text -> image") score += 5;
  if (node.capabilities.dependencyComplexity === "simple") score += 3;
  if (/gpt image|imagen|midjourney|flux|recraft|ideogram|bria|dalle/.test(modelText)) score += 2;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
  return score;
}

function isPromptToVideoGenerator(node: NodeSpec): boolean {
  const acceptedInputKinds = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
  return (node.capabilities.ioProfile.outputKinds.includes("video") || node.capabilities.ioProfile.outputKinds.includes("any"))
    && node.capabilities.ioProfile.requiredInputKinds.includes("text")
    && !node.capabilities.ioProfile.requiredInputKinds.includes("image")
    && !acceptedInputKinds.includes("any")
    && !node.capabilities.planningHints.includes("avoid_without_model_source")
    && (node.capabilities.functionalRole === "generate"
      || node.capabilities.taskTags.includes("text-to-video")
      || node.capabilities.taskTags.includes("prompt-to-video")
      || node.capabilities.planningHints.includes("prefer_for_prompt_to_video_app"));
}

function scorePromptToVideoGenerator(node: NodeSpec): number {
  let score = 0;
  const modelText = `${node.displayName} ${node.model?.name || ""}`.toLowerCase();
  if (node.capabilities.planningHints.includes("prefer_for_prompt_to_video_app")) score += 8;
  if (node.capabilities.taskTags.includes("text-to-video") || node.capabilities.taskTags.includes("prompt-to-video")) score += 6;
  if (node.capabilities.functionalRole === "generate") score += 4;
  if (node.capabilities.ioProfile.summary === "text -> video") score += 6;
  if (node.capabilities.ioProfile.outputKinds.includes("video")) score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 3;
  if (/luma|minimax|hunyuan|wan|kling|mochi/.test(modelText)) score += 2;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
  return score;
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

export function selectPromptSourceCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) =>
      node.capabilities.planningHints.includes("prefer_for_prompt_source")
      || node.capabilities.taskTags.includes("prompt-source")
      || (node.displayName === "Prompt" && node.capabilities.ioProfile.summary === "none -> text"),
    ),
    (node) => {
      let score = 0;
      if (node.capabilities.planningHints.includes("prefer_for_prompt_source")) score += 8;
      if (node.capabilities.taskTags.includes("prompt-source")) score += 6;
      if (node.capabilities.ioProfile.summary === "none -> text") score += 4;
      if (node.capabilities.dependencyComplexity === "simple") score += 2;
      if (node.nodeType === "promptV3") score += 4;
      return score;
    },
  ).slice(0, 1);
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
  _requestText: string,
  _availableKinds: Iterable<ValueKind>,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToImageGenerator),
    scorePromptToImageGenerator,
    normalizeDisplayKey,
    1,
  );
}

export function selectCompareTextToImageCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToImageGenerator),
    scorePromptToImageGenerator,
    normalizeDisplayKey,
    2,
  );
}

export function selectTextToVideoCandidates(
  registry: NormalizedRegistrySnapshot,
  _requestText: string,
  _availableKinds: Iterable<ValueKind>,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToVideoGenerator),
    scorePromptToVideoGenerator,
    normalizeDisplayKey,
    1,
  );
}

export function selectCompareTextToVideoCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToVideoGenerator),
    scorePromptToVideoGenerator,
    normalizeDisplayKey,
    2,
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
