import { CAPABILITY_DOC_OVERRIDES } from "./capability-doc-overrides.ts";

import type {
  NodeCapabilitySpec,
  NodeBridgeSuitability,
  NodeDependencyComplexity,
  NodeFileExportCapability,
  NodeFunctionalRole,
  NodeSpec,
  NormalizedRegistrySnapshot,
  ParamSpec,
  PortSpec,
  RegistryCapabilitySnapshot,
  RegistryNodeCapabilityEntry,
  ValueKind,
} from "./types.ts";

interface CapabilityInferenceInput {
  definitionId: string;
  nodeType: string;
  displayName: string;
  category?: string;
  subtype?: string;
  isGenerative: boolean;
  model?: NodeSpec["model"];
  ports: PortSpec[];
  params: ParamSpec[];
}

interface StepSelectionOptions {
  availableKinds?: Iterable<ValueKind>;
  requestText?: string;
}

interface FileExportIntent {
  requestedFormats: string[];
  requiresSelectableFormat: boolean;
}

const KNOWN_FILE_FORMATS = [
  "psd",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "tif",
  "tiff",
  "bmp",
  "svg",
  "pdf",
  "heic",
  "avif",
] as const;

export function inferNodeCapabilities(input: CapabilityInferenceInput): NodeCapabilitySpec {
  const ioProfile = buildIoProfile(input.ports);
  const hiddenDependencies = inferHiddenDependencies(input, ioProfile.requiredInputKinds);
  const functionalRole = inferFunctionalRole(input, ioProfile, hiddenDependencies);
  const fileExport = inferFileExportCapability(input, ioProfile);
  const dependencyComplexity = inferDependencyComplexity(input, ioProfile, hiddenDependencies, functionalRole);
  const taskTags = inferTaskTags(input, ioProfile, functionalRole);
  const bridgeSuitability = inferBridgeSuitability(ioProfile, dependencyComplexity, functionalRole);
  const planningHints = inferPlanningHints(input, ioProfile, dependencyComplexity, functionalRole, taskTags);

  const base: NodeCapabilitySpec = {
    functionalRole,
    taskTags,
    ioProfile,
    fileExport,
    dependencyComplexity,
    hiddenDependencies,
    bridgeSuitability,
    naturalLanguageDescription: buildNaturalLanguageDescription(input, functionalRole, ioProfile, hiddenDependencies),
    commonUseCases: buildCommonUseCases(input, taskTags, functionalRole, ioProfile),
    planningHints,
  };

  return applyCapabilityDocOverrides(input, base);
}

export function refreshRegistryCapabilities(
  registry: NormalizedRegistrySnapshot,
): NormalizedRegistrySnapshot {
  return {
    ...registry,
    nodeSpecs: registry.nodeSpecs.map((nodeSpec) => ({
      ...nodeSpec,
      capabilities: inferNodeCapabilities({
        definitionId: nodeSpec.source.definitionId,
        nodeType: nodeSpec.nodeType,
        displayName: nodeSpec.displayName,
        category: nodeSpec.category,
        subtype: nodeSpec.subtype,
        isGenerative: nodeSpec.isGenerative,
        model: nodeSpec.model,
        ports: nodeSpec.ports,
        params: nodeSpec.params,
      }),
    })),
  };
}

export function buildRegistryCapabilitySnapshot(
  registry: NormalizedRegistrySnapshot,
): RegistryCapabilitySnapshot {
  const nodes: RegistryNodeCapabilityEntry[] = registry.nodeSpecs.map((nodeSpec) => ({
    definitionId: nodeSpec.source.definitionId,
    displayName: nodeSpec.displayName,
    nodeType: nodeSpec.nodeType,
    category: nodeSpec.category,
    subtype: nodeSpec.subtype,
    capabilities: nodeSpec.capabilities,
  }));

  return {
    syncId: registry.syncId,
    fetchedAt: registry.fetchedAt,
    registryVersion: registry.registryVersion,
    nodeSpecCount: registry.nodeSpecs.length,
    nodes,
    indexes: {
      byFunctionalRole: groupDefinitionIds(nodes, (node) => [node.capabilities.functionalRole]),
      byIoProfile: groupDefinitionIds(nodes, (node) => [node.capabilities.ioProfile.summary]),
      byTaskTag: groupDefinitionIds(nodes, (node) => node.capabilities.taskTags),
      bridgeTransforms: groupDefinitionIds(
        nodes.filter((node) => node.capabilities.bridgeSuitability !== "none"),
        (node) => [node.capabilities.ioProfile.summary],
      ),
    },
    reviewBuckets: {
      unknown: nodes
        .filter((node) => node.capabilities.functionalRole === "unknown")
        .map((node) => node.definitionId),
      ambiguous: nodes
        .filter((node) => node.capabilities.functionalRole === "utility")
        .map((node) => node.definitionId),
      heavyDependency: nodes
        .filter((node) => node.capabilities.dependencyComplexity === "heavy")
        .map((node) => node.definitionId),
    },
  };
}

export function renderRegistryCapabilityCatalog(
  registry: NormalizedRegistrySnapshot,
): string {
  const snapshot = buildRegistryCapabilitySnapshot(registry);
  const lines: string[] = [
    "# Weavy Capability Catalog",
    "",
    `- Registry version: ${registry.registryVersion}`,
    `- Sync ID: ${registry.syncId}`,
    `- Node count: ${registry.nodeSpecs.length}`,
    `- Warnings: ${registry.warnings.length}`,
    "",
    "## Review Buckets",
    `- Unknown: ${snapshot.reviewBuckets.unknown.length}`,
    `- Ambiguous: ${snapshot.reviewBuckets.ambiguous.length}`,
    `- Heavy dependency: ${snapshot.reviewBuckets.heavyDependency.length}`,
    "",
    "## Functional Roles",
  ];

  for (const [role, nodes] of sortEntries(groupNodeSpecsBy(registry.nodeSpecs, (node) => node.capabilities.functionalRole))) {
    lines.push(`### ${role}`);
    for (const node of sortNodeSpecs(nodes)) {
      lines.push(renderNodeCatalogLine(node));
    }
    lines.push("");
  }

  lines.push("## Transform Profiles");
  for (const [ioProfile, nodes] of sortEntries(groupNodeSpecsBy(registry.nodeSpecs, (node) => node.capabilities.ioProfile.summary))) {
    lines.push(`### ${ioProfile}`);
    for (const node of sortNodeSpecs(nodes)) {
      lines.push(renderNodeCatalogLine(node));
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function buildRegistryDefinitionCatalogForLLM(
  registry: NormalizedRegistrySnapshot,
  options: { definitionIds?: Iterable<string> } = {},
): string {
  const filter = options.definitionIds ? new Set(options.definitionIds) : null;

  return sortNodeSpecs(
    registry.nodeSpecs.filter((nodeSpec) => !filter || filter.has(nodeSpec.source.definitionId)),
  )
    .map((nodeSpec) => {
      const capabilities = nodeSpec.capabilities;
      return [
        "-",
        nodeSpec.source.definitionId,
        "|",
        nodeSpec.displayName,
        "|",
        nodeSpec.nodeType,
        "|",
        `role=${capabilities.functionalRole}`,
        "|",
        `io=${capabilities.ioProfile.summary}`,
        "|",
        `fileExport=${formatFileExportCapability(capabilities.fileExport)}`,
        "|",
        `complexity=${capabilities.dependencyComplexity}`,
        "|",
        `tags=${capabilities.taskTags.join(",")}`,
      ].join(" ");
    })
    .join("\n");
}

export function getPreferredDefinitionIdsForStep(
  step: { summary: string; expectedOutputs: string[] },
  registry: NormalizedRegistrySnapshot,
  options: StepSelectionOptions = {},
): string[] {
  const availableKinds = new Set(options.availableKinds || []);
  const stepIntentText = normalizeToken([step.summary, step.expectedOutputs.join(" ")].filter(Boolean).join(" "));
  const requestAwareText = getStepIntentText(step, options.requestText);

  if (looksLikeOutput(stepIntentText)) {
    return rankNodeSpecs(
      registry.nodeSpecs.filter((node) => node.capabilities.taskTags.includes("app-output") || node.capabilities.planningHints.includes("prefer_for_app_output")),
      (node) => {
        let score = 0;
        if (node.capabilities.planningHints.includes("prefer_for_app_output")) score += 8;
        if (node.capabilities.functionalRole === "ui-binding") score += 5;
        if (node.capabilities.ioProfile.requiredInputKinds.includes("any")) score += 4;
        if (node.capabilities.dependencyComplexity === "simple") score += 2;
        return score;
      },
    ).slice(0, 1);
  }

  if (looksLikeExport(stepIntentText)) {
    const preferImageToFile = shouldPreferImageToFileExport(requestAwareText, availableKinds);
    const fileExportIntent = inferFileExportIntent(requestAwareText);
    const compatibleCandidates = registry.nodeSpecs.filter((node) =>
      isCompatibleExportNodeForStep(node, step, options)
      && (
        preferImageToFile
          ? node.capabilities.ioProfile.summary === "image -> file" || isSelectableTerminalExportNode(node)
          : (node.capabilities.functionalRole === "export" && node.capabilities.ioProfile.outputKinds.includes("file"))
            || isSelectableTerminalExportNode(node)
      )
    );

    if (compatibleCandidates.length === 0) {
      return [];
    }

    return rankNodeSpecs(
      compatibleCandidates,
      (node) => {
        let score = 0;
        if (node.capabilities.planningHints.includes("prefer_for_generic_export")) score += 8;
        if (node.capabilities.planningHints.includes("prefer_for_image_to_file_export")) score += 5;
        if (node.capabilities.functionalRole === "export") score += 3;
        if (node.capabilities.dependencyComplexity === "simple") score += 2;
        if (node.capabilities.fileExport.mode === "selectable") score += 6;
        if (node.capabilities.fileExport.mode === "unknown") score += 1;
        if (node.capabilities.fileExport.mode === "fixed" && fileExportIntent.requestedFormats.length === 0) score -= 2;
        if (
          fileExportIntent.requestedFormats.length > 0
          && node.capabilities.fileExport.mode === "selectable"
        ) score -= 4;
        if (fileExportIntent.requestedFormats.some((format) => node.capabilities.fileExport.supportedFormats.includes(format))) {
          score += 10;
        }
        if (preferImageToFile && node.capabilities.ioProfile.summary === "image -> file") score += 2;
        return score;
      },
    ).slice(0, 1);
  }

  if (looksLikeUpscale(stepIntentText)) {
    return rankNodeSpecs(
      registry.nodeSpecs.filter((node) => node.capabilities.taskTags.includes("image-upscale")),
      (node) => {
        let score = 0;
        if (node.capabilities.planningHints.includes("prefer_for_simple_image_upscale")) score += 6;
        if (node.capabilities.ioProfile.summary === "image -> image") score += 4;
        if (node.capabilities.dependencyComplexity === "simple") score += 3;
        if (node.capabilities.dependencyComplexity === "heavy") score -= 10;
        if (availableKinds.has("image")) score += 2;
        return score;
      },
    ).slice(0, 1);
  }

  if (looksLikeGenerateImage(stepIntentText)) {
    return rankNodeSpecs(
      registry.nodeSpecs.filter((node) => {
        const acceptedInputKinds = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
        return node.capabilities.ioProfile.outputKinds.includes("image")
          && node.capabilities.ioProfile.requiredInputKinds.includes("text")
          && !acceptedInputKinds.includes("image")
          && (node.capabilities.functionalRole === "generate"
            || node.capabilities.taskTags.includes("text-to-image")
            || node.capabilities.taskTags.includes("prompt-to-image")
            || node.capabilities.planningHints.includes("prefer_for_prompt_to_image_app"));
      }),
      (node) => {
        let score = 0;
        if (node.capabilities.planningHints.includes("prefer_for_prompt_to_image_app")) score += 8;
        if (node.capabilities.taskTags.includes("text-to-image") || node.capabilities.taskTags.includes("prompt-to-image")) score += 6;
        if (node.capabilities.functionalRole === "generate") score += 4;
        if (node.capabilities.ioProfile.summary === "text -> image") score += 5;
        if (node.capabilities.dependencyComplexity === "simple") score += 3;
        if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
        return score;
      },
    ).slice(0, 1);
  }

  if (looksLikeGenerateVideo(stepIntentText)) {
    return rankNodeSpecs(
      registry.nodeSpecs.filter((node) => {
        const acceptedInputKinds = node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds;
        return (node.capabilities.ioProfile.outputKinds.includes("video") || node.capabilities.ioProfile.outputKinds.includes("any"))
          && node.capabilities.ioProfile.requiredInputKinds.includes("text")
          && !acceptedInputKinds.includes("image")
          && (node.capabilities.functionalRole === "generate"
            || node.capabilities.taskTags.includes("text-to-video")
            || node.capabilities.taskTags.includes("prompt-to-video")
            || node.capabilities.planningHints.includes("prefer_for_prompt_to_video_app"));
      }),
      (node) => {
        let score = 0;
        if (node.capabilities.planningHints.includes("prefer_for_prompt_to_video_app")) score += 8;
        if (node.capabilities.taskTags.includes("text-to-video") || node.capabilities.taskTags.includes("prompt-to-video")) score += 6;
        if (node.capabilities.functionalRole === "generate") score += 4;
        if (node.capabilities.ioProfile.summary === "text -> video") score += 6;
        if (node.capabilities.ioProfile.outputKinds.includes("video")) score += 4;
        if (node.capabilities.dependencyComplexity === "simple") score += 3;
        if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
        return score;
      },
    ).slice(0, 1);
  }

  if (looksLikeImageEdit(stepIntentText)) {
    return rankNodeSpecs(
      registry.nodeSpecs.filter((node) => node.capabilities.taskTags.includes("image-edit")),
      (node) => {
        let score = 0;
        const acceptedInputKinds = new Set(node.capabilities.ioProfile.acceptedInputKinds || node.capabilities.ioProfile.requiredInputKinds);
        const optionalInputKinds = new Set(node.capabilities.ioProfile.optionalInputKinds || []);
        const requiresImageInput = node.capabilities.ioProfile.requiredInputKinds.includes("image");
        const acceptsImageInput = acceptedInputKinds.has("image");
        const hasOptionalImageInput = optionalInputKinds.has("image");
        const acceptsTextInput = acceptedInputKinds.has("text");
        const producesImage = node.capabilities.ioProfile.outputKinds.includes("image");
        const modelText = normalizeToken([node.displayName, node.model?.name || ""].join(" "));
        const requestMentionsUploadedImage = /upload|uploaded|this image|input image|image file/.test(requestAwareText);
        const requestMentionsReferenceImage = /reference image|reference photo|reference picture|second image|another image|style reference/.test(requestAwareText);
        const requestMentionsRestyle = /restyl(?:e|ed|ing)|style transfer|make it look like|in the style of/.test(requestAwareText);
        const requestMentionsGeminiEdit = /gemini edit|gemini|nano banana/.test(requestAwareText);
        const isGeminiEditFamily = /gemini|nano banana/.test(modelText);

        if (node.capabilities.planningHints.includes("prefer_for_uploaded_image_edit")) score += 8;
        if (node.capabilities.planningHints.includes("prefer_when_request_mentions_editing")) score += 5;
        if (node.capabilities.planningHints.includes("prefer_for_optional_image_edit")) score += 4;
        if (node.capabilities.taskTags.includes("prompt-guided-image-edit")) score += 5;
        if (node.capabilities.taskTags.includes("uploaded-image-edit")) score += 4;
        if (node.capabilities.ioProfile.summary === "image+text -> image") score += 7;
        if (requiresImageInput) score += 6;
        else if (acceptsImageInput) score += 3;
        if (hasOptionalImageInput) score += 2;
        if (acceptsTextInput) score += 4;
        if (producesImage) score += 3;
        if (requestMentionsUploadedImage && requiresImageInput) score += 4;
        if (requestMentionsReferenceImage && hasOptionalImageInput) score += 10;
        if (requestMentionsRestyle && hasOptionalImageInput) score += 5;
        if (requestMentionsRestyle && isGeminiEditFamily) score += 6;
        if (requestMentionsGeminiEdit && isGeminiEditFamily) score += 14;
        if (requestMentionsGeminiEdit && node.capabilities.planningHints.includes("prefer_for_explicit_gemini_edit")) score += 10;
        if ((requestMentionsReferenceImage || requestMentionsRestyle) && node.capabilities.planningHints.includes("prefer_for_reference_image_edit")) score += 8;
        if (requestMentionsGeminiEdit && !isGeminiEditFamily) score -= 16;
        if ((requestMentionsReferenceImage || requestMentionsRestyle) && requiresImageInput && !hasOptionalImageInput) score -= 4;
        if (availableKinds.has("image") && requiresImageInput) score += 4;
        if (availableKinds.has("image") && acceptsImageInput) score += 2;
        if (availableKinds.has("image") && !acceptsImageInput) score -= 8;
        if (node.capabilities.ioProfile.summary === "text -> image") score -= 4;
        if (node.capabilities.taskTags.includes("prompt-to-image") || node.capabilities.taskTags.includes("text-to-image")) score -= 3;
        if (node.capabilities.dependencyComplexity === "simple") score += 2;
        if (node.capabilities.dependencyComplexity === "heavy") score -= 6;
        return score;
      },
    ).slice(0, 1);
  }

  if (looksLikeUpload(stepIntentText)) {
    return rankNodeSpecs(
      registry.nodeSpecs.filter((node) => node.capabilities.planningHints.includes("prefer_for_file_import")),
      (node) => {
        let score = 0;
        if (node.capabilities.ioProfile.summary === "none -> file") score += 4;
        if (node.capabilities.taskTags.includes("image-upload")) score += 2;
        return score;
      },
    ).slice(0, 1);
  }

  return [];
}

export function getBridgeDefinitionIdsForKinds(
  registry: NormalizedRegistrySnapshot,
  fromKind: ValueKind,
  toKind: ValueKind,
  limit = 2,
): string[] {
  const profile = `${fromKind} -> ${toKind}`;
  return rankNodeSpecs(
    registry.nodeSpecs.filter((node) => node.capabilities.ioProfile.summary === profile),
    (node) => {
      let score = 0;
      if (node.capabilities.bridgeSuitability === "primary") score += 5;
      if (node.capabilities.dependencyComplexity === "simple") score += 3;
      if (node.capabilities.planningHints.includes(`prefer_for_${fromKind}_to_${toKind}_bridge`)) score += 2;
      return score;
    },
  ).slice(0, limit);
}

export function isCompatibleExportNodeForStep(
  node: Pick<NodeSpec, "capabilities">,
  step: { summary: string; expectedOutputs: string[] },
  options: StepSelectionOptions = {},
): boolean {
  const availableKinds = new Set(options.availableKinds || []);
  const text = getStepIntentText(step, options.requestText);
  const preferImageToFile = shouldPreferImageToFileExport(text, availableKinds);
  const selectableTerminalExport = isSelectableTerminalExportNode(node);

  if (preferImageToFile && node.capabilities.ioProfile.summary !== "image -> file" && !selectableTerminalExport) {
    return false;
  }

  if (!preferImageToFile && !node.capabilities.ioProfile.outputKinds.includes("file") && !selectableTerminalExport) {
    return false;
  }

  return fileExportCapabilityMatchesIntent(
    node.capabilities.fileExport,
    inferFileExportIntent(text),
  );
}

function applyCapabilityDocOverrides(
  input: CapabilityInferenceInput,
  base: NodeCapabilitySpec,
): NodeCapabilitySpec {
  const matches = CAPABILITY_DOC_OVERRIDES.filter((override) => matchesOverride(input, override.match));
  if (matches.length === 0) {
    return base;
  }

  return matches.reduce<NodeCapabilitySpec>((current, override) => ({
    ...current,
    ...override.capabilities,
    ioProfile: override.capabilities.ioProfile || current.ioProfile,
    fileExport: override.capabilities.fileExport || current.fileExport,
    taskTags: dedupeStrings([...(current.taskTags || []), ...(override.capabilities.taskTags || [])]),
    hiddenDependencies: dedupeStrings([
      ...(current.hiddenDependencies || []),
      ...(override.capabilities.hiddenDependencies || []),
    ]),
    commonUseCases: dedupeStrings([
      ...(override.capabilities.commonUseCases || current.commonUseCases),
    ]).slice(0, 3),
    planningHints: dedupeStrings([...(current.planningHints || []), ...(override.capabilities.planningHints || [])]),
  }), base);
}

function matchesOverride(
  input: CapabilityInferenceInput,
  match: { definitionIds?: string[]; displayNames?: string[]; modelNamePrefixes?: string[] },
): boolean {
  if (match.definitionIds?.includes(input.definitionId)) {
    return true;
  }

  if (match.displayNames?.includes(input.displayName)) {
    return true;
  }

  const modelName = input.model?.name || "";
  if (modelName && match.modelNamePrefixes?.some((prefix) => modelName.startsWith(prefix))) {
    return true;
  }

  return false;
}

function buildIoProfile(ports: PortSpec[]): NodeCapabilitySpec["ioProfile"] {
  const inputPorts = ports.filter((port) => port.direction === "input");
  const requiredInputKinds = dedupeKinds(
    inputPorts.filter((port) => port.required).map((port) => port.kind),
  );
  const acceptedInputKinds = dedupeKinds(
    inputPorts.flatMap((port) => port.accepts || [port.kind]),
  );
  const optionalInputKinds = dedupeKinds(
    inputPorts.filter((port) => !port.required).flatMap((port) => port.accepts || [port.kind]),
  );
  const outputKinds = dedupeKinds(
    ports.filter((port) => port.direction === "output").map((port) => port.kind),
  );

  return {
    summary: `${formatKinds(requiredInputKinds)} -> ${formatKinds(outputKinds)}`,
    requiredInputKinds,
    acceptedInputKinds,
    optionalInputKinds,
    outputKinds,
  };
}

function inferFileExportCapability(
  input: CapabilityInferenceInput,
  ioProfile: NodeCapabilitySpec["ioProfile"],
): NodeFileExportCapability {
  if (!ioProfile.outputKinds.includes("file")) {
    return {
      mode: "none",
      supportedFormats: [],
    };
  }

  const supportedFormatsFromParams = dedupeStrings(
    input.params
      .filter((param) => isFileFormatSelectorParam(param))
      .flatMap((param) => extractFormatsFromValues(param.enumValues || [])),
  );

  if (input.params.some((param) => isFileFormatSelectorParam(param))) {
    return {
      mode: "selectable",
      supportedFormats: supportedFormatsFromParams,
    };
  }

  const supportedFormatsFromName = extractFormatsFromText(getSearchText(input));
  if (supportedFormatsFromName.length > 0) {
    return {
      mode: "fixed",
      supportedFormats: supportedFormatsFromName,
    };
  }

  return {
    mode: "unknown",
    supportedFormats: [],
  };
}

function inferFunctionalRole(
  input: CapabilityInferenceInput,
  ioProfile: NodeCapabilitySpec["ioProfile"],
  hiddenDependencies: string[],
): NodeFunctionalRole {
  const text = getSearchText(input);
  const hasRequiredInputs = ioProfile.requiredInputKinds.length > 0;
  const hasOutputs = ioProfile.outputKinds.length > 0;

  if (/ui|field|binding|app mode/.test(text)) {
    return "ui-binding";
  }

  if (/export|save|download|writer?/.test(text)) {
    return "export";
  }

  if (!hasRequiredInputs && hasOutputs && (ioProfile.outputKinds.includes("file") || ioProfile.outputKinds.includes("image"))) {
    return "import";
  }

  if (ioProfile.requiredInputKinds.length > 0 && ioProfile.outputKinds.length > 0) {
    if (ioProfile.summary === "file -> image" || ioProfile.summary === "image -> file") {
      return "bridge";
    }
    if (/model/.test(text) && hiddenDependencies.length > 0) {
      return "model-provider";
    }
    if (/detect|segment|caption|analy|describe|extract/.test(text)) {
      return "analyze";
    }
    return input.isGenerative ? "generate" : "transform";
  }

  if (hiddenDependencies.length > 0 || input.params.length > 0) {
    return "utility";
  }

  return "unknown";
}

function inferTaskTags(
  input: CapabilityInferenceInput,
  ioProfile: NodeCapabilitySpec["ioProfile"],
  functionalRole: NodeFunctionalRole,
): string[] {
  const text = getSearchText(input);
  const tags = new Set<string>();

  if (functionalRole === "import" && ioProfile.outputKinds.includes("file")) tags.add("file-import");
  if (functionalRole === "import" && /image/.test(text)) tags.add("image-upload");
  if (ioProfile.summary === "file -> image") tags.add("file-to-image");
  if (ioProfile.summary === "image -> file") tags.add("image-to-file");
  if (/upscale|esrgan/.test(text)) tags.add("image-upscale");
  if (/edit/.test(text) && ioProfile.outputKinds.includes("image")) tags.add("image-edit");
  if (/export/.test(text) && ioProfile.outputKinds.includes("file")) tags.add("file-export");
  if (/video/.test(text) && /export/.test(text)) tags.add("video-export");
  if (/blur/.test(text)) tags.add("image-blur");
  if (functionalRole === "transform" && ioProfile.outputKinds.includes("image")) tags.add("image-transform");
  if (tags.size === 0) tags.add(`${functionalRole}-${ioProfile.summary.replace(/\s+/g, "-")}`);

  return Array.from(tags);
}

function inferHiddenDependencies(
  input: CapabilityInferenceInput,
  requiredInputKinds: ValueKind[],
): string[] {
  const text = getSearchText(input);
  const genericKeys = new Set(["image", "file", "text", "prompt", "input", "result", "output", "video", "audio"]);

  return [
    ...input.ports.filter((port) => port.direction === "input" && port.required).map((port) => port.key),
    ...input.params.filter((param) => param.required).map((param) => param.key),
  ].filter((key) => {
    const normalized = normalizeToken(key);
    if (!normalized || genericKeys.has(normalized)) {
      return false;
    }
    if (requiredInputKinds.length === 1 && requiredInputKinds[0] === "text" && normalized === "prompt") {
      return false;
    }
    return !text.includes(normalized);
  });
}

function inferDependencyComplexity(
  input: CapabilityInferenceInput,
  ioProfile: NodeCapabilitySpec["ioProfile"],
  hiddenDependencies: string[],
  functionalRole: NodeFunctionalRole,
): NodeDependencyComplexity {
  const requiredPortCount = input.ports.filter((port) => port.direction === "input" && port.required).length;
  const requiredParamCount = input.params.filter((param) => param.required).length;

  if (hiddenDependencies.length > 0 || requiredPortCount > 1 || requiredParamCount > 1 || functionalRole === "model-provider") {
    return "heavy";
  }
  if (requiredPortCount > 0 || requiredParamCount > 0 || ioProfile.outputKinds.length > 1 || input.model?.name) {
    return "moderate";
  }
  return "simple";
}

function inferBridgeSuitability(
  ioProfile: NodeCapabilitySpec["ioProfile"],
  dependencyComplexity: NodeDependencyComplexity,
  functionalRole: NodeFunctionalRole,
): NodeBridgeSuitability {
  if (ioProfile.summary === "file -> image" || ioProfile.summary === "image -> file") {
    return dependencyComplexity === "simple" ? "primary" : "secondary";
  }
  if (functionalRole === "bridge" && dependencyComplexity !== "heavy") {
    return "secondary";
  }
  return "none";
}

function inferPlanningHints(
  input: CapabilityInferenceInput,
  ioProfile: NodeCapabilitySpec["ioProfile"],
  dependencyComplexity: NodeDependencyComplexity,
  functionalRole: NodeFunctionalRole,
  taskTags: string[],
): string[] {
  const hints = new Set<string>();

  if (taskTags.includes("file-import")) hints.add("prefer_for_file_import");
  if (taskTags.includes("image-upscale") && ioProfile.summary === "image -> image" && dependencyComplexity === "simple") {
    hints.add("prefer_for_simple_image_upscale");
  }
  if (taskTags.includes("file-to-image") && dependencyComplexity === "simple") {
    hints.add("prefer_for_file_to_image_bridge");
    hints.add("prefer_for_file_to_image_bridge");
    hints.add("requires_existing_file_input");
  }
  if (taskTags.includes("image-to-file")) hints.add("prefer_for_image_to_file_export");
  if (input.ports.some((port) => port.direction === "output" && port.kind === "file")) {
    const fileExport = inferFileExportCapability(input, ioProfile);
    if (fileExport.mode === "fixed") {
      hints.add(`fixed_file_export:${fileExport.supportedFormats.join(",") || "unknown"}`);
    }
    if (fileExport.mode === "selectable") {
      hints.add("supports_user_selected_file_format");
    }
  }
  if (dependencyComplexity === "heavy" && input.model?.name) hints.add("avoid_without_model_source");
  if (functionalRole === "export") hints.add("prefer_near_workflow_end");
  if (taskTags.includes("image-edit")) hints.add("requires_text_prompt");

  return Array.from(hints);
}

function buildNaturalLanguageDescription(
  input: CapabilityInferenceInput,
  functionalRole: NodeFunctionalRole,
  ioProfile: NodeCapabilitySpec["ioProfile"],
  hiddenDependencies: string[],
): string {
  const roleText: Record<NodeFunctionalRole, string> = {
    import: "imports external input into the graph",
    transform: "transforms incoming graph data",
    generate: "generates new output data",
    analyze: "analyzes incoming data",
    export: "exports graph output into a final artifact",
    utility: "performs a utility action inside the workflow",
    bridge: "bridges one value kind into another for later nodes",
    "model-provider": "provides model data to other nodes",
    "ui-binding": "binds graph values for end-user interaction",
    unknown: "has unclear workflow behavior",
  };

  const dependencySuffix = hiddenDependencies.length > 0
    ? ` Hidden dependencies: ${hiddenDependencies.join(", ")}.`
    : "";

  return `${input.displayName} ${roleText[functionalRole]} with transform ${ioProfile.summary}.${dependencySuffix}`.trim();
}

function buildCommonUseCases(
  input: CapabilityInferenceInput,
  taskTags: string[],
  functionalRole: NodeFunctionalRole,
  ioProfile: NodeCapabilitySpec["ioProfile"],
): string[] {
  const useCases = new Set<string>();

  if (taskTags.includes("file-import")) useCases.add("Bring a file into the workflow");
  if (taskTags.includes("image-upscale")) useCases.add("Upscale an image before export");
  if (taskTags.includes("file-to-image")) useCases.add("Convert a file input into image data");
  if (taskTags.includes("image-to-file")) useCases.add("Convert image output into a file artifact");
  if (taskTags.includes("image-edit")) useCases.add("Apply prompt-guided edits to an image");
  if (functionalRole === "export") useCases.add("Finalize workflow output for download or delivery");
  if (useCases.size === 0) useCases.add(`Use ${input.displayName} for ${ioProfile.summary} workflow steps`);

  return Array.from(useCases).slice(0, 3);
}

function groupDefinitionIds(
  nodes: RegistryNodeCapabilityEntry[],
  keysForNode: (node: RegistryNodeCapabilityEntry) => string[],
): Record<string, string[]> {
  const grouped = new Map<string, string[]>();

  for (const node of nodes) {
    for (const key of keysForNode(node)) {
      const bucket = grouped.get(key) || [];
      bucket.push(node.definitionId);
      grouped.set(key, bucket);
    }
  }

  return Object.fromEntries(
    Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, values.sort()]),
  );
}

function groupNodeSpecsBy(
  nodeSpecs: NodeSpec[],
  keyForNode: (nodeSpec: NodeSpec) => string,
): Map<string, NodeSpec[]> {
  const grouped = new Map<string, NodeSpec[]>();
  for (const nodeSpec of nodeSpecs) {
    const key = keyForNode(nodeSpec);
    const bucket = grouped.get(key) || [];
    bucket.push(nodeSpec);
    grouped.set(key, bucket);
  }
  return grouped;
}

function sortEntries<V>(map: Map<string, V>): Array<[string, V]> {
  return Array.from(map.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function sortNodeSpecs(nodeSpecs: NodeSpec[]): NodeSpec[] {
  return [...nodeSpecs].sort((left, right) => {
    return left.displayName.localeCompare(right.displayName) || left.source.definitionId.localeCompare(right.source.definitionId);
  });
}

function renderNodeCatalogLine(node: NodeSpec): string {
  const { capabilities } = node;
  const hidden = capabilities.hiddenDependencies.length > 0
    ? ` hidden=${capabilities.hiddenDependencies.join(",")}`
    : "";
  const fileExport = capabilities.fileExport.mode !== "none"
    ? ` fileExport=${formatFileExportCapability(capabilities.fileExport)}`
    : "";
  const hints = capabilities.planningHints.length > 0
    ? ` hints=${capabilities.planningHints.join(",")}`
    : "";

  return `- ${node.source.definitionId} | ${node.displayName} | io=${capabilities.ioProfile.summary} | complexity=${capabilities.dependencyComplexity} | tags=${capabilities.taskTags.join(", ")}${fileExport}${hidden}${hints}`;
}

function rankNodeSpecs(nodeSpecs: NodeSpec[], score: (nodeSpec: NodeSpec) => number): string[] {
  return sortNodeSpecs(nodeSpecs)
    .sort((left, right) => score(right) - score(left))
    .map((nodeSpec) => nodeSpec.source.definitionId);
}

function isSelectableTerminalExportNode(node: Pick<NodeSpec, "capabilities">): boolean {
  return node.capabilities.functionalRole === "export"
    && node.capabilities.fileExport.mode === "selectable"
    && node.capabilities.ioProfile.outputKinds.length === 0;
}

function inferFileExportIntent(text: string): FileExportIntent {
  return {
    requestedFormats: extractFormatsFromText(text),
    requiresSelectableFormat: /(?:user|caller|end user)[\s-]*(?:specified|selected|chosen)|(?:specified|selected|chosen|desired)\s+(?:file\s+)?format|choose.+format|pick.+format/.test(text),
  };
}

function fileExportCapabilityMatchesIntent(
  fileExport: NodeFileExportCapability,
  intent: FileExportIntent,
): boolean {
  if (fileExport.mode === "none") {
    return false;
  }

  if (intent.requiresSelectableFormat) {
    return fileExport.mode === "selectable";
  }

  if (intent.requestedFormats.length === 0) {
    return true;
  }

  const supportsRequestedFormats = intent.requestedFormats.every((format) =>
    fileExport.supportedFormats.includes(format)
  );

  if (fileExport.mode === "selectable") {
    return fileExport.supportedFormats.length === 0 || supportsRequestedFormats;
  }

  if (fileExport.mode === "fixed") {
    return supportsRequestedFormats;
  }

  return false;
}

function shouldPreferImageToFileExport(text: string, availableKinds: Set<ValueKind>): boolean {
  return availableKinds.has("image") || /image/.test(text);
}

function isFileFormatSelectorParam(param: ParamSpec): boolean {
  return /\b(?:format|extension|file type|file format|output format)\b/.test(normalizeToken(param.key));
}

function extractFormatsFromText(text: string): string[] {
  const formats: string[] = [];

  for (const format of KNOWN_FILE_FORMATS) {
    const pattern = new RegExp(`(?:\\.|\\b)${format}\\b`, "i");
    if (pattern.test(text)) {
      formats.push(format);
    }
  }

  return dedupeStrings(formats);
}

function extractFormatsFromValues(values: unknown[]): string[] {
  return dedupeStrings(
    values
      .flatMap((value) => typeof value === "string" ? extractFormatsFromText(normalizeToken(value)) : []),
  );
}

function formatFileExportCapability(fileExport: NodeFileExportCapability): string {
  if (fileExport.mode === "none") {
    return "none";
  }

  if (fileExport.supportedFormats.length === 0) {
    return fileExport.mode;
  }

  return `${fileExport.mode}(${fileExport.supportedFormats.join(",")})`;
}

function getStepIntentText(
  step: { summary: string; expectedOutputs: string[] },
  requestText?: string,
): string {
  return normalizeToken([requestText, step.summary, step.expectedOutputs.join(" ")].filter(Boolean).join(" "));
}

function looksLikeUpload(text: string): boolean {
  return /upload|import/.test(text);
}

function looksLikeUpscale(text: string): boolean {
  return /\bupscale(?:s|d|ing)?\b/.test(text);
}

function looksLikeGenerateImage(text: string): boolean {
  return /\b(generate|create|make|produce)(?:s|d|ing)?\b.*\b(image|photo|picture|art|illustration|logo|icon)\b|\btext to image\b|\bprompt to image\b|\bimage generator\b/.test(text);
}

function looksLikeGenerateVideo(text: string): boolean {
  return /\b(generate|create|make|produce)(?:s|d|ing)?\b.*\b(video|clip|animation|movie)\b|\btext to video\b|\bprompt to video\b|\bvideo generator\b/.test(text);
}

function looksLikeImageEdit(text: string): boolean {
  return /\bedit(?:s|ing|ed)?\b|\bmodif(?:y|ies|ied|ying)\b|\bretouch(?:es|ing|ed)?\b|\brestyl(?:e|es|ed|ing)\b|\btransform(?:s|ed|ing)?\b|remove background|erase|replace/.test(text);
}

function looksLikeOutput(text: string): boolean {
  return /app output|design app|workflow output|output node|expose the result|expose the resulting image|show the result in the app/.test(text);
}

function looksLikeExport(text: string): boolean {
  return /export|save|download/.test(text);
}

function getSearchText(input: CapabilityInferenceInput): string {
  return normalizeToken([input.displayName, input.nodeType, input.category, input.subtype, input.model?.name]
    .filter(Boolean)
    .join(" "));
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatKinds(kinds: ValueKind[]): string {
  return kinds.length === 0 ? "none" : kinds.join("+");
}

function dedupeKinds(kinds: ValueKind[]): ValueKind[] {
  return Array.from(new Set(kinds));
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
