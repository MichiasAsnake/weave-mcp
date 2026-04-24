import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraphIR,
  createGraphEdgeIR,
  createGraphNodeIR,
  setGraphOutputs,
} from "../graph/builders.ts";
import { createDefaultAppModeIR, setAppModeEnabled, setAppModeFields } from "../graph/app-mode.ts";
import type { GraphAppModeIR, GraphNodeIR } from "../graph/types.ts";
import type { NodeSpec, PortSpec, ValueKind } from "../registry/types.ts";
import { selectPromptComposeCandidates, selectRouterCandidates } from "../registry/capability-selectors.ts";
import { retrieveTemplates, getTemplateGraphSummary } from "../retrieval/retrieval-service.ts";
import { pickPromptDefaultForCompiledPrompt } from "../retrieval/template-graph.ts";
import type { TemplateMatch } from "../retrieval/types.ts";
import { validateGraph } from "../validate/index.ts";
import { makeCompilerError } from "./errors.ts";
import { parseCompilerIntent } from "./intent.ts";
import { CompilerIntentSchema, CompilerResultSchema } from "./intent-zod.ts";
import { buildPromptPlan } from "./prompt-plan.ts";
import { buildClarifyingQuestions } from "./questioning.ts";
import { matchCompilerCapabilities } from "./capability-match.ts";
import type {
  CandidateSelection,
  CompiledWorkflowPlan,
  CompilerAppField,
  CompilerIntent,
  CompilerOperationKind,
  CompilerPromptDraft,
  CompilerResult,
  CompilerRuntime,
  CompilerTraceEntry,
} from "./types.ts";

interface OutputSource {
  stepId: string;
  nodeId: string;
  portKey: string;
  valueKind: ValueKind;
}

function getNodeSpec(registry: CompilerRuntime["registry"], definitionId: string): NodeSpec {
  const nodeSpec = registry.nodeSpecs.find((node) => node.source.definitionId === definitionId);
  if (!nodeSpec) {
    throw new Error(`Missing node spec for ${definitionId}`);
  }
  return nodeSpec;
}

function chooseOutputPort(nodeSpec: NodeSpec, preferredKinds: ValueKind[]): PortSpec {
  const outputPorts = nodeSpec.ports.filter((port) => port.direction === "output");
  for (const preferredKind of preferredKinds) {
    const match = outputPorts.find((port) => (port.produces || [port.kind]).includes(preferredKind) || port.kind === preferredKind || port.kind === "any");
    if (match) return match;
  }
  if (outputPorts.length === 1) return outputPorts[0];
  const anyPort = outputPorts.find((port) => port.kind === "any");
  if (anyPort) return anyPort;
  throw new Error(`No output port matches ${preferredKinds.join(',')} on ${nodeSpec.displayName}`);
}

function chooseSourceForInputPort(port: PortSpec, sources: Map<ValueKind, OutputSource>, lastSource: OutputSource | null): OutputSource | null {
  const acceptedKinds = port.accepts || [port.kind];

  for (const acceptedKind of acceptedKinds) {
    if (acceptedKind === "any") {
      if (lastSource) return lastSource;
      continue;
    }
    const source = sources.get(acceptedKind);
    if (source) return source;
  }

  if (port.kind === "any" && lastSource) {
    return lastSource;
  }

  return null;
}

function chooseOperationSourceForInputPort(
  port: PortSpec,
  sources: Map<ValueKind, OutputSource>,
  lastSource: OutputSource | null,
  preferredKind: ValueKind | null | undefined,
): OutputSource | null {
  if (preferredKind) {
    const preferredSource = sources.get(preferredKind);
    const acceptedKinds = port.accepts || [port.kind];
    if (
      preferredSource
      && (acceptedKinds.includes(preferredKind) || acceptedKinds.includes("any") || port.kind === preferredKind || port.kind === "any")
    ) {
      return preferredSource;
    }
  }

  return chooseSourceForInputPort(port, sources, lastSource);
}

function chooseInputPortForSource(nodeSpec: NodeSpec, source: OutputSource): PortSpec {
  const inputPorts = nodeSpec.ports.filter((port) => port.direction === "input");
  const match = inputPorts.find((port) => {
    return isSourceCompatibleWithPort(port, source);
  });
  if (match) return match;
  if (inputPorts.length === 1) return inputPorts[0];
  throw new Error(`No input port matches ${source.valueKind} on ${nodeSpec.displayName}`);
}

function isSourceCompatibleWithPort(port: PortSpec, source: OutputSource): boolean {
  const acceptedKinds = port.accepts || [port.kind];
  return acceptedKinds.includes(source.valueKind) || acceptedKinds.includes("any") || port.kind === source.valueKind || port.kind === "any";
}

function chooseOptionalImagePort(nodeSpec: NodeSpec, connectedInputKeys: Set<string>): PortSpec | null {
  const optionalImagePorts = nodeSpec.ports.filter((port) =>
    port.direction === "input"
    && !port.required
    && !connectedInputKeys.has(port.key)
    && ((port.accepts || [port.kind]).includes("image") || port.kind === "image"),
  );
  if (optionalImagePorts.length === 0) return null;

  const preferred = optionalImagePorts.find((port) => !/reference|style|image_2|input_image_2/.test(port.key.toLowerCase()));
  return preferred || optionalImagePorts[0];
}

function choosePreferredOptionalInputPort(
  nodeSpec: NodeSpec,
  source: OutputSource,
  connectedInputKeys: Set<string>,
): PortSpec | null {
  const optionalPorts = nodeSpec.ports.filter((port) =>
    port.direction === "input"
    && !port.required
    && !connectedInputKeys.has(port.key)
    && isSourceCompatibleWithPort(port, source),
  );
  if (optionalPorts.length === 0) {
    return null;
  }

  const scorePort = (port: PortSpec): number => {
    const key = port.key.toLowerCase();
    let score = 0;
    if (source.valueKind === "text") {
      if (/^(prompt|text|script|instruction)$/.test(key)) score += 12;
      if (/prompt|text|script|instruction/.test(key)) score += 8;
      if (/negative/.test(key)) score -= 12;
    }
    if (source.valueKind === "image") {
      if (/^(image|input_image|source_image)$/.test(key)) score += 10;
      if (/reference|style|mask|image_2|second/.test(key)) score -= 8;
    }
    if (source.valueKind === "video" && /video/.test(key)) score += 10;
    if (source.valueKind === "audio" && /audio|voice/.test(key)) score += 10;
    return score;
  };

  return optionalPorts.sort((left, right) => scorePort(right) - scorePort(left))[0] || null;
}

function choosePromptComposeInputPorts(nodeSpec: NodeSpec): PortSpec[] {
  return nodeSpec.ports
    .filter((port) =>
      port.direction === "input"
      && port.required
      && ((port.accepts || [port.kind]).includes("text") || port.kind === "text"),
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

function chooseVideoConcatInputPorts(nodeSpec: NodeSpec): PortSpec[] {
  return nodeSpec.ports
    .filter((port) =>
      port.direction === "input"
      && port.required
      && ((port.accepts || [port.kind]).includes("video") || (port.accepts || [port.kind]).includes("any") || port.kind === "video" || port.kind === "any"),
    )
    .sort((left, right) => left.key.localeCompare(right.key));
}

function chooseFirstInputPort(nodeSpec: NodeSpec): PortSpec {
  const inputPort = nodeSpec.ports.find((port) => port.direction === "input");
  if (!inputPort) {
    throw new Error(`Node ${nodeSpec.displayName} does not expose an input port.`);
  }
  return inputPort;
}

function chooseFirstOutputPort(nodeSpec: NodeSpec): PortSpec {
  const outputPort = nodeSpec.ports.find((port) => port.direction === "output");
  if (!outputPort) {
    throw new Error(`Node ${nodeSpec.displayName} does not expose an output port.`);
  }
  return outputPort;
}

function isRequiredTextInputPort(port: PortSpec): boolean {
  return port.direction === "input"
    && port.required
    && ((port.accepts || [port.kind]).includes("text") || port.kind === "text" || port.kind === "any");
}

function toFieldLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function inferFieldControl(port: PortSpec): CompilerAppField["control"] | null {
  if ((port.accepts || [port.kind]).includes("text") || port.kind === "text") return "textarea";
  if ((port.accepts || [port.kind]).includes("image") || port.kind === "image") return "image-upload";
  if ((port.accepts || [port.kind]).includes("video") || port.kind === "video") return "video-upload";
  if ((port.accepts || [port.kind]).includes("audio") || port.kind === "audio") return "audio-upload";
  if ((port.accepts || [port.kind]).includes("number") || port.kind === "number") return "number";
  return null;
}

function decorateOperationForBranch(
  operation: CandidateSelection["operation"],
  branchIndex: number,
  branchCount: number,
): CandidateSelection["operation"] {
  if (branchCount <= 1 || !operation.fieldLabels) {
    return operation;
  }

  const fieldLabels = Object.fromEntries(
    Object.entries(operation.fieldLabels).map(([key, value]) => [`${key}`, `${value} ${branchIndex + 1}`]),
  );

  return {
    ...operation,
    fieldLabels,
  };
}

function inferPromptPrimitiveAppField(
  operation: CandidateSelection["operation"],
  nodeSpec: NodeSpec,
  nodeId: string,
): CompilerAppField | null {
  if ((operation.kind !== "prompt-variable" && operation.kind !== "prompt-source") || !operation.promptKey || !operation.promptLabel) {
    return null;
  }

  const outputPort = nodeSpec.ports.find((port) =>
    port.direction === "output"
    && ((port.produces || [port.kind]).includes("text") || port.kind === "text"),
  );
  if (!outputPort) {
    return null;
  }

  return {
    key: operation.promptKey,
    label: operation.promptLabel,
    control: operation.kind === "prompt-source" ? "textarea" : "text",
    required: true,
    locked: false,
    visible: true,
    helpText: operation.kind === "prompt-source"
      ? "Enter the prompt that should drive downstream generation."
      : `Enter the ${operation.promptLabel.toLowerCase()} part of the prompt.`,
    source: {
      nodeId,
      bindingType: "output-port",
      bindingKey: outputPort.key,
    },
  };
}

function inferCollectionPrimitiveAppField(
  operation: CandidateSelection["operation"],
  nodeSpec: NodeSpec,
  nodeId: string,
): CompilerAppField | null {
  if (!["array-input", "image-collection", "reference-set", "tagged-input-set"].includes(operation.kind)) {
    return null;
  }

  const outputPort = nodeSpec.ports.find((port) =>
    port.direction === "output"
    && ((port.produces || [port.kind]).includes("array") || port.kind === "array"),
  );
  if (!outputPort) {
    return null;
  }

  const label = operation.fieldLabels?.collection
    || (operation.kind === "reference-set"
      ? "Reference Set"
      : operation.kind === "tagged-input-set"
        ? "Tagged Inputs"
        : "Collection");
  const control: CompilerAppField["control"] = operation.kind === "tagged-input-set"
    ? "tagged-image-set-upload"
    : operation.collectionItemKind === "video"
      ? "video-collection-upload"
      : operation.collectionItemKind === "audio"
        ? "audio-collection-upload"
        : "image-collection-upload";

  return {
    key: normalizeCollectionFieldKey(label),
    label,
    control,
    required: true,
    locked: false,
    visible: true,
    helpText: operation.fieldHelpText?.collection
      || `Provide ${label.toLowerCase()} for downstream collection-based processing.`,
    source: {
      nodeId,
      bindingType: "output-port",
      bindingKey: outputPort.key,
    },
  };
}

function normalizeCollectionFieldKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferOperationAppFields(
  operation: CandidateSelection["operation"],
  nodeSpec: NodeSpec,
  nodeId: string,
  connectedInputKeys: Set<string>,
  requestText: string,
): CompilerAppField[] {
  const fields: CompilerAppField[] = [];
  const operationKind = operation.kind;
  const fieldLabels = operation.fieldLabels || {};
  const fieldHelpText = operation.fieldHelpText || {};
  const candidatePorts = nodeSpec.ports.filter((port) =>
    port.direction === "input"
    && !connectedInputKeys.has(port.key)
    && (port.required || fieldLabels[port.key]),
  );

  for (const port of candidatePorts) {
    const control = inferFieldControl(port);
    if (!control) continue;

    const label = fieldLabels[port.key]
      || (operationKind === "enhance-prompt" && ((port.accepts || [port.kind]).includes("text") || port.kind === "text") ? "Prompt" : null)
      || ((operationKind === "edit-image" || operationKind === "reference-image-edit") && /prompt|instruction|text/.test(port.key.toLowerCase()) ? "Edit prompt" : null)
      || (operationKind === "reference-image-edit" && /reference|style|image_2|input_image_2|second/.test(port.key.toLowerCase()) ? "Reference image" : null)
      || toFieldLabel(port.raw && typeof port.raw === "object" && "label" in port.raw && typeof port.raw.label === "string" ? port.raw.label : port.key);

    const helpText = fieldHelpText[port.key]
      || ((operationKind === "edit-image" || operationKind === "reference-image-edit") && /prompt|instruction|text/.test(port.key.toLowerCase())
        ? "Describe how the uploaded image should be edited."
        : operationKind === "enhance-prompt" && ((port.accepts || [port.kind]).includes("text") || port.kind === "text")
          ? "Describe what should be generated; the workflow will enhance this prompt before running the model."
          : undefined);

    fields.push({
      key: `${nodeId}_${port.key}`,
      label,
      control,
      required: port.required,
      locked: false,
      visible: true,
      helpText,
      source: {
        nodeId,
        bindingType: "unconnected-input-port",
        bindingKey: port.key,
      },
    });
  }

  return fields;
}

function describePromptSupport(promptDraft: CompilerPromptDraft): string {
  return JSON.stringify({
    usePromptEnhancer: promptDraft.usePromptEnhancer,
    useAssetDescriber: promptDraft.useAssetDescriber,
    promptFields: promptDraft.fields.map((field) => field.promptKey),
  });
}

function buildCompilerExplanation(
  intent: CompilerIntent,
  plan: CompiledWorkflowPlan,
  promptDraft: CompilerPromptDraft,
) {
  const promptNotes = promptDraft.fields.map((field) => `${field.promptKey}: ${field.purpose}`);
  const promptSummary = promptDraft.fields.length > 0
    ? ` with ${promptDraft.fields.length} prompt scaffold${promptDraft.fields.length === 1 ? "" : "s"}`
    : "";
  return {
    summary: `${plan.summary}${promptSummary} for ${intent.originalRequest}.`,
    assumptions: intent.ambiguities.map((entry) => entry.message),
    promptNotes,
    suggestedTweaks: ["Adjust prompt wording or upload different reference assets to refine the generated graph."],
  };
}

function normalizeIntentForCompilation(intent: CompilerIntent, trace: CompilerTraceEntry[]): CompilerIntent {
  const operations = [...intent.operations];
  const hasCollectionIteration = operations.some((operation) =>
    operation.kind === "map" || operation.kind === "foreach",
  );
  if (!hasCollectionIteration) {
    return intent;
  }

  const finalOutputIsSingularVideo = intent.output.kind === "video"
    && operations.some((operation) => operation.kind === "output-result" && operation.inputKind === "video");
  if (!finalOutputIsSingularVideo) {
    return intent;
  }

  const videoGenerationKinds = new Set<CompilerOperationKind>([
    "generate-video",
    "compare-generate-video",
    "image-to-video",
  ]);
  const generationKinds = new Set<CompilerOperationKind>([
    ...videoGenerationKinds,
    "edit-image",
    "reference-image-edit",
    "multi-image-compose",
    "style-transfer-edit",
    "inpaint-image",
    "generate-image",
    "compare-generate-image",
  ]);
  const mergeIndex = operations.findIndex((operation) =>
    operation.kind === "merge-audio-video" || operation.kind === "voiceover-video",
  );
  const assemblyIndex = operations.findIndex((operation) =>
    operation.kind === "timeline-assemble" || operation.kind === "video-concat",
  );
  const iteratorIndex = operations.findIndex((operation) =>
    operation.kind === "map" || operation.kind === "foreach",
  );
  const generationIndex = operations.findIndex((operation, index) =>
    index > iteratorIndex && generationKinds.has(operation.kind),
  );
  const imageGenerationIndex = operations.findIndex((operation, index) =>
    index > iteratorIndex
    && [
      "edit-image",
      "reference-image-edit",
      "multi-image-compose",
      "style-transfer-edit",
      "inpaint-image",
      "generate-image",
      "compare-generate-image",
    ].includes(operation.kind),
  );
  const hasVideoGenerationAfterIterator = operations.some((operation, index) =>
    index > iteratorIndex && videoGenerationKinds.has(operation.kind),
  );

  if (iteratorIndex < 0 || generationIndex < 0) {
    return intent;
  }

  let normalizedOperations = [...operations];
  const insertIndex = mergeIndex >= 0
    ? mergeIndex
    : operations.findIndex((operation) => operation.kind === "output-result" || operation.kind === "export");
  const targetIndex = insertIndex >= 0 ? insertIndex : operations.length;

  if (imageGenerationIndex >= 0 && !hasVideoGenerationAfterIterator) {
    normalizedOperations.splice(targetIndex, 0, {
      kind: "image-to-video",
      summary: "Animate each generated scene image into a video clip.",
      inputKind: "image",
      outputKind: "video",
      requestedFormat: null,
      requiresUserInput: false,
    });
    trace.push({
      stage: "intent",
      detail: "injected image-to-video for collection-generated reel workflow",
    });
  }

  const effectiveMergeIndex = normalizedOperations.findIndex((operation) =>
    operation.kind === "merge-audio-video" || operation.kind === "voiceover-video",
  );
  const effectiveAssemblyIndex = normalizedOperations.findIndex((operation) =>
    operation.kind === "timeline-assemble" || operation.kind === "video-concat",
  );
  const effectiveTargetIndex = effectiveMergeIndex >= 0
    ? effectiveMergeIndex
    : normalizedOperations.findIndex((operation) => operation.kind === "output-result" || operation.kind === "export");
  const assemblyTargetIndex = effectiveTargetIndex >= 0 ? effectiveTargetIndex : normalizedOperations.length;

  if (effectiveAssemblyIndex >= 0) {
    if (effectiveMergeIndex >= 0 && effectiveAssemblyIndex > effectiveMergeIndex) {
      const [assemblyOperation] = normalizedOperations.splice(effectiveAssemblyIndex, 1);
      normalizedOperations.splice(
        assemblyTargetIndex > effectiveAssemblyIndex ? assemblyTargetIndex - 1 : assemblyTargetIndex,
        0,
        assemblyOperation,
      );
      trace.push({
        stage: "intent",
        detail: "moved timeline assembly ahead of audio merge for collection-to-single-video workflow",
      });
      return CompilerIntentSchema.parse({
        ...intent,
        operations: normalizedOperations,
      });
    }

    if (normalizedOperations !== operations) {
      return CompilerIntentSchema.parse({
        ...intent,
        operations: normalizedOperations,
      });
    }

    return intent;
  }

  normalizedOperations.splice(assemblyTargetIndex, 0, {
    kind: "timeline-assemble",
    summary: "Assemble the generated collection outputs into a single reel.",
    inputKind: "video",
    outputKind: "video",
    requiresUserInput: false,
    requestedFormat: null,
    branchCount: 2,
    mergeStrategy: "ordered-sequence",
  });
  trace.push({
    stage: "intent",
    detail: "injected timeline-assemble for collection-to-single-video workflow",
  });

  return CompilerIntentSchema.parse({
    ...intent,
    operations: normalizedOperations,
  });
}

function getPreferredOutputKindsForOperation(operationKind: CompilerOperationKind): ValueKind[] {
  switch (operationKind) {
    case "upload":
      return ["file", "image", "any"];
    case "array-input":
    case "image-collection":
    case "reference-set":
    case "tagged-input-set":
    case "fanout":
    case "fanin":
    case "foreach":
    case "map":
      return ["array", "object", "any"];
    case "reduce":
      return ["image", "video", "audio", "text", "any"];
    case "prompt-variable":
    case "prompt-source":
    case "prompt-compose":
    case "enhance-prompt":
      return ["text", "any"];
    case "file-to-image":
    case "upscale-image":
    case "edit-image":
    case "reference-image-edit":
    case "multi-image-compose":
    case "style-transfer-edit":
    case "inpaint-image":
    case "generate-image":
    case "compare-generate-image":
      return ["image", "file", "any"];
    case "mask-from-text":
      return ["mask", "image", "any"];
    case "generate-video":
    case "compare-generate-video":
    case "image-to-video":
    case "video-concat":
    case "voiceover-video":
    case "merge-audio-video":
    case "timeline-assemble":
    case "trim-video":
    case "timeline-overlay":
    case "timeline-transition":
      return ["video", "any"];
    case "generate-audio":
    case "text-to-speech":
    case "audio-concat":
    case "audio-mix":
      return ["audio", "any"];
    case "speech-to-text":
    case "caption-extract":
    case "transcript-extract":
      return ["text", "any"];
    case "scene-detect":
      return ["array", "object", "any"];
    case "export":
      return ["file", "any"];
    case "output-result":
      return ["any"];
    default:
      return ["any"];
  }
}

function getStepId(operationKind: CompilerOperationKind, occurrence: number): string {
  switch (operationKind) {
    case "upload":
      return "upload";
    case "array-input":
      return occurrence === 1 ? "array-input" : `array-input-${occurrence}`;
    case "image-collection":
      return occurrence === 1 ? "image-collection" : `image-collection-${occurrence}`;
    case "reference-set":
      return occurrence === 1 ? "reference-set" : `reference-set-${occurrence}`;
    case "tagged-input-set":
      return occurrence === 1 ? "tagged-input-set" : `tagged-input-set-${occurrence}`;
    case "fanout":
      return occurrence === 1 ? "fanout" : `fanout-${occurrence}`;
    case "fanin":
      return occurrence === 1 ? "fanin" : `fanin-${occurrence}`;
    case "foreach":
      return occurrence === 1 ? "foreach" : `foreach-${occurrence}`;
    case "map":
      return occurrence === 1 ? "map" : `map-${occurrence}`;
    case "reduce":
      return occurrence === 1 ? "reduce" : `reduce-${occurrence}`;
    case "prompt-variable":
      return occurrence === 1 ? "prompt-variable" : `prompt-variable-${occurrence}`;
    case "prompt-source":
      return occurrence === 1 ? "prompt" : `prompt-${occurrence}`;
    case "prompt-compose":
      return occurrence === 1 ? "compose-prompt" : `compose-prompt-${occurrence}`;
    case "file-to-image":
      return "bridge";
    case "enhance-prompt":
      return occurrence === 1 ? "enhance-prompt" : `enhance-prompt-${occurrence}`;
    case "upscale-image":
      return occurrence === 1 ? "upscale" : `upscale-${occurrence}`;
    case "edit-image":
      return occurrence === 1 ? "edit" : `edit-${occurrence}`;
    case "reference-image-edit":
      return occurrence === 1 ? "reference-edit" : `reference-edit-${occurrence}`;
    case "multi-image-compose":
      return occurrence === 1 ? "compose-images" : `compose-images-${occurrence}`;
    case "style-transfer-edit":
      return occurrence === 1 ? "style-transfer" : `style-transfer-${occurrence}`;
    case "mask-from-text":
      return occurrence === 1 ? "mask-region" : `mask-region-${occurrence}`;
    case "inpaint-image":
      return occurrence === 1 ? "inpaint" : `inpaint-${occurrence}`;
    case "generate-image":
      return occurrence === 1 ? "generate-image" : `generate-image-${occurrence}`;
    case "compare-generate-image":
      return occurrence === 1 ? "compare-image" : `compare-image-${occurrence}`;
    case "generate-video":
      return occurrence === 1 ? "generate-video" : `generate-video-${occurrence}`;
    case "compare-generate-video":
      return occurrence === 1 ? "compare-video" : `compare-video-${occurrence}`;
    case "image-to-video":
      return occurrence === 1 ? "image-to-video" : `image-to-video-${occurrence}`;
    case "video-concat":
      return occurrence === 1 ? "concat-video" : `concat-video-${occurrence}`;
    case "voiceover-video":
      return occurrence === 1 ? "voiceover-video" : `voiceover-video-${occurrence}`;
    case "generate-audio":
      return occurrence === 1 ? "generate-audio" : `generate-audio-${occurrence}`;
    case "text-to-speech":
      return occurrence === 1 ? "text-to-speech" : `text-to-speech-${occurrence}`;
    case "speech-to-text":
      return occurrence === 1 ? "speech-to-text" : `speech-to-text-${occurrence}`;
    case "audio-concat":
      return occurrence === 1 ? "concat-audio" : `concat-audio-${occurrence}`;
    case "audio-mix":
      return occurrence === 1 ? "mix-audio" : `mix-audio-${occurrence}`;
    case "merge-audio-video":
      return occurrence === 1 ? "merge-audio-video" : `merge-audio-video-${occurrence}`;
    case "timeline-assemble":
      return occurrence === 1 ? "timeline-assemble" : `timeline-assemble-${occurrence}`;
    case "trim-video":
      return occurrence === 1 ? "trim-video" : `trim-video-${occurrence}`;
    case "timeline-overlay":
      return occurrence === 1 ? "timeline-overlay" : `timeline-overlay-${occurrence}`;
    case "timeline-transition":
      return occurrence === 1 ? "timeline-transition" : `timeline-transition-${occurrence}`;
    case "caption-extract":
      return occurrence === 1 ? "caption-extract" : `caption-extract-${occurrence}`;
    case "transcript-extract":
      return occurrence === 1 ? "transcript-extract" : `transcript-extract-${occurrence}`;
    case "scene-detect":
      return occurrence === 1 ? "scene-detect" : `scene-detect-${occurrence}`;
    case "export":
      return "export";
    case "output-result":
      return "output";
    default:
      return `step-${occurrence}`;
  }
}

function getNodeId(operationKind: CompilerOperationKind, occurrence: number): string {
  switch (operationKind) {
    case "upload":
      return "uploadImageNode";
    case "array-input":
      return occurrence === 1 ? "arrayInputNode" : `arrayInputNode${occurrence}`;
    case "image-collection":
      return occurrence === 1 ? "imageCollectionNode" : `imageCollectionNode${occurrence}`;
    case "reference-set":
      return occurrence === 1 ? "referenceSetNode" : `referenceSetNode${occurrence}`;
    case "tagged-input-set":
      return occurrence === 1 ? "taggedInputSetNode" : `taggedInputSetNode${occurrence}`;
    case "fanout":
      return occurrence === 1 ? "fanoutNode" : `fanoutNode${occurrence}`;
    case "fanin":
      return occurrence === 1 ? "faninNode" : `faninNode${occurrence}`;
    case "foreach":
      return occurrence === 1 ? "foreachNode" : `foreachNode${occurrence}`;
    case "map":
      return occurrence === 1 ? "mapNode" : `mapNode${occurrence}`;
    case "reduce":
      return occurrence === 1 ? "reduceNode" : `reduceNode${occurrence}`;
    case "prompt-variable":
      return occurrence === 1 ? "promptVariableNode" : `promptVariableNode${occurrence}`;
    case "prompt-source":
      return occurrence === 1 ? "promptSourceNode" : `promptSourceNode${occurrence}`;
    case "prompt-compose":
      return occurrence === 1 ? "promptComposeNode" : `promptComposeNode${occurrence}`;
    case "file-to-image":
      return "fileToImageBridgeNode";
    case "enhance-prompt":
      return occurrence === 1 ? "enhancePromptNode" : `enhancePromptNode${occurrence}`;
    case "upscale-image":
      return occurrence === 1 ? "upscaleImageNode" : `upscaleImageNode${occurrence}`;
    case "edit-image":
      return occurrence === 1 ? "editImageNode" : `editImageNode${occurrence}`;
    case "reference-image-edit":
      return occurrence === 1 ? "referenceEditImageNode" : `referenceEditImageNode${occurrence}`;
    case "multi-image-compose":
      return occurrence === 1 ? "composeImagesNode" : `composeImagesNode${occurrence}`;
    case "style-transfer-edit":
      return occurrence === 1 ? "styleTransferNode" : `styleTransferNode${occurrence}`;
    case "mask-from-text":
      return occurrence === 1 ? "maskRegionNode" : `maskRegionNode${occurrence}`;
    case "inpaint-image":
      return occurrence === 1 ? "inpaintImageNode" : `inpaintImageNode${occurrence}`;
    case "generate-image":
      return occurrence === 1 ? "generateImageNode" : `generateImageNode${occurrence}`;
    case "compare-generate-image":
      return occurrence === 1 ? "compareImageNode" : `compareImageNode${occurrence}`;
    case "generate-video":
      return occurrence === 1 ? "generateVideoNode" : `generateVideoNode${occurrence}`;
    case "compare-generate-video":
      return occurrence === 1 ? "compareVideoNode" : `compareVideoNode${occurrence}`;
    case "image-to-video":
      return occurrence === 1 ? "imageToVideoNode" : `imageToVideoNode${occurrence}`;
    case "video-concat":
      return occurrence === 1 ? "concatVideoNode" : `concatVideoNode${occurrence}`;
    case "voiceover-video":
      return occurrence === 1 ? "voiceoverVideoNode" : `voiceoverVideoNode${occurrence}`;
    case "generate-audio":
      return occurrence === 1 ? "generateAudioNode" : `generateAudioNode${occurrence}`;
    case "text-to-speech":
      return occurrence === 1 ? "textToSpeechNode" : `textToSpeechNode${occurrence}`;
    case "speech-to-text":
      return occurrence === 1 ? "speechToTextNode" : `speechToTextNode${occurrence}`;
    case "audio-concat":
      return occurrence === 1 ? "concatAudioNode" : `concatAudioNode${occurrence}`;
    case "audio-mix":
      return occurrence === 1 ? "mixAudioNode" : `mixAudioNode${occurrence}`;
    case "merge-audio-video":
      return occurrence === 1 ? "mergeAudioVideoNode" : `mergeAudioVideoNode${occurrence}`;
    case "timeline-assemble":
      return occurrence === 1 ? "timelineAssembleNode" : `timelineAssembleNode${occurrence}`;
    case "trim-video":
      return occurrence === 1 ? "trimVideoNode" : `trimVideoNode${occurrence}`;
    case "timeline-overlay":
      return occurrence === 1 ? "timelineOverlayNode" : `timelineOverlayNode${occurrence}`;
    case "timeline-transition":
      return occurrence === 1 ? "timelineTransitionNode" : `timelineTransitionNode${occurrence}`;
    case "caption-extract":
      return occurrence === 1 ? "captionExtractNode" : `captionExtractNode${occurrence}`;
    case "transcript-extract":
      return occurrence === 1 ? "transcriptExtractNode" : `transcriptExtractNode${occurrence}`;
    case "scene-detect":
      return occurrence === 1 ? "sceneDetectNode" : `sceneDetectNode${occurrence}`;
    case "export":
      return occurrence === 1 ? "exportResultNode" : `exportResultNode${occurrence}`;
    case "output-result":
      return occurrence === 1 ? "outputResultNode" : `outputResultNode${occurrence}`;
    default:
      return `compiledNode${occurrence}`;
  }
}

function getPurpose(operationKind: CompilerOperationKind): string {
  switch (operationKind) {
    case "upload":
      return "user upload";
    case "array-input":
      return "collection input";
    case "image-collection":
      return "image collection input";
    case "reference-set":
      return "reference set input";
    case "tagged-input-set":
      return "tagged input set";
    case "fanout":
      return "collection fanout";
    case "fanin":
      return "collection fanin";
    case "foreach":
      return "sequential collection processing";
    case "map":
      return "parallel collection mapping";
    case "reduce":
      return "collection reduction";
    case "prompt-variable":
      return "named prompt variable";
    case "prompt-source":
      return "shared prompt input";
    case "prompt-compose":
      return "prompt composition";
    case "file-to-image":
      return "file to image bridge";
    case "enhance-prompt":
      return "prompt enhancement";
    case "upscale-image":
      return "image upscale";
    case "edit-image":
      return "prompt-guided image edit";
    case "reference-image-edit":
      return "reference-guided image edit";
    case "multi-image-compose":
      return "multi-image composition";
    case "style-transfer-edit":
      return "style-transfer edit";
    case "mask-from-text":
      return "mask generation";
    case "inpaint-image":
      return "masked image edit";
    case "generate-image":
      return "text-to-image generation";
    case "compare-generate-image":
      return "multi-model image comparison";
    case "generate-video":
      return "text-to-video generation";
    case "compare-generate-video":
      return "multi-model video comparison";
    case "image-to-video":
      return "image-to-video generation";
    case "video-concat":
      return "video composition";
    case "voiceover-video":
      return "voiceover video composition";
    case "generate-audio":
      return "text-to-audio generation";
    case "text-to-speech":
      return "text-to-speech generation";
    case "speech-to-text":
      return "speech-to-text analysis";
    case "audio-concat":
      return "audio concatenation";
    case "audio-mix":
      return "audio mix";
    case "merge-audio-video":
      return "audio-video merge";
    case "timeline-assemble":
      return "timeline assembly";
    case "trim-video":
      return "video trim";
    case "timeline-overlay":
      return "timeline overlay";
    case "timeline-transition":
      return "timeline transition";
    case "caption-extract":
      return "caption extraction";
    case "transcript-extract":
      return "transcript extraction";
    case "scene-detect":
      return "scene detection";
    case "export":
      return "export result";
    case "output-result":
      return "app output";
    default:
      return "workflow step";
  }
}

function buildCompiledWorkflowPlan(args: {
  registry: CompilerRuntime["registry"];
  selections: CandidateSelection[];
  graphId?: string;
  request: string;
  templateMatch?: TemplateMatch | null;
}): { plan: CompiledWorkflowPlan; graph: import('../graph/types.ts').GraphIR } {
  let graph = createEmptyGraphIR({
    registryVersion: args.registry.registryVersion,
    name: "Compiled workflow",
    description: args.request,
    graphId: args.graphId,
    sourceTemplateId: args.templateMatch?.id,
  });

  const compiledNodes: CompiledWorkflowPlan["nodes"] = [];
  const compiledEdges: CompiledWorkflowPlan["edges"] = [];
  const appFields: CompilerAppField[] = [];
  const primitiveCoverage: CompiledWorkflowPlan["primitiveCoverage"] = [];
  const gaps: CompiledWorkflowPlan["gaps"] = [];
  const occurrenceByKind = new Map<CompilerOperationKind, number>();
  const latestSourceByKind = new Map<ValueKind, OutputSource>();
  const nodeSpecByNodeId = new Map<string, NodeSpec>();
  const promptMetadataByNodeId = new Map<string, { key?: string; label?: string }>();
  const promptSourceByKey = new Map<string, OutputSource>();
  const promptComposeDefinitionId = selectPromptComposeCandidates(args.registry)[0] || null;
  const templateGraph = getTemplateGraphSummary(args.templateMatch || null);

  let latestProducedSource: OutputSource | null = null;
  let latestNode: GraphNodeIR | null = null;
  let latestIteratorTextSource: OutputSource | null = null;
  let terminalNodeIds: string[] = [];
  let branchedSources: OutputSource[] = [];

  function addCompiledNode(args: {
    stepId: string;
    node: GraphNodeIR;
    nodeSpec: NodeSpec;
    purpose: string;
  }): void {
    nodeSpecByNodeId.set(args.node.nodeId, args.nodeSpec);
    compiledNodes.push({
      stepId: args.stepId,
      definitionId: args.nodeSpec.source.definitionId,
      nodeId: args.node.nodeId,
      displayName: args.nodeSpec.displayName,
      purpose: args.purpose,
    });
  }

  function applyTemplatePromptDefault(
    operation: CandidateSelection["operation"],
    nodeSpec: NodeSpec,
    node: GraphNodeIR,
  ): GraphNodeIR {
    if (operation.kind !== "prompt-source") {
      return node;
    }

    const promptDefault = pickPromptDefaultForCompiledPrompt(
      templateGraph,
      operation.promptLabel || operation.fieldLabels?.prompt || null,
      operation.promptKey || null,
      args.request,
    );
    if (!promptDefault) {
      return node;
    }

    return {
      ...node,
      params: {
        ...node.params,
        prompt: promptDefault,
      },
    };
  }

  function registerProducedSource(
    source: OutputSource,
    outputPort: PortSpec,
    promptKey?: string,
    promptLabel?: string,
    nodeSpec?: NodeSpec,
  ): void {
    latestProducedSource = source;
    for (const producedKind of outputPort.produces || [outputPort.kind]) {
      latestSourceByKind.set(producedKind, source);
    }
    if (promptKey) {
      promptSourceByKey.set(promptKey, source);
      promptMetadataByNodeId.set(source.nodeId, { key: promptKey, label: promptLabel });
    }
    if (
      nodeSpec
      && source.valueKind === "text"
      && (nodeSpec.displayName === "Text Iterator" || nodeSpec.capabilities.taskTags.includes("text-iterator"))
    ) {
      latestIteratorTextSource = source;
    }
  }

  function addCompiledEdge(args: {
    from: OutputSource;
    toNodeId: string;
    toPort: PortSpec;
    toStepId: string;
  }): void {
    graph = addEdgeToGraph(
      graph,
      createGraphEdgeIR({
        from: {
          nodeId: args.from.nodeId,
          portKey: args.from.portKey,
          valueKind: args.from.valueKind,
        },
        to: {
          nodeId: args.toNodeId,
          portKey: args.toPort.key,
          valueKind: args.toPort.kind,
        },
      }),
    );
    compiledEdges.push({
      fromStepId: args.from.stepId,
      toStepId: args.toStepId,
      fromPortKey: args.from.portKey,
      toPortKey: args.toPort.key,
    });
  }

  function getMostRecentStaticPromptSource(excludingNodeId?: string): OutputSource | null {
    const promptSources = Array.from(promptSourceByKey.values()).filter((source) => source.nodeId !== excludingNodeId);
    return promptSources.at(-1) || null;
  }

  function normalizeTextToken(value: string | undefined | null): string {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function shouldAutoConnectPromptSource(source: OutputSource, operation: CandidateSelection["operation"]): boolean {
    if (source.valueKind !== "text") {
      return true;
    }
    const promptMetadata = promptMetadataByNodeId.get(source.nodeId);
    const targetPromptLabel = operation.fieldLabels?.prompt;
    if (!promptMetadata || !targetPromptLabel) {
      return true;
    }

    const sourceLabel = normalizeTextToken(promptMetadata.label || promptMetadata.key);
    const targetLabel = normalizeTextToken(targetPromptLabel);
    return !sourceLabel || !targetLabel || sourceLabel === targetLabel;
  }

  function maybeComposeIteratorPrompt(composeArgs: {
    stepId: string;
    targetNodeId: string;
    targetNodeSpec: NodeSpec;
    targetPort: PortSpec;
    preferredSource: OutputSource | null;
  }): OutputSource | null {
    if (!promptComposeDefinitionId || !composeArgs.preferredSource || !isRequiredTextInputPort(composeArgs.targetPort)) {
      return composeArgs.preferredSource;
    }

    const iteratorSource = latestIteratorTextSource;
    if (!iteratorSource || iteratorSource.nodeId !== composeArgs.preferredSource.nodeId || iteratorSource.portKey !== composeArgs.preferredSource.portKey) {
      return composeArgs.preferredSource;
    }
    const promptSource = getMostRecentStaticPromptSource(iteratorSource.nodeId);
    if (!promptSource || promptSource.nodeId === iteratorSource.nodeId) {
      return composeArgs.preferredSource;
    }

    const promptComposeSpec = getNodeSpec(args.registry, promptComposeDefinitionId);
    const composeInputPorts = choosePromptComposeInputPorts(promptComposeSpec);
    if (composeInputPorts.length < 2) {
      return composeArgs.preferredSource;
    }

    const composeNodeId = `${composeArgs.targetNodeId}PromptCompose`;
    if (!nodeSpecByNodeId.has(composeNodeId)) {
      const composeNode = createGraphNodeIR({
        nodeId: composeNodeId,
        definitionId: promptComposeSpec.source.definitionId,
        nodeType: promptComposeSpec.nodeType,
        displayName: promptComposeSpec.displayName,
        params: {},
      });
      graph = addNodeToGraph(graph, composeNode);
      addCompiledNode({
        stepId: `${composeArgs.stepId}-prompt-compose`,
        node: composeNode,
        nodeSpec: promptComposeSpec,
        purpose: getPurpose("prompt-compose"),
      });
      addCompiledEdge({
        from: iteratorSource,
        toNodeId: composeNode.nodeId,
        toPort: composeInputPorts[0],
        toStepId: `${composeArgs.stepId}-prompt-compose`,
      });
      addCompiledEdge({
        from: promptSource,
        toNodeId: composeNode.nodeId,
        toPort: composeInputPorts[1],
        toStepId: `${composeArgs.stepId}-prompt-compose`,
      });
    }

    const outputPort = chooseOutputPort(promptComposeSpec, ["text", "any"]);
    return {
      stepId: `${composeArgs.stepId}-prompt-compose`,
      nodeId: composeNodeId,
      portKey: outputPort.key,
      valueKind: outputPort.kind,
    };
  }

  function insertRoutersForFanout(): void {
    const routerDefinitionId = selectRouterCandidates(args.registry)[0] || null;
    if (!routerDefinitionId) {
      return;
    }

    const edgeGroups = new Map<string, typeof graph.edges>();
    for (const edge of graph.edges) {
      const key = `${edge.from.nodeId}:${edge.from.portKey}`;
      const existing = edgeGroups.get(key) || [];
      existing.push(edge);
      edgeGroups.set(key, existing);
    }

    const routerSpec = getNodeSpec(args.registry, routerDefinitionId);
    const routerInputPort = chooseFirstInputPort(routerSpec);
    const routerOutputPort = chooseFirstOutputPort(routerSpec);
    const stepByNodeId = new Map(compiledNodes.map((node) => [node.nodeId, node.stepId]));
    const hasTimelineAssemblyNode = graph.nodes.some((node) => {
      const spec = nodeSpecByNodeId.get(node.nodeId);
      return spec?.capabilities.taskTags.includes("video-concat") || spec?.capabilities.planningHints.includes("prefer_for_video_concat");
    });
    const rewrittenEdges: typeof graph.edges = [];
    const rewrittenPlanEdges: typeof compiledEdges = [];
    const processedFanoutGroups = new Set<string>();
    let routerCount = 0;

    for (const edge of graph.edges) {
      const groupKey = `${edge.from.nodeId}:${edge.from.portKey}`;
      const group = edgeGroups.get(groupKey) || [];
      const sourceNodeSpec = nodeSpecByNodeId.get(edge.from.nodeId);
      const targetNodeSpec = nodeSpecByNodeId.get(edge.to.nodeId);
      const targetIsImageToVideo = Boolean(
        targetNodeSpec
        && (
          targetNodeSpec.capabilities.taskTags.includes("image-to-video")
          || targetNodeSpec.capabilities.planningHints.includes("prefer_for_image_to_video")
          || targetNodeSpec.displayName === "Image to Video"
        ),
      );
      const shouldInsertRouter = group.length > 1 || Boolean(
        group.length === 1
        && hasTimelineAssemblyNode
        && sourceNodeSpec?.capabilities.ioProfile.outputKinds.includes("image")
        && targetIsImageToVideo,
      );

      if (!shouldInsertRouter || sourceNodeSpec?.nodeType === "router") {
        rewrittenEdges.push(edge);
        rewrittenPlanEdges.push({
          fromStepId: stepByNodeId.get(edge.from.nodeId) || edge.from.nodeId,
          toStepId: stepByNodeId.get(edge.to.nodeId) || edge.to.nodeId,
          fromPortKey: edge.from.portKey,
          toPortKey: edge.to.portKey,
        });
        continue;
      }

      if (processedFanoutGroups.has(groupKey)) {
        continue;
      }
      processedFanoutGroups.add(groupKey);
      routerCount += 1;

      const routerNodeId = `${edge.from.nodeId}Router${routerCount}`;
      const routerStepId = `${stepByNodeId.get(edge.from.nodeId) || edge.from.nodeId}-router-${routerCount}`;
      const routerNode = createGraphNodeIR({
        nodeId: routerNodeId,
        definitionId: routerSpec.source.definitionId,
        nodeType: routerSpec.nodeType,
        displayName: routerSpec.displayName,
        params: {},
      });
      graph = addNodeToGraph(graph, routerNode);
      addCompiledNode({
        stepId: routerStepId,
        node: routerNode,
        nodeSpec: routerSpec,
        purpose: "output routing",
      });
      stepByNodeId.set(routerNode.nodeId, routerStepId);

      rewrittenEdges.push(createGraphEdgeIR({
        from: edge.from,
        to: {
          nodeId: routerNode.nodeId,
          portKey: routerInputPort.key,
          valueKind: routerInputPort.kind,
        },
      }));
      rewrittenPlanEdges.push({
        fromStepId: stepByNodeId.get(edge.from.nodeId) || edge.from.nodeId,
        toStepId: routerStepId,
        fromPortKey: edge.from.portKey,
        toPortKey: routerInputPort.key,
      });

      for (const groupedEdge of group) {
        rewrittenEdges.push(createGraphEdgeIR({
          from: {
            nodeId: routerNode.nodeId,
            portKey: routerOutputPort.key,
            valueKind: routerOutputPort.kind,
          },
          to: groupedEdge.to,
        }));
        rewrittenPlanEdges.push({
          fromStepId: routerStepId,
          toStepId: stepByNodeId.get(groupedEdge.to.nodeId) || groupedEdge.to.nodeId,
          fromPortKey: routerOutputPort.key,
          toPortKey: groupedEdge.to.portKey,
        });
      }
    }

    graph = {
      ...graph,
      edges: rewrittenEdges,
    };
    compiledEdges.length = 0;
    compiledEdges.push(...rewrittenPlanEdges);
  }

  for (const selection of args.selections) {
    const occurrence = (occurrenceByKind.get(selection.operationKind) || 0) + 1;
    occurrenceByKind.set(selection.operationKind, occurrence);

    const baseStepId = getStepId(selection.operationKind, occurrence);
    const baseNodeId = getNodeId(selection.operationKind, occurrence);

    primitiveCoverage.push({
      operationKind: selection.operationKind,
      summary: selection.operation.summary,
      definitionIds: selection.definitionIds,
      registryGap: selection.registryGap === true,
      reason: selection.reason,
    });

    if (selection.registryGap) {
      gaps.push({
        operationKind: selection.operationKind,
        summary: selection.operation.summary,
        registryGap: true,
        reason: selection.reason,
        blockedOutputKind: selection.blockedOutputKind ?? selection.operation.outputKind ?? null,
      });
      continue;
    }

    if (
      (selection.operationKind === "video-concat" || selection.operationKind === "timeline-assemble")
      && (branchedSources.length > 1 || (selection.operation.branchCount || 0) > 1)
    ) {
      const definitionId = selection.definitionIds[0];
      const nodeSpec = getNodeSpec(args.registry, definitionId);
      const concatInputPorts = chooseVideoConcatInputPorts(nodeSpec);
      if (concatInputPorts.length < 2) {
        throw new Error(`Video concat node ${nodeSpec.displayName} does not expose at least two required video inputs.`);
      }

      const compatibleSources = branchedSources.filter((source) =>
        concatInputPorts.some((port) => isSourceCompatibleWithPort(port, source)),
      );
      const requestedInputCount = Math.max(selection.operation.branchCount || compatibleSources.length || 0, compatibleSources.length, 2);
      let accumulator: OutputSource | null = null;
      let remaining = [...compatibleSources];
      let consumedRequestedInputs = 0;
      let concatIndex = 0;
      while (remaining.length > 0 || consumedRequestedInputs < requestedInputCount || accumulator == null) {
        concatIndex += 1;
        const stepId = concatIndex === 1 ? baseStepId : `${baseStepId}-${concatIndex}`;
        const nodeId = concatIndex === 1 ? baseNodeId : `${baseNodeId}${concatIndex}`;
        const node = applyTemplatePromptDefault(selection.operation, nodeSpec, createGraphNodeIR({
          nodeId,
          definitionId: nodeSpec.source.definitionId,
          nodeType: nodeSpec.nodeType,
          displayName: nodeSpec.displayName,
          params: {},
        }));
        graph = addNodeToGraph(graph, node);
        addCompiledNode({
          stepId,
          node,
          nodeSpec,
          purpose: getPurpose(selection.operationKind),
        });

        const connectedInputKeys = new Set<string>();
        let inputPortIndex = 0;

        if (accumulator) {
          const accumulatorPort = concatInputPorts[inputPortIndex];
          if (accumulatorPort) {
            addCompiledEdge({
              from: accumulator,
              toNodeId: node.nodeId,
              toPort: accumulatorPort,
              toStepId: stepId,
            });
            connectedInputKeys.add(accumulatorPort.key);
            inputPortIndex += 1;
          }
        }

        while (inputPortIndex < concatInputPorts.length) {
          const inputPort = concatInputPorts[inputPortIndex];
          const nextSource = remaining.shift() || null;
          if (nextSource && isSourceCompatibleWithPort(inputPort, nextSource)) {
            addCompiledEdge({
              from: nextSource,
              toNodeId: node.nodeId,
              toPort: inputPort,
              toStepId: stepId,
            });
            connectedInputKeys.add(inputPort.key);
            consumedRequestedInputs += 1;
          } else if (consumedRequestedInputs < requestedInputCount) {
            consumedRequestedInputs += 1;
          }
          inputPortIndex += 1;
        }

        appFields.push(...inferOperationAppFields(selection.operation, nodeSpec, node.nodeId, connectedInputKeys, args.request));

        const outputPort = chooseOutputPort(nodeSpec, getPreferredOutputKindsForOperation(selection.operationKind));
        accumulator = {
          stepId,
          nodeId: node.nodeId,
          portKey: outputPort.key,
          valueKind: outputPort.kind,
        };
        registerProducedSource(accumulator, outputPort, undefined, undefined, nodeSpec);
        latestNode = node;

        if (remaining.length === 0 && consumedRequestedInputs >= requestedInputCount) {
          break;
        }
      }

      branchedSources = accumulator ? [accumulator] : [];
      continue;
    }

    const branchCount = Math.max(selection.operation.branchCount || 1, selection.definitionIds.length);
    if (branchCount > 1) {
      const nextBranchSources: OutputSource[] = [];
      const branchInputs = branchedSources.length > 0 ? [...branchedSources] : [];
      for (let index = 0; index < branchCount; index += 1) {
        const definitionId = selection.definitionIds[Math.min(index, selection.definitionIds.length - 1)];
        const nodeSpec = getNodeSpec(args.registry, definitionId);
        const nodeId = `${baseNodeId}${index + 1}`;
        const stepId = `${baseStepId}-${index + 1}`;
        const operationForBranch = decorateOperationForBranch(selection.operation, index, branchCount);
        const node = createGraphNodeIR({
          nodeId,
          definitionId: nodeSpec.source.definitionId,
          nodeType: nodeSpec.nodeType,
          displayName: nodeSpec.displayName,
          params: {},
        });
        graph = addNodeToGraph(graph, node);
        addCompiledNode({
          stepId,
          node,
          nodeSpec,
          purpose: getPurpose(selection.operationKind),
        });

        const connectedInputKeys = new Set<string>();
        const branchInput = branchInputs[index] || null;
        const manualInputKinds = new Set(operationForBranch.manualInputKinds || []);
        for (const inputPort of nodeSpec.ports.filter((port) => port.direction === "input" && port.required)) {
          const inputKinds = new Set(inputPort.accepts || [inputPort.kind]);
          if ([...inputKinds].some((kind) => manualInputKinds.has(kind))) {
            continue;
          }
          const source = branchInput
            && (((inputPort.accepts || [inputPort.kind]).includes(branchInput.valueKind)) || ((inputPort.accepts || [inputPort.kind]).includes("any")) || inputPort.kind === branchInput.valueKind || inputPort.kind === "any")
            ? branchInput
            : chooseOperationSourceForInputPort(
            inputPort,
            latestSourceByKind,
            latestProducedSource,
            operationForBranch.inputKind,
          );
          if (!source) continue;
          if (!shouldAutoConnectPromptSource(source, operationForBranch)) continue;
          const effectiveSource = maybeComposeIteratorPrompt({
            stepId,
            targetNodeId: node.nodeId,
            targetNodeSpec: nodeSpec,
            targetPort: inputPort,
            preferredSource: source,
          });
          if (!effectiveSource) continue;
          connectedInputKeys.add(inputPort.key);
          addCompiledEdge({ from: effectiveSource, toNodeId: node.nodeId, toPort: inputPort, toStepId: stepId });
        }

        if (operationForBranch.inputKind) {
          const preferredSource = latestSourceByKind.get(operationForBranch.inputKind)
            || (latestProducedSource?.valueKind === operationForBranch.inputKind ? latestProducedSource : null);
          if (preferredSource) {
            const optionalPort = choosePreferredOptionalInputPort(nodeSpec, preferredSource, connectedInputKeys);
            if (optionalPort) {
              connectedInputKeys.add(optionalPort.key);
              addCompiledEdge({ from: preferredSource, toNodeId: node.nodeId, toPort: optionalPort, toStepId: stepId });
            }
          }
        }

        const promptPrimitiveField = inferPromptPrimitiveAppField(operationForBranch, nodeSpec, node.nodeId);
        const collectionPrimitiveField = inferCollectionPrimitiveAppField(operationForBranch, nodeSpec, node.nodeId);
        if (promptPrimitiveField) {
          appFields.push(promptPrimitiveField);
        } else if (collectionPrimitiveField) {
          appFields.push(collectionPrimitiveField);
        } else {
          appFields.push(...inferOperationAppFields(operationForBranch, nodeSpec, node.nodeId, connectedInputKeys, args.request));
        }

        const outputPort = chooseOutputPort(nodeSpec, getPreferredOutputKindsForOperation(selection.operationKind));
        const branchSource: OutputSource = {
          stepId,
          nodeId: node.nodeId,
          portKey: outputPort.key,
          valueKind: outputPort.kind,
        };
        nextBranchSources.push(branchSource);
        registerProducedSource(branchSource, outputPort, operationForBranch.promptKey, operationForBranch.promptLabel, nodeSpec);
        latestNode = node;
      }
      branchedSources = nextBranchSources;
      continue;
    }

    if ((selection.operationKind === "output-result" || selection.operationKind === "export") && branchedSources.length > 0) {
      const definitionId = selection.definitionIds[0];
      const nodeSpec = getNodeSpec(args.registry, definitionId);
      terminalNodeIds = [];
      for (const [index, source] of branchedSources.entries()) {
        const nodeId = `${baseNodeId}${index + 1}`;
        const stepId = `${baseStepId}-${index + 1}`;
        const node = createGraphNodeIR({
          nodeId,
          definitionId: nodeSpec.source.definitionId,
          nodeType: nodeSpec.nodeType,
          displayName: nodeSpec.displayName,
          params: {},
        });
        graph = addNodeToGraph(graph, node);
        addCompiledNode({
          stepId,
          node,
          nodeSpec,
          purpose: getPurpose(selection.operationKind),
        });

      const inputPort = chooseInputPortForSource(nodeSpec, source);
        addCompiledEdge({ from: source, toNodeId: node.nodeId, toPort: inputPort, toStepId: stepId });

        latestNode = node;
        terminalNodeIds.push(node.nodeId);
      }
      branchedSources = [];
      continue;
    }

    const definitionId = selection.definitionIds[0];
    const nodeSpec = getNodeSpec(args.registry, definitionId);
    if (selection.operationKind === "prompt-compose") {
      const composeInputPorts = choosePromptComposeInputPorts(nodeSpec);
      if (composeInputPorts.length < 2) {
        throw new Error(`Prompt compose node ${nodeSpec.displayName} does not expose at least two required text inputs.`);
      }

      const requestedInputs = selection.operation.promptInputs || [];
      const availablePromptSources = requestedInputs.map((promptKey) => {
        const source = promptSourceByKey.get(promptKey);
        if (!source) {
          throw new Error(`Missing prompt source for key ${promptKey}.`);
        }
        return source;
      });

      let accumulator = availablePromptSources.shift() || null;
      let composeIndex = 0;
      while (accumulator && availablePromptSources.length > 0) {
        const inputs: OutputSource[] = [accumulator];
        while (inputs.length < composeInputPorts.length && availablePromptSources.length > 0) {
          inputs.push(availablePromptSources.shift()!);
        }

        composeIndex += 1;
        const stepId = composeIndex === 1 ? baseStepId : `${baseStepId}-${composeIndex}`;
        const nodeId = composeIndex === 1 ? baseNodeId : `${baseNodeId}${composeIndex}`;
        const node = createGraphNodeIR({
          nodeId,
          definitionId: nodeSpec.source.definitionId,
          nodeType: nodeSpec.nodeType,
          displayName: nodeSpec.displayName,
          params: {},
        });
        graph = addNodeToGraph(graph, node);
        addCompiledNode({
          stepId,
          node,
          nodeSpec,
          purpose: getPurpose(selection.operationKind),
        });

        for (const [index, source] of inputs.entries()) {
          addCompiledEdge({
            from: source,
            toNodeId: node.nodeId,
            toPort: composeInputPorts[index],
            toStepId: stepId,
          });
        }

        const outputPort = chooseOutputPort(nodeSpec, getPreferredOutputKindsForOperation(selection.operationKind));
        accumulator = {
          stepId,
          nodeId: node.nodeId,
          portKey: outputPort.key,
          valueKind: outputPort.kind,
        };
        registerProducedSource(accumulator, outputPort, selection.operation.promptKey, selection.operation.promptLabel, nodeSpec);
        latestNode = node;
      }

      branchedSources = [];
      continue;
    }

    const node = applyTemplatePromptDefault(selection.operation, nodeSpec, createGraphNodeIR({
      nodeId: baseNodeId,
      definitionId: nodeSpec.source.definitionId,
      nodeType: nodeSpec.nodeType,
      displayName: nodeSpec.displayName,
      params: {},
    }));
    graph = addNodeToGraph(graph, node);
    addCompiledNode({
      stepId: baseStepId,
      node,
      nodeSpec,
      purpose: getPurpose(selection.operationKind),
    });

    const connectedInputKeys = new Set<string>();
    const manualInputKinds = new Set(selection.operation.manualInputKinds || []);
    for (const inputPort of nodeSpec.ports.filter((port) => port.direction === "input" && port.required)) {
      const inputAcceptsImage = ((inputPort.accepts || [inputPort.kind]).includes("image") || inputPort.kind === "image");
      const connectedImageInputCount = nodeSpec.ports.filter((port) =>
        port.direction === "input"
        && connectedInputKeys.has(port.key)
        && ((port.accepts || [port.kind]).includes("image") || port.kind === "image"),
      ).length;
      const inputKinds = new Set(inputPort.accepts || [inputPort.kind]);
      if ([...inputKinds].some((kind) => manualInputKinds.has(kind))) {
        continue;
      }
      if (selection.operationKind === "reference-image-edit" && inputAcceptsImage && connectedImageInputCount >= 1) {
        continue;
      }

      const preferredSource = chooseOperationSourceForInputPort(
        inputPort,
        latestSourceByKind,
        latestProducedSource,
        selection.operation.inputKind,
      );
      if (!preferredSource) {
        continue;
      }
      if (!shouldAutoConnectPromptSource(preferredSource, selection.operation)) {
        continue;
      }
      const effectiveSource = maybeComposeIteratorPrompt({
        stepId: baseStepId,
        targetNodeId: node.nodeId,
        targetNodeSpec: nodeSpec,
        targetPort: inputPort,
        preferredSource,
      });
      if (!effectiveSource) {
        continue;
      }
      connectedInputKeys.add(inputPort.key);
      addCompiledEdge({ from: effectiveSource, toNodeId: node.nodeId, toPort: inputPort, toStepId: baseStepId });
    }

    if (selection.operation.inputKind) {
      const preferredSource = latestSourceByKind.get(selection.operation.inputKind)
        || (latestProducedSource?.valueKind === selection.operation.inputKind ? latestProducedSource : null);
      if (preferredSource && shouldAutoConnectPromptSource(preferredSource, selection.operation)) {
        const optionalPort = choosePreferredOptionalInputPort(nodeSpec, preferredSource, connectedInputKeys);
        if (optionalPort) {
          connectedInputKeys.add(optionalPort.key);
          addCompiledEdge({ from: preferredSource, toNodeId: node.nodeId, toPort: optionalPort, toStepId: baseStepId });
        }
      }
    }

    if (selection.operationKind === "edit-image") {
      const optionalImagePort = chooseOptionalImagePort(nodeSpec, connectedInputKeys);
      const imageSource = latestSourceByKind.get("image") || latestProducedSource;
      if (optionalImagePort && imageSource && imageSource.valueKind === "image") {
        connectedInputKeys.add(optionalImagePort.key);
        addCompiledEdge({ from: imageSource, toNodeId: node.nodeId, toPort: optionalImagePort, toStepId: baseStepId });
      }
    }

    const promptPrimitiveField = inferPromptPrimitiveAppField(selection.operation, nodeSpec, node.nodeId);
    const collectionPrimitiveField = inferCollectionPrimitiveAppField(selection.operation, nodeSpec, node.nodeId);
    if (promptPrimitiveField) {
      appFields.push(promptPrimitiveField);
    } else if (collectionPrimitiveField) {
      appFields.push(collectionPrimitiveField);
    } else {
      appFields.push(...inferOperationAppFields(selection.operation, nodeSpec, node.nodeId, connectedInputKeys, args.request));
    }

    latestNode = node;
    if (selection.operationKind !== "export" && selection.operationKind !== "output-result") {
      const outputPort = chooseOutputPort(nodeSpec, getPreferredOutputKindsForOperation(selection.operationKind));
      const source: OutputSource = {
        stepId: baseStepId,
        nodeId: node.nodeId,
        portKey: outputPort.key,
        valueKind: outputPort.kind,
      };
      registerProducedSource(source, outputPort, selection.operation.promptKey, selection.operation.promptLabel, nodeSpec);
      if (selection.operationKind === "image-to-video" || selection.operationKind === "generate-video") {
        branchedSources = [source];
      } else {
        branchedSources = [];
      }
    } else {
      terminalNodeIds.push(node.nodeId);
    }
  }

  insertRoutersForFanout();

  const enableAppMode = appFields.length > 0 || terminalNodeIds.length > 0;
  graph = {
    ...graph,
    appMode: createDefaultAppModeIR({
      enabled: enableAppMode,
      exposureStrategy: appFields.length > 0 ? "manual" : "auto",
      fields: [],
      sections: [],
    }),
  };
  if (appFields.length > 0) {
    graph = setAppModeEnabled(graph, true);
    graph = setAppModeFields(graph, appFields, { exposureStrategy: "manual" as GraphAppModeIR["exposureStrategy"] });
  }
  if (terminalNodeIds.length > 0) {
    graph = setGraphOutputs(graph, terminalNodeIds);
  } else if (latestNode) {
    graph = setGraphOutputs(graph, [latestNode.nodeId]);
  }

  return {
    plan: {
      summary: args.request,
      nodes: compiledNodes,
      edges: compiledEdges,
      appModeFields: appFields,
      primitiveCoverage,
      gaps,
    },
    graph,
  };
}

export async function compileWorkflowFromRequest(
  userRequest: string,
  runtime: CompilerRuntime,
): Promise<CompilerResult> {
  const trace: CompilerTraceEntry[] = [];
  const [parsedIntent, templateRetrieval] = await Promise.all([
    Promise.resolve(parseCompilerIntent(userRequest)),
    retrieveTemplates(userRequest),
  ]);
  const intent = normalizeIntentForCompilation(parsedIntent, trace);
  trace.push({ stage: "intent", detail: `domain=${intent.domain} operations=${intent.operations.map((op) => op.kind).join(',')}` });
  trace.push({
    stage: "retrieve",
    detail: `templates strategy=${templateRetrieval.strategy} top=${templateRetrieval.topMatch ? `${templateRetrieval.topMatch.name}:${templateRetrieval.topMatch.similarity.toFixed(3)}` : "none"}`,
  });

  const questions = buildClarifyingQuestions(intent);
  if (questions.length > 0) {
    return CompilerResultSchema.parse({
      ok: true,
      status: "question-required",
      intent,
      questions,
      promptDraft: [],
      plan: null,
      graph: null,
      explanation: null,
      trace,
    });
  }

  const promptDraft = buildPromptPlan(intent, runtime.registry);
  trace.push({ stage: "prompt-support", detail: describePromptSupport(promptDraft) });

  if (intent.domain === "unknown") {
    return CompilerResultSchema.parse({
      ok: false,
      intent,
      error: makeCompilerError("unsupported_domain", "The compiler intent layer could not infer a supported workflow domain."),
      promptDraft: promptDraft.fields,
      trace,
    });
  }

  const matched = await matchCompilerCapabilities(intent, runtime.registry, trace, {
    templateRetrieval,
  });
  if (matched.ok === false) {
    return CompilerResultSchema.parse({ ok: false, intent, error: matched.error, promptDraft: promptDraft.fields, trace });
  }

  const { plan, graph } = buildCompiledWorkflowPlan({
    registry: runtime.registry,
    selections: matched.selections,
    request: userRequest,
    templateMatch: templateRetrieval.topMatch,
  });
  trace.push({ stage: "compile", detail: `nodes=${plan.nodes.map((node) => node.definitionId).join(',')}` });

  const validation = validateGraph(graph, runtime.registry);
  if (!validation.ok) {
    return CompilerResultSchema.parse({
      ok: false,
      intent,
      error: makeCompilerError("graph_validation_failed", "Compiled graph failed validation.", {
        issues: validation.issues,
      }),
      promptDraft: promptDraft.fields,
      trace,
    });
  }

  trace.push({ stage: "validate", detail: `graph ok with ${graph.nodes.length} nodes` });
  return CompilerResultSchema.parse({
    ok: true,
    status: "complete",
    intent,
    questions: [],
    promptDraft: promptDraft.fields,
    plan,
    graph,
    explanation: buildCompilerExplanation(intent, plan, promptDraft),
    trace,
  });
}
