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

function modelText(node: NodeSpec): string {
  return `${node.displayName} ${node.model?.name || ""}`.toLowerCase();
}

function countRequiredInputs(node: NodeSpec, kind: ValueKind): number {
  return node.ports.filter((port) =>
    port.direction === "input"
    && port.required
    && ((port.accepts || [port.kind]).includes(kind) || port.kind === kind || (kind === "mask" && port.kind === "any")),
  ).length;
}

function countOptionalInputs(node: NodeSpec, kind: ValueKind): number {
  return node.ports.filter((port) =>
    port.direction === "input"
    && !port.required
    && ((port.accepts || [port.kind]).includes(kind) || port.kind === kind || (kind === "mask" && port.kind === "any")),
  ).length;
}

function hasTextInput(node: NodeSpec): boolean {
  return node.ports.some((port) =>
    port.direction === "input"
    && ((port.accepts || [port.kind]).includes("text") || port.kind === "text"),
  );
}

function scoreModelHints(node: NodeSpec, hints: string[]): number {
  if (hints.length === 0) return 0;
  const text = modelText(node);
  return hints.reduce((score, hint, index) => (
    text.includes(hint) ? score + Math.max(8 - index, 2) : score
  ), 0);
}

function extractRequestedModelHints(requestText: string): string[] {
  const normalized = requestText.toLowerCase();
  return [
    "gpt image",
    "flux",
    "ideogram",
    "recraft",
    "imagen",
    "midjourney",
    "runway",
    "luma",
    "hunyuan",
    "wan",
    "kling",
    "pixverse",
    "gemini",
  ].filter((hint) => normalized.includes(hint));
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
  const text = modelText(node);
  if (node.capabilities.planningHints.includes("prefer_for_prompt_to_image_app")) score += 8;
  if (node.capabilities.taskTags.includes("text-to-image") || node.capabilities.taskTags.includes("prompt-to-image")) score += 6;
  if (node.capabilities.functionalRole === "generate") score += 4;
  if (node.capabilities.ioProfile.summary === "text -> image") score += 5;
  if (node.capabilities.dependencyComplexity === "simple") score += 3;
  if (/gpt image|imagen|midjourney|flux|recraft|ideogram|bria|dalle/.test(text)) score += 2;
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
  const text = modelText(node);
  if (node.capabilities.planningHints.includes("prefer_for_prompt_to_video_app")) score += 8;
  if (node.capabilities.taskTags.includes("text-to-video") || node.capabilities.taskTags.includes("prompt-to-video")) score += 6;
  if (node.capabilities.functionalRole === "generate") score += 4;
  if (node.capabilities.ioProfile.summary === "text -> video") score += 6;
  if (node.capabilities.ioProfile.outputKinds.includes("video")) score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 3;
  if (/luma|minimax|hunyuan|wan|kling|mochi/.test(text)) score += 2;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
  return score;
}

function isMultiImageComposeNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("image")
    && countRequiredInputs(node, "image") >= 2
    && hasTextInput(node)
    && (
      node.capabilities.planningHints.includes("prefer_for_multi_image_compose")
      || node.capabilities.taskTags.includes("multi-image-compose")
      || /multi image|composite|blend|kontext/.test(modelText(node))
    );
}

function scoreMultiImageComposeNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_multi_image_compose")) score += 10;
  if (node.capabilities.taskTags.includes("multi-image-compose")) score += 8;
  if (countRequiredInputs(node, "image") >= 2) score += 8;
  if (hasTextInput(node)) score += 4;
  if (/flux|kontext|multi image/.test(modelText(node))) score += 6;
  if (node.capabilities.dependencyComplexity === "simple") score += 2;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 4;
  return score;
}

function isStyleTransferNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("image")
    && hasTextInput(node)
    && (countRequiredInputs(node, "image") >= 2 || countRequiredInputs(node, "image") + countOptionalInputs(node, "image") >= 2)
    && (
      node.capabilities.planningHints.includes("prefer_for_style_transfer_edit")
      || node.capabilities.taskTags.includes("style-transfer-edit")
      || /style|reference|gemini|kontext/.test(modelText(node))
    );
}

function scoreStyleTransferNode(node: NodeSpec): number {
  let score = 0;
  const imageInputCount = countRequiredInputs(node, "image") + countOptionalInputs(node, "image");
  if (node.capabilities.planningHints.includes("prefer_for_style_transfer_edit")) score += 10;
  if (node.capabilities.planningHints.includes("prefer_for_reference_image_edit")) score += 6;
  if (node.capabilities.taskTags.includes("style-transfer-edit")) score += 8;
  if (imageInputCount >= 2) score += 8;
  if (/style|reference/.test(modelText(node))) score += 6;
  if (/gemini|kontext/.test(modelText(node))) score += 4;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 3;
  return score;
}

function isMaskFromTextNode(node: NodeSpec): boolean {
  return countRequiredInputs(node, "image") >= 1
    && hasTextInput(node)
    && (node.capabilities.ioProfile.outputKinds.includes("mask") || node.capabilities.ioProfile.outputKinds.includes("any"))
    && (
      node.capabilities.planningHints.includes("prefer_for_mask_from_text")
      || node.capabilities.taskTags.includes("mask-from-text")
      || /mask by text/.test(modelText(node))
    );
}

function scoreMaskFromTextNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_mask_from_text")) score += 10;
  if (node.capabilities.taskTags.includes("mask-from-text")) score += 8;
  if (node.capabilities.ioProfile.outputKinds.includes("mask")) score += 6;
  if (/mask by text/.test(modelText(node))) score += 6;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 2;
  return score;
}

function isInpaintNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("image")
    && countRequiredInputs(node, "image") >= 1
    && hasTextInput(node)
    && (
      node.capabilities.planningHints.includes("prefer_for_inpaint_edit")
      || node.capabilities.taskTags.includes("inpaint-edit")
      || /inpaint/.test(modelText(node))
    );
}

function scoreInpaintNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_inpaint_edit")) score += 10;
  if (node.capabilities.taskTags.includes("inpaint-edit")) score += 8;
  if (/inpaint/.test(modelText(node))) score += 6;
  if (countRequiredInputs(node, "image") >= 2 || countRequiredInputs(node, "mask") >= 1) score += 8;
  if (node.capabilities.ioProfile.outputKinds.includes("image")) score += 4;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 3;
  return score;
}

function isImageToVideoNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("video")
    && countRequiredInputs(node, "image") >= 1
    && (
      node.capabilities.planningHints.includes("prefer_for_image_to_video")
      || node.capabilities.taskTags.includes("image-to-video")
      || /image to video|img2video/.test(modelText(node))
    );
}

function scoreImageToVideoNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_image_to_video")) score += 10;
  if (node.capabilities.taskTags.includes("image-to-video")) score += 8;
  if (node.capabilities.functionalRole === "generate") score += 4;
  if (/image to video|img2video/.test(modelText(node))) score += 6;
  if (node.capabilities.ioProfile.outputKinds.includes("video")) score += 4;
  if (node.capabilities.dependencyComplexity === "moderate") score += 2;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 3;
  return score;
}

function isVideoConcatNode(node: NodeSpec): boolean {
  return (node.capabilities.ioProfile.outputKinds.includes("video") || node.capabilities.ioProfile.outputKinds.includes("any"))
    && countRequiredInputs(node, "video") + countRequiredInputs(node, "any") >= 2
    && (
      node.capabilities.planningHints.includes("prefer_for_video_concat")
      || node.capabilities.taskTags.includes("video-concat")
      || /video concatenator|concatenate/.test(modelText(node))
    );
}

function scoreVideoConcatNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_video_concat")) score += 10;
  if (node.capabilities.taskTags.includes("video-concat")) score += 8;
  if (/video concatenator|concatenate/.test(modelText(node))) score += 6;
  if (node.capabilities.ioProfile.outputKinds.includes("video")) score += 6;
  if (node.capabilities.ioProfile.outputKinds.includes("any")) score += 2;
  return score;
}

function isVoiceoverVideoNode(node: NodeSpec): boolean {
  const accepted = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
  return (node.capabilities.ioProfile.outputKinds.includes("video") || node.capabilities.ioProfile.outputKinds.includes("any"))
    && accepted.includes("text")
    && (countRequiredInputs(node, "video") + countRequiredInputs(node, "any") >= 1)
    && (
      node.capabilities.planningHints.includes("prefer_for_voiceover_video")
      || node.capabilities.taskTags.includes("voiceover-video")
      || /lipsync|lip-sync|voiceover/.test(modelText(node))
    );
}

function scoreVoiceoverVideoNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_voiceover_video")) score += 10;
  if (node.capabilities.taskTags.includes("voiceover-video")) score += 8;
  if (/pixverse/.test(modelText(node))) score += 6;
  if (/kling/.test(modelText(node))) score += 4;
  if (/lipsync|lip-sync|voiceover/.test(modelText(node))) score += 4;
  return score;
}

function isPromptInputNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("text")
    && node.capabilities.ioProfile.requiredInputKinds.length === 0
    && (
      node.capabilities.planningHints.includes("prefer_for_prompt_source")
      || node.capabilities.taskTags.includes("prompt-source")
      || node.capabilities.taskTags.includes("prompt-input")
      || node.nodeType === "promptV3"
    );
}

function scorePromptInputNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_prompt_source")) score += 8;
  if (node.capabilities.taskTags.includes("prompt-source")) score += 6;
  if (node.capabilities.taskTags.includes("prompt-input")) score += 4;
  if (node.capabilities.ioProfile.summary === "none -> text") score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 2;
  if (node.nodeType === "promptV3") score += 4;
  return score;
}

function isPromptComposeNode(node: NodeSpec): boolean {
  const requiredTextInputs = node.ports.filter((port) =>
    port.direction === "input"
    && port.required
    && ((port.accepts || [port.kind]).includes("text") || port.kind === "text"),
  );
  const outputsText = node.ports.some((port) =>
    port.direction === "output"
    && ((port.produces || [port.kind]).includes("text") || port.kind === "text"),
  );

  return requiredTextInputs.length >= 2
    && outputsText
    && (
      node.capabilities.planningHints.includes("prefer_for_prompt_compose")
      || node.capabilities.taskTags.includes("prompt-compose")
      || node.nodeType === "prompt_concat"
      || /prompt.*concat|concat.*prompt/.test(node.displayName.toLowerCase())
    );
}

function scorePromptComposeNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_prompt_compose")) score += 8;
  if (node.capabilities.taskTags.includes("prompt-compose")) score += 6;
  if (node.capabilities.taskTags.includes("prompt-concatenate")) score += 4;
  if (node.nodeType === "prompt_concat") score += 5;
  if (/prompt concatenator/.test(node.displayName.toLowerCase())) score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 3;
  if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
  return score;
}

function isArrayInputNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("array")
    && (
      node.capabilities.taskTags.includes("array-input")
      || node.capabilities.taskTags.includes("collection-input")
      || node.nodeType === "array"
      || node.displayName === "Array"
    );
}

function scoreArrayInputNode(node: NodeSpec): number {
  let score = 0;
  const requiredInputs = node.ports.filter((port) => port.direction === "input" && port.required).length;
  if (node.capabilities.planningHints.includes("prefer_for_array_input")) score += 10;
  if (node.capabilities.taskTags.includes("array-input")) score += 8;
  if (node.capabilities.planningHints.includes("prefer_for_fanin")) score += 4;
  if (node.nodeType === "array") score += 4;
  if (requiredInputs === 0) score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 2;
  return score;
}

function isRouterNode(node: NodeSpec): boolean {
  return node.displayName === "Router"
    || node.nodeType === "router"
    || node.capabilities.taskTags.includes("router")
    || node.capabilities.planningHints.includes("prefer_for_router");
}

function scoreRouterNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_router")) score += 10;
  if (node.capabilities.planningHints.includes("prefer_for_fanout_routing")) score += 8;
  if (node.capabilities.taskTags.includes("router")) score += 8;
  if (node.capabilities.taskTags.includes("fanout-routing")) score += 6;
  if (node.nodeType === "router") score += 6;
  if (node.displayName === "Router") score += 4;
  if (node.capabilities.ioProfile.outputKinds.includes("any")) score += 4;
  if ((node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds).includes("any")) score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 2;
  return score;
}

function getIteratorItemKind(node: NodeSpec): ValueKind | null {
  if (node.capabilities.taskTags.includes("image-iterator") || node.displayName === "Image Iterator") {
    return "image";
  }
  if (node.capabilities.taskTags.includes("video-iterator") || node.displayName === "Video Iterator") {
    return "video";
  }
  if (node.capabilities.taskTags.includes("text-iterator") || node.displayName === "Text Iterator") {
    return "text";
  }
  return null;
}

function isCollectionIteratorNode(node: NodeSpec, itemKind?: ValueKind | null): boolean {
  const iteratorKind = getIteratorItemKind(node);
  if (!iteratorKind) {
    return false;
  }

  if (itemKind && iteratorKind !== itemKind) {
    return false;
  }

  return node.capabilities.taskTags.includes("collection-iterator")
    || node.capabilities.taskTags.includes("map")
    || node.capabilities.taskTags.includes("foreach")
    || node.capabilities.taskTags.includes("fanout");
}

function scoreCollectionIteratorNode(node: NodeSpec, itemKind?: ValueKind | null): number {
  let score = 0;
  const iteratorKind = getIteratorItemKind(node);
  if (iteratorKind && itemKind && iteratorKind === itemKind) score += 12;
  if (node.capabilities.planningHints.includes("prefer_for_map")) score += 8;
  if (node.capabilities.planningHints.includes("prefer_for_foreach")) score += 6;
  if (node.capabilities.planningHints.includes("prefer_for_fanout")) score += 6;
  if (iteratorKind === "image" && node.capabilities.planningHints.includes("prefer_for_image_iterator")) score += 10;
  if (iteratorKind === "video" && node.capabilities.planningHints.includes("prefer_for_video_iterator")) score += 10;
  if (iteratorKind === "text" && node.capabilities.planningHints.includes("prefer_for_text_iterator")) score += 10;
  if (node.capabilities.taskTags.includes("collection-iterator")) score += 6;
  if (node.capabilities.taskTags.includes("map")) score += 4;
  if (node.capabilities.taskTags.includes("foreach")) score += 4;
  if (node.capabilities.taskTags.includes("fanout")) score += 4;
  if (node.capabilities.ioProfile.acceptedInputKinds?.includes("array")) score += 4;
  if (node.capabilities.dependencyComplexity === "simple") score += 2;
  return score;
}

function isAudioGeneratorNode(node: NodeSpec): boolean {
  const acceptedInputKinds = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
  return node.capabilities.ioProfile.outputKinds.includes("audio")
    && (
      node.capabilities.taskTags.includes("generate-audio")
      || node.capabilities.taskTags.includes("text-to-speech")
      || acceptedInputKinds.includes("text")
      || /audio|voice|speech/.test(modelText(node))
    );
}

function scoreAudioGeneratorNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_text_to_speech")) score += 10;
  if (node.capabilities.planningHints.includes("prefer_for_generate_audio")) score += 8;
  if (node.capabilities.taskTags.includes("text-to-speech")) score += 8;
  if (node.capabilities.taskTags.includes("generate-audio")) score += 6;
  if (node.capabilities.ioProfile.outputKinds.includes("audio")) score += 6;
  if (/mmaudio|audio/.test(modelText(node))) score += 4;
  return score;
}

function isAudioVideoMergeNode(node: NodeSpec): boolean {
  const acceptedInputKinds = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
  return node.capabilities.ioProfile.outputKinds.includes("video")
    && (acceptedInputKinds.includes("audio") || countRequiredInputs(node, "audio") >= 1)
    && (acceptedInputKinds.includes("video") || countRequiredInputs(node, "video") >= 1)
    && (
      node.capabilities.taskTags.includes("merge-audio-video")
      || node.capabilities.planningHints.includes("prefer_for_merge_audio_video")
      || /merge audio and video/.test(modelText(node))
    );
}

function scoreAudioVideoMergeNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_merge_audio_video")) score += 10;
  if (node.capabilities.taskTags.includes("merge-audio-video")) score += 8;
  if (node.capabilities.ioProfile.outputKinds.includes("video")) score += 6;
  if (/merge audio and video/.test(modelText(node))) score += 6;
  return score;
}

function isCaptionExtractNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("text")
    && (
      node.capabilities.taskTags.includes("caption-extract")
      || node.capabilities.planningHints.includes("prefer_for_caption_extract")
      || /describer|caption/.test(modelText(node))
    );
}

function scoreCaptionExtractNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_caption_extract")) score += 10;
  if (node.capabilities.taskTags.includes("caption-extract")) score += 8;
  if (/image describer/.test(modelText(node))) score += 6;
  if (/video describer/.test(modelText(node))) score += 4;
  return score;
}

function isTranscriptExtractNode(node: NodeSpec): boolean {
  return node.capabilities.ioProfile.outputKinds.includes("text")
    && (
      node.capabilities.taskTags.includes("transcript-extract")
      || node.capabilities.planningHints.includes("prefer_for_transcript_extract")
      || /transcript|speech to text|describer/.test(modelText(node))
    );
}

function scoreTranscriptExtractNode(node: NodeSpec): number {
  let score = 0;
  if (node.capabilities.planningHints.includes("prefer_for_transcript_extract")) score += 10;
  if (node.capabilities.taskTags.includes("transcript-extract")) score += 8;
  if (/video describer/.test(modelText(node))) score += 4;
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
    registry.nodeSpecs.filter(isPromptInputNode),
    scorePromptInputNode,
  ).slice(0, 1);
}

export function selectPromptVariableCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isPromptInputNode),
    scorePromptInputNode,
  ).slice(0, 1);
}

export function selectPromptComposeCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isPromptComposeNode),
    scorePromptComposeNode,
  ).slice(0, 1);
}

export function selectPromptNodeCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) =>
      node.capabilities.planningHints.includes("prefer_for_prompt_scaffold")
      || node.capabilities.planningHints.includes("prefer_for_prompt_source")
      || node.capabilities.taskTags.includes("prompt-variable-target")
      || node.capabilities.taskTags.includes("prompt-source")
      || node.nodeType === "promptV3"
    ),
    (node) => {
      let score = 0;
      if (node.capabilities.planningHints.includes("prefer_for_prompt_scaffold")) score += 10;
      if (node.capabilities.planningHints.includes("prefer_for_prompt_source")) score += 8;
      if (node.capabilities.taskTags.includes("prompt-variable-target")) score += 6;
      if (node.capabilities.taskTags.includes("prompt-source")) score += 4;
      if (node.capabilities.ioProfile.summary === "none -> text") score += 4;
      if (node.capabilities.dependencyComplexity === "simple") score += 2;
      if (node.nodeType === "promptV3") score += 2;
      return score;
    },
  ).slice(0, 1);
}

export function selectPromptEnhancerCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) =>
      node.capabilities.planningHints.includes("prefer_for_prompt_refinement")
      || node.capabilities.planningHints.includes("prefer_for_prompt_enhancement")
      || node.capabilities.taskTags.includes("prompt-enhancement")
      || node.capabilities.taskTags.includes("prompt-enhance")
      || node.nodeType === "prompt_enhance"
    ),
    (node) => {
      let score = 0;
      if (node.capabilities.planningHints.includes("prefer_for_prompt_refinement")) score += 10;
      if (node.capabilities.planningHints.includes("prefer_for_prompt_enhancement")) score += 8;
      if (node.capabilities.taskTags.includes("prompt-enhancement")) score += 6;
      if (node.capabilities.taskTags.includes("prompt-enhance")) score += 6;
      if (node.capabilities.ioProfile.summary === "text -> text") score += 4;
      if (node.capabilities.dependencyComplexity === "simple") score += 2;
      return score;
    },
  ).slice(0, 1);
}

export function selectPromptDescriberCandidates(
  registry: NormalizedRegistrySnapshot,
  kind: "image" | "video",
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) =>
      node.capabilities.planningHints.includes("prefer_for_asset_to_prompt")
      && node.capabilities.ioProfile.requiredInputKinds.includes(kind)
      && !node.capabilities.planningHints.some((hint) => hint.startsWith("avoid_"))
      && node.capabilities.hiddenDependencies.length === 0
      && node.capabilities.dependencyComplexity !== "heavy"
    ),
    (node) => {
      let score = 0;
      if (node.capabilities.planningHints.includes("prefer_for_asset_to_prompt")) score += 10;
      if (node.capabilities.taskTags.includes("asset-description")) score += 6;
      if (node.capabilities.taskTags.includes("prompt-authoring")) score += 4;
      if (node.capabilities.ioProfile.outputKinds.includes("text")) score += 4;
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

export function selectMultiImageComposeCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isMultiImageComposeNode),
    scoreMultiImageComposeNode,
  ).slice(0, 1);
}

export function selectStyleTransferEditCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isStyleTransferNode),
    scoreStyleTransferNode,
  ).slice(0, 1);
}

export function selectMaskFromTextCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isMaskFromTextNode),
    scoreMaskFromTextNode,
  ).slice(0, 1);
}

export function selectInpaintCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isInpaintNode),
    scoreInpaintNode,
  ).slice(0, 1);
}

export function selectTextToImageCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  _availableKinds: Iterable<ValueKind>,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToImageGenerator),
    (node) => scorePromptToImageGenerator(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
    normalizeDisplayKey,
    1,
  );
}

export function selectCompareTextToImageCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  count = 2,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToImageGenerator),
    (node) => scorePromptToImageGenerator(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
    normalizeDisplayKey,
    Math.max(2, count),
  );
}

export function selectTextToVideoCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  _availableKinds: Iterable<ValueKind>,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToVideoGenerator),
    (node) => scorePromptToVideoGenerator(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
    normalizeDisplayKey,
    1,
  );
}

export function selectCompareTextToVideoCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  count = 2,
): string[] {
  return distinctTopDefinitionIds(
    registry.nodeSpecs.filter(isPromptToVideoGenerator),
    (node) => scorePromptToVideoGenerator(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
    normalizeDisplayKey,
    Math.max(2, count),
  );
}

export function selectImageToVideoCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isImageToVideoNode),
    (node) => scoreImageToVideoNode(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
  ).slice(0, 1);
}

export function selectVideoConcatCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isVideoConcatNode),
    scoreVideoConcatNode,
  ).slice(0, 1);
}

export function selectVoiceoverVideoCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isVoiceoverVideoNode),
    (node) => scoreVoiceoverVideoNode(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
  ).slice(0, 1);
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

export function selectArrayInputCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isArrayInputNode),
    scoreArrayInputNode,
  ).slice(0, 1);
}

export function selectRouterCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isRouterNode),
    scoreRouterNode,
  ).slice(0, 1);
}

export function selectImageCollectionCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return selectArrayInputCandidates(registry);
}

export function selectReferenceSetCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return selectArrayInputCandidates(registry);
}

export function selectTaggedInputSetCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return selectArrayInputCandidates(registry);
}

export function selectGenerateAudioCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isAudioGeneratorNode),
    (node) => scoreAudioGeneratorNode(node) + scoreModelHints(node, extractRequestedModelHints(requestText)),
  ).slice(0, 1);
}

export function selectTextToSpeechCandidates(
  registry: NormalizedRegistrySnapshot,
  requestText: string,
): string[] {
  return selectGenerateAudioCandidates(registry, requestText);
}

export function selectSpeechToTextCandidates(
  registry: NormalizedRegistrySnapshot,
  availableKinds: Iterable<ValueKind>,
  preferredInputKind?: ValueKind | null,
): string[] {
  const requestedKinds = new Set(availableKinds);
  if (requestedKinds.size === 0 && preferredInputKind) {
    requestedKinds.add(preferredInputKind);
  }
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) => {
      if (!isTranscriptExtractNode(node)) return false;
      const accepted = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
      return requestedKinds.size === 0 || [...requestedKinds].some((kind) => accepted.includes(kind));
    }),
    scoreTranscriptExtractNode,
  ).slice(0, 1);
}

export function selectAudioConcatCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}

export function selectAudioMixCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}

export function selectMergeAudioVideoCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter(isAudioVideoMergeNode),
    scoreAudioVideoMergeNode,
  ).slice(0, 1);
}

export function selectTimelineAssembleCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return selectVideoConcatCandidates(registry);
}

export function selectTrimVideoCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}

export function selectTimelineOverlayCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}

export function selectTimelineTransitionCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}

export function selectFanoutCandidates(
  registry: NormalizedRegistrySnapshot,
  itemKind?: ValueKind | null,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) => isCollectionIteratorNode(node, itemKind)),
    (node) => scoreCollectionIteratorNode(node, itemKind),
  ).slice(0, 1);
}

export function selectFaninCandidates(
  registry: NormalizedRegistrySnapshot,
): string[] {
  return selectArrayInputCandidates(registry);
}

export function selectForeachCandidates(
  registry: NormalizedRegistrySnapshot,
  itemKind?: ValueKind | null,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) => isCollectionIteratorNode(node, itemKind)),
    (node) => scoreCollectionIteratorNode(node, itemKind),
  ).slice(0, 1);
}

export function selectMapCandidates(
  registry: NormalizedRegistrySnapshot,
  itemKind?: ValueKind | null,
): string[] {
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) => isCollectionIteratorNode(node, itemKind)),
    (node) => scoreCollectionIteratorNode(node, itemKind),
  ).slice(0, 1);
}

export function selectReduceCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}

export function selectCaptionExtractCandidates(
  registry: NormalizedRegistrySnapshot,
  availableKinds: Iterable<ValueKind>,
  preferredInputKind?: ValueKind | null,
): string[] {
  const requestedKinds = new Set(availableKinds);
  if (requestedKinds.size === 0 && preferredInputKind) {
    requestedKinds.add(preferredInputKind);
  }
  return rankDefinitionIds(
    registry.nodeSpecs.filter((node) => {
      if (!isCaptionExtractNode(node)) return false;
      const accepted = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
      return accepted.length === 0 || requestedKinds.size === 0 || [...requestedKinds].some((kind) => accepted.includes(kind));
    }),
    scoreCaptionExtractNode,
  ).slice(0, 1);
}

export function selectTranscriptExtractCandidates(
  registry: NormalizedRegistrySnapshot,
  availableKinds: Iterable<ValueKind>,
  preferredInputKind?: ValueKind | null,
): string[] {
  return selectSpeechToTextCandidates(registry, availableKinds, preferredInputKind);
}

export function selectSceneDetectCandidates(
  _registry: NormalizedRegistrySnapshot,
): string[] {
  return [];
}
