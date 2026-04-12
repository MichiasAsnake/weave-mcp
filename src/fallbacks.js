const { randomUUID } = require("node:crypto");

const { getNodeName } = require("./analysis");

const EDGE_TYPE = "custom";
const OPTIONAL_INPUT_KEYS = new Set([
  "negative_prompt",
  "reference_image",
  "system_prompt",
]);
const PROMPT_IMAGE_PREFERENCES = [
  { model: "google/imagen-3-fast" },
  { model: "google/imagen-3" },
  { model: "gpt_image_1" },
  { model: "br_text2image" },
  { model: "Dalle3" },
  { model: "ig_text2image" },
];
const IMAGE_EDIT_PREFERENCES = [
  { model: "gpt_image_1_edit" },
  { model: "gemini_edit" },
  { model: "sd_img2img" },
];
const IMAGE_UPSCALE_PREFERENCES = [
  { model: "nightmareai/real-esrgan" },
];
const DISALLOWED_FALLBACK_MODELS = new Set([
  "sd3",
  "sd_inpaint",
  "sd_structure",
  "stability-ai/sdxl",
  "hyper_3d_rodin",
]);
const GOOGLE_IMAGEN_MODELS = new Set([
  "google/imagen-3",
  "google/imagen-3-fast",
]);
const GOOGLE_IMAGEN_ALLOWED_ASPECTS = [
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
];
const GPT_IMAGE_MODELS = new Set([
  "gpt_image_1",
  "gpt_image_1_edit",
]);

const MODEL_REPAIR_RULES = {
  "black-forest-labs/flux-dev": {
    candidatesBySignature: {
      prompt: PROMPT_IMAGE_PREFERENCES,
      "image,prompt": IMAGE_EDIT_PREFERENCES,
    },
  },
  sd3: {
    candidatesBySignature: {
      prompt: PROMPT_IMAGE_PREFERENCES,
    },
  },
  "stability-ai/sdxl": {
    candidatesBySignature: {
      prompt: PROMPT_IMAGE_PREFERENCES,
    },
  },
  "topaz-enhance": {
    safeBypass: true,
    candidatesBySignature: {
      image: IMAGE_UPSCALE_PREFERENCES,
    },
  },
};

function buildModelRepairPlan(
  recipe,
  { blockedModels = [], nodeDefinitions = [], modelPrices = null } = {},
) {
  const definitions = normalizeDefinitionList(nodeDefinitions);
  const priceEntries = normalizePriceEntries(modelPrices);
  const priceLookup = createPriceLookup(priceEntries);
  const blockedSet = new Set(
    blockedModels.map((value) => String(value || "").trim()).filter(Boolean),
  );
  const modelNodes = extractRecipeModelNodes(recipe).filter((node) =>
    blockedSet.size === 0
      ? Boolean(MODEL_REPAIR_RULES[node.model])
      : blockedSet.has(node.model),
  );
  const blockedNodeEntries = [];
  const actions = [];

  for (const node of modelNodes) {
    const connectedInputs = getConnectedHandleKeys(recipe, node.id, "input");
    const connectedOutputs = getConnectedHandleKeys(recipe, node.id, "output");
    const signature = buildSignature(connectedInputs);
    const rule = MODEL_REPAIR_RULES[node.model] || null;
    const alternatives = findPreferredAlternatives(
      {
        ...node,
        connectedInputs,
        connectedOutputs,
      },
      signature,
      definitions,
      priceLookup,
      {
        blockedModels: blockedSet,
      },
    );

    let recommendedAction = null;

    if (rule?.safeBypass && canBypassNode(recipe, node.id)) {
      recommendedAction = {
        type: "bypass-node",
        nodeId: node.id,
        nodeName: node.name,
        model: node.model,
        autoApplicable: true,
        reason:
          "Reconnect the blocked node's input directly to its downstream target.",
        risk: "safe",
        priority: 10,
      };
    } else if (alternatives[0]?.autoApplicable) {
      recommendedAction = {
        type: "replace-node",
        nodeId: node.id,
        nodeName: node.name,
        model: node.model,
        candidate: alternatives[0],
        autoApplicable: true,
        reason: buildReplacementReason(node, alternatives[0], connectedInputs),
        risk: "safe",
        priority: 20,
      };
    } else if (alternatives[0]) {
      recommendedAction = {
        type: "replace-node",
        nodeId: node.id,
        nodeName: node.name,
        model: node.model,
        candidate: alternatives[0],
        autoApplicable: false,
        reason:
          "A structurally similar fallback exists, but at least one connected handle would need manual review.",
        risk: "review",
        priority: 30,
      };
    }

    if (recommendedAction) {
      actions.push(recommendedAction);
    }

    blockedNodeEntries.push({
      ...node,
      connectedInputs,
      connectedOutputs,
      alternatives,
      recommendedAction,
    });
  }

  actions.sort((left, right) => left.priority - right.priority);

  return {
    blockedModels: Array.from(
      blockedSet.size > 0
        ? blockedSet
        : new Set(blockedNodeEntries.map((entry) => entry.model)),
    ),
    blockedNodes: blockedNodeEntries,
    actions,
    catalog: {
      nodeDefinitions: definitions.length,
      pricedModels: priceEntries.length,
    },
    summary: {
      blockedNodeCount: blockedNodeEntries.length,
      autoApplicableCount: actions.filter((action) => action.autoApplicable).length,
      reviewCount: actions.filter((action) => !action.autoApplicable).length,
    },
  };
}

function applyModelRepairPlan(recipe, plan, options = {}) {
  const nodeDefinitions = normalizeDefinitionList(options.nodeDefinitions || []);
  const definitionsById = new Map(nodeDefinitions.map((entry) => [entry.id, entry]));
  const cloned = cloneRecipe(recipe);
  const appliedActions = [];
  const skippedActions = [];
  const actions = (plan?.actions || []).filter((action) => action.autoApplicable);

  for (const action of actions) {
    if (action.type === "bypass-node") {
      const result = applyBypassAction(cloned, action);
      if (result.applied) {
        appliedActions.push(result.action);
      } else {
        skippedActions.push({
          ...action,
          reason: result.reason,
        });
      }
      continue;
    }

    if (action.type === "replace-node") {
      const definition = definitionsById.get(action.candidate?.definitionId);
      const result = applyReplaceNodeAction(cloned, action, definition);
      if (result.applied) {
        appliedActions.push(result.action);
      } else {
        skippedActions.push({
          ...action,
          reason: result.reason,
        });
      }
    }
  }

  return {
    recipe: cloned,
    appliedActions,
    skippedActions,
  };
}

function stabilizeRecipeForExecution(recipe, options = {}) {
  const cloned = cloneRecipe(recipe);
  const actions = [];

  for (const node of cloned.nodes || []) {
    if (normalizeAspectRatioNode(node)) {
      actions.push({
        type: "normalize-aspect-ratio",
        nodeId: node.id,
        nodeName: getNodeName(node),
        model: getModelName(node),
      });
    }

    if (node.type === "crop" && clampCropNode(node)) {
      actions.push({
        type: "clamp-crop",
        nodeId: node.id,
        nodeName: getNodeName(node),
      });
    }
  }

  return {
    recipe: cloned,
    actions,
  };
}

function extractRecipeModelNodes(recipe) {
  return (recipe.nodes || [])
    .filter((node) => {
      const modelName = getModelName(node);
      return Boolean(modelName) || Boolean(node.isModel);
    })
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: getNodeName(node),
      model: getModelName(node),
    }));
}

function findPreferredAlternatives(
  node,
  signature,
  definitions,
  priceLookup,
  options = {},
) {
  const rule = MODEL_REPAIR_RULES[node.model];
  const repairMode = inferRepairMode(node, signature);
  const preferences = [
    ...(rule?.candidatesBySignature?.[signature] || []),
    ...(rule?.candidatesBySignature?.["*"] || []),
    ...(getDefaultPreferencesForMode(repairMode) || []),
  ];

  const preferredMatches = preferences
    .map((preference) => resolveDefinitionPreference(definitions, preference))
    .filter(Boolean)
    .map((definition) =>
      buildAlternativeEntry(node, definition, priceLookup, {
        blockedModels: options.blockedModels,
        repairMode,
      }),
    )
    .filter((entry) => entry && entry.viable);

  if (preferredMatches.length > 0) {
    return dedupeAlternatives(preferredMatches);
  }

  return dedupeAlternatives(
    definitions
    .map((definition) =>
      buildAlternativeEntry(node, definition, priceLookup, {
        blockedModels: options.blockedModels,
        repairMode,
      }),
    )
    .filter((entry) => entry && entry.viable)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10),
  ).slice(0, 5);
}

function buildAlternativeEntry(
  node,
  definition,
  priceLookup,
  { blockedModels, repairMode } = {},
) {
  const blockedSet = blockedModels instanceof Set ? blockedModels : new Set();
  const connectedInputs = node.connectedInputs || [];
  const connectedOutputs = node.connectedOutputs || [];
  const inputKeys = getDefinitionHandleKeys(definition, "input");
  const outputKeys = getDefinitionHandleKeys(definition, "output");
  const requiredInputKeys = getRequiredHandleKeys(definition, "input");
  const inputMap = buildHandleMapping(connectedInputs, inputKeys, "input");
  const outputMap = buildHandleMapping(connectedOutputs, outputKeys, "output");
  const model = getModelNameFromDefinition(definition);
  const excluded =
    model === node.model ||
    blockedSet.has(model) ||
    DISALLOWED_FALLBACK_MODELS.has(model);
  const supportsRequiredInputs = requiredInputKeys.every(
    (key) => Boolean(findSourceHandleForTarget(key, connectedInputs, inputMap)),
  );
  const autoApplicable =
    connectedInputs.every((key) => Boolean(inputMap[key])) &&
    connectedOutputs.every((key) => Boolean(outputMap[key])) &&
    supportsRequiredInputs;
  const matchedPrice = lookupPriceEntry(priceLookup, definition);
  const score = scoreAlternative(definition, matchedPrice, repairMode);
  const viable =
    !excluded &&
    autoApplicable &&
    isCompatibleWithRepairMode(definition, repairMode, requiredInputKeys);

  return {
    definitionId: definition.id,
    type: definition.type,
    name: getDefinitionName(definition),
    model,
    provider: matchedPrice?.provider || null,
    credits: matchedPrice?.credits ?? null,
    inputKeys,
    outputKeys,
    requiredInputKeys,
    inputMap,
    outputMap,
    autoApplicable,
    viable,
    score,
  };
}

function resolveDefinitionPreference(definitions, preference) {
  return definitions.find((definition) => {
    if (preference.id && definition.id !== preference.id) {
      return false;
    }

    if (preference.type && definition.type !== preference.type) {
      return false;
    }

    if (
      preference.model &&
      getModelNameFromDefinition(definition) !== preference.model
    ) {
      return false;
    }

    return true;
  });
}

function applyBypassAction(recipe, action) {
  const nodeIndex = recipe.nodes.findIndex((node) => node.id === action.nodeId);
  if (nodeIndex === -1) {
    return {
      applied: false,
      reason: "Blocked node is no longer present.",
    };
  }

  const incomingEdges = recipe.edges.filter((edge) => edge.target === action.nodeId);
  const outgoingEdges = recipe.edges.filter((edge) => edge.source === action.nodeId);

  if (incomingEdges.length !== 1 || outgoingEdges.length === 0) {
    return {
      applied: false,
      reason: "Bypass requires exactly one incoming edge and at least one outgoing edge.",
    };
  }

  const incomingEdge = incomingEdges[0];
  const sourceNode = recipe.nodes.find((node) => node.id === incomingEdge.source);

  recipe.nodes.splice(nodeIndex, 1);
  recipe.edges = recipe.edges.filter(
    (edge) => edge.source !== action.nodeId && edge.target !== action.nodeId,
  );

  for (const edge of outgoingEdges) {
    const targetNode = recipe.nodes.find((node) => node.id === edge.target);
    recipe.edges.push({
      id: randomUUID(),
      data: {
        sourceColor: getNodeColor(sourceNode),
        targetColor: getNodeColor(targetNode),
      },
      type: EDGE_TYPE,
      source: incomingEdge.source,
      target: edge.target,
      selected: false,
      sourceHandle: incomingEdge.sourceHandle,
      targetHandle: edge.targetHandle,
    });
  }

  return {
    applied: true,
    action: {
      ...action,
      appliedStrategy: "bypass-node",
    },
  };
}

function applyReplaceNodeAction(recipe, action, definition) {
  if (!definition) {
    return {
      applied: false,
      reason: "Fallback node definition could not be resolved.",
    };
  }

  const nodeIndex = recipe.nodes.findIndex((node) => node.id === action.nodeId);
  if (nodeIndex === -1) {
    return {
      applied: false,
      reason: "Blocked node is no longer present.",
    };
  }

  const existingNode = recipe.nodes[nodeIndex];
  const replacementNode = buildReplacementNode(existingNode, definition, action);

  if (!replacementNode) {
    return {
      applied: false,
      reason: "The replacement node could not preserve the required connections.",
    };
  }

  recipe.nodes[nodeIndex] = replacementNode;
  recipe.edges = recipe.edges.map((edge) =>
    rewriteEdgeForReplacement(edge, action.nodeId, action.candidate),
  );
  retargetDownstreamCropNodes(recipe, action.nodeId, existingNode, replacementNode);

  return {
    applied: true,
    action: {
      ...action,
      appliedStrategy: "replace-node",
    },
  };
}

function buildReplacementNode(existingNode, definition, action) {
  const nextData = cloneJson(definition.data || {});
  const nextInputKeys = getDefinitionHandleKeys(definition, "input");
  const nextOutputKeys = getDefinitionHandleKeys(definition, "output");
  const mappedInputs = {};

  for (const [currentKey, value] of Object.entries(existingNode.data?.input || {})) {
    const nextKey =
      action.candidate?.inputMap?.[currentKey] ||
      mapHandleKey(currentKey, nextInputKeys, "input");
    if (!nextKey) {
      continue;
    }
    mappedInputs[nextKey] = cloneJson(value);
  }

  if (Object.keys(mappedInputs).length > 0) {
    nextData.input = mappedInputs;
  }

  nextData.params = mergeParams(
    definition.data?.params || {},
    existingNode.data?.params || {},
    definition.data?.schema || {},
  );
  normalizeReplacementParams(nextData, existingNode, definition);

  if (nextOutputKeys.length > 0) {
    delete nextData.output;
    delete nextData.result;
    delete nextData.inputNode;
  }

  return {
    ...existingNode,
    isModel: definition.isModel ?? existingNode.isModel,
    type: definition.type,
    dragHandle: definition.dragHandle || existingNode.dragHandle,
    originalName: getDefinitionName(definition),
    data: nextData,
  };
}

function rewriteEdgeForReplacement(edge, nodeId, candidate) {
  if (edge.target === nodeId && edge.targetHandle) {
    const currentKey = parseHandleKey(edge.targetHandle, nodeId, "input");
    const nextKey = candidate?.inputMap?.[currentKey];
    if (nextKey) {
      edge.targetHandle = buildEdgeHandle(nodeId, "input", nextKey);
    }
  }

  if (edge.source === nodeId && edge.sourceHandle) {
    const currentKey = parseHandleKey(edge.sourceHandle, nodeId, "output");
    const nextKey = candidate?.outputMap?.[currentKey];
    if (nextKey) {
      edge.sourceHandle = buildEdgeHandle(nodeId, "output", nextKey);
    }
  }

  return edge;
}

function normalizeReplacementParams(nextData, existingNode, definition) {
  const model = getModelNameFromDefinition(definition);
  const outputDimensions = getNodeOutputDimensions(existingNode);

  if (definition.type === "text2image") {
    preserveTextToImageDimensions(nextData, outputDimensions);
  }

  if (
    GOOGLE_IMAGEN_MODELS.has(model) &&
    typeof nextData.params?.aspect_ratio === "string"
  ) {
    nextData.params.aspect_ratio = normalizeImagenAspectRatio(
      nextData.params.aspect_ratio,
      outputDimensions,
    );
  }

  if (GPT_IMAGE_MODELS.has(model) && nextData.params?.size) {
    nextData.params.size = normalizeGptImageSize(outputDimensions);
  }
}

function normalizeAspectRatioNode(node) {
  const model = getModelName(node);
  const params = node?.data?.params;
  if (!params) {
    return false;
  }

  let changed = false;
  const outputDimensions = getNodeOutputDimensions(node);

  if (
    GOOGLE_IMAGEN_MODELS.has(model) &&
    typeof params.aspect_ratio === "string" &&
    !GOOGLE_IMAGEN_ALLOWED_ASPECTS.includes(params.aspect_ratio)
  ) {
    const nextAspect = normalizeImagenAspectRatio(params.aspect_ratio, outputDimensions);
    if (nextAspect && nextAspect !== params.aspect_ratio) {
      params.aspect_ratio = nextAspect;
      changed = true;
    }
  }

  if (GPT_IMAGE_MODELS.has(model) && typeof params.size === "string") {
    const nextSize = normalizeGptImageSize(outputDimensions);
    if (nextSize && nextSize !== params.size) {
      params.size = nextSize;
      changed = true;
    }
  }

  return changed;
}

function preserveTextToImageDimensions(nextData, outputDimensions) {
  const width = Number(outputDimensions?.width);
  const height = Number(outputDimensions?.height);

  if (Number.isFinite(width) && width > 0) {
    nextData.params.width = width;
  }

  if (Number.isFinite(height) && height > 0) {
    nextData.params.height = height;
  }
}

function normalizeImagenAspectRatio(currentValue, outputDimensions) {
  const targetRatio =
    parseAspectRatio(currentValue) ||
    aspectRatioFromDimensions(outputDimensions) ||
    1;

  let bestAspect = GOOGLE_IMAGEN_ALLOWED_ASPECTS[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of GOOGLE_IMAGEN_ALLOWED_ASPECTS) {
    const distance = Math.abs(parseAspectRatio(candidate) - targetRatio);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAspect = candidate;
    }
  }

  return bestAspect;
}

function normalizeGptImageSize(outputDimensions) {
  const ratio = aspectRatioFromDimensions(outputDimensions);

  if (ratio >= 1.2) {
    return "1536x1024";
  }

  if (ratio > 0 && ratio <= 0.83) {
    return "1024x1536";
  }

  return "1024x1024";
}

function retargetDownstreamCropNodes(recipe, nodeId, existingNode, replacementNode) {
  const previousDimensions = getNodeOutputDimensions(existingNode);
  const nextDimensions = getPlannedOutputDimensions(replacementNode, previousDimensions);

  if (!previousDimensions || !nextDimensions) {
    return;
  }

  const cropNodeIds = recipe.edges
    .filter((edge) => edge.source === nodeId)
    .map((edge) => edge.target);

  for (const cropNodeId of cropNodeIds) {
    const cropNode = recipe.nodes.find(
      (node) => node.id === cropNodeId && node.type === "crop",
    );
    if (!cropNode) {
      continue;
    }
    resizeCropNode(cropNode, previousDimensions, nextDimensions);
  }
}

function getPlannedOutputDimensions(node, fallbackDimensions) {
  const params = node?.data?.params || {};
  const sized = parseImageSize(params.size);
  if (sized) {
    return sized;
  }

  if (Number.isFinite(params.width) && Number.isFinite(params.height)) {
    return {
      width: Number(params.width),
      height: Number(params.height),
    };
  }

  if (typeof params.aspect_ratio === "string") {
    const safe = getSafeDimensionsForAspectRatio(params.aspect_ratio);
    if (safe) {
      return safe;
    }
  }

  return fallbackDimensions;
}

function resizeCropNode(cropNode, previousDimensions, nextDimensions) {
  const currentDimensions = readCropInputDimensions(cropNode) || previousDimensions;

  if (!currentDimensions?.width || !currentDimensions?.height) {
    return;
  }

  const scaleX = nextDimensions.width / currentDimensions.width;
  const scaleY = nextDimensions.height / currentDimensions.height;
  const options = cropNode.data?.options ? cloneJson(cropNode.data.options) : {};
  const cropData = cropNode.data?.crop_data ? cloneJson(cropNode.data.crop_data) : {};
  const scaledWidth = clampDimension(
    Math.round(Number(options.width || cropData.width || 0) * scaleX),
    nextDimensions.width,
  );
  const scaledHeight = clampDimension(
    Math.round(Number(options.height || cropData.height || 0) * scaleY),
    nextDimensions.height,
  );
  const scaledX = clampCoordinate(
    Math.round(Number(options.x || cropData.x || 0) * scaleX),
    nextDimensions.width,
    scaledWidth,
  );
  const scaledY = clampCoordinate(
    Math.round(Number(options.y || cropData.y || 0) * scaleY),
    nextDimensions.height,
    scaledHeight,
  );

  cropNode.data.options = {
    ...options,
    x: scaledX,
    y: scaledY,
    width: scaledWidth,
    height: scaledHeight,
    inputDimensions: [nextDimensions.width, nextDimensions.height],
  };
  cropNode.data.crop_data = {
    ...cropData,
    x: scaledX,
    y: scaledY,
    width: scaledWidth,
    height: scaledHeight,
  };

  updateNestedDimensions(cropNode.data?.input?.image, nextDimensions);
  updateNestedDimensions(cropNode.data?.input?.file, nextDimensions);
  updateNestedDimensions(cropNode.data?.inputNode?.file, nextDimensions);
  updateNestedDimensions(cropNode.data?.output?.file, {
    width: scaledWidth,
    height: scaledHeight,
  });
  updateNestedDimensions(cropNode.data?.result, {
    width: scaledWidth,
    height: scaledHeight,
  });
}

function clampCropNode(cropNode) {
  const dimensions = readCropInputDimensions(cropNode);
  if (!dimensions?.width || !dimensions?.height) {
    return false;
  }

  const options = cropNode.data?.options ? cloneJson(cropNode.data.options) : {};
  const cropData = cropNode.data?.crop_data ? cloneJson(cropNode.data.crop_data) : {};
  const currentWidth = Number(options.width || cropData.width || 0);
  const currentHeight = Number(options.height || cropData.height || 0);
  const nextWidth = clampDimension(
    currentWidth > 0 ? Math.round(currentWidth) : dimensions.width,
    dimensions.width,
  );
  const nextHeight = clampDimension(
    currentHeight > 0 ? Math.round(currentHeight) : dimensions.height,
    dimensions.height,
  );
  const nextX = clampCoordinate(
    Math.round(Number(options.x || cropData.x || 0)),
    dimensions.width,
    nextWidth,
  );
  const nextY = clampCoordinate(
    Math.round(Number(options.y || cropData.y || 0)),
    dimensions.height,
    nextHeight,
  );

  const changed =
    nextWidth !== Number(options.width || cropData.width || 0) ||
    nextHeight !== Number(options.height || cropData.height || 0) ||
    nextX !== Number(options.x || cropData.x || 0) ||
    nextY !== Number(options.y || cropData.y || 0) ||
    !sameDimensions(options.inputDimensions, [dimensions.width, dimensions.height]);

  if (!changed) {
    return false;
  }

  cropNode.data.options = {
    ...options,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
    inputDimensions: [dimensions.width, dimensions.height],
  };
  cropNode.data.crop_data = {
    ...cropData,
    x: nextX,
    y: nextY,
    width: nextWidth,
    height: nextHeight,
  };

  updateNestedDimensions(cropNode.data?.output?.file, {
    width: nextWidth,
    height: nextHeight,
  });
  updateNestedDimensions(cropNode.data?.result, {
    width: nextWidth,
    height: nextHeight,
  });

  return true;
}

function readCropInputDimensions(cropNode) {
  const pair = cropNode?.data?.options?.inputDimensions;
  if (Array.isArray(pair) && pair.length === 2) {
    const width = Number(pair[0]);
    const height = Number(pair[1]);
    if (width > 0 && height > 0) {
      return { width, height };
    }
  }

  return (
    readDimensions(cropNode?.data?.input?.image) ||
    readDimensions(cropNode?.data?.input?.file) ||
    readDimensions(cropNode?.data?.inputNode?.file)
  );
}

function updateNestedDimensions(target, dimensions) {
  if (!target || !dimensions) {
    return;
  }
  target.width = dimensions.width;
  target.height = dimensions.height;
}

function clampCoordinate(value, max, size) {
  const upperBound = Math.max(0, max - size);
  return Math.min(Math.max(0, value), upperBound);
}

function clampDimension(value, max) {
  return Math.min(Math.max(1, value), max);
}

function sameDimensions(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === 2 &&
    right.length === 2 &&
    Number(left[0]) === Number(right[0]) &&
    Number(left[1]) === Number(right[1])
  );
}

function mergeParams(defaultParams, currentParams, schema) {
  const nextParams = cloneJson(defaultParams || {});

  for (const [key, value] of Object.entries(currentParams || {})) {
    if (key in nextParams || key in (schema || {})) {
      nextParams[key] = cloneJson(value);
    }
  }

  return nextParams;
}

function canBypassNode(recipe, nodeId) {
  const incomingEdges = recipe.edges.filter((edge) => edge.target === nodeId);
  const outgoingEdges = recipe.edges.filter((edge) => edge.source === nodeId);
  return incomingEdges.length === 1 && outgoingEdges.length > 0;
}

function buildReplacementReason(node, candidate, connectedInputs) {
  const signature = buildSignature(connectedInputs);
  const repairMode = inferRepairMode(node, signature);
  const mode = formatRepairMode(repairMode);
  return `Swap ${node.name} to ${candidate.name} as a ${mode} fallback.`;
}

function getConnectedHandleKeys(recipe, nodeId, direction) {
  const edges = direction === "input"
    ? recipe.edges.filter((edge) => edge.target === nodeId)
    : recipe.edges.filter((edge) => edge.source === nodeId);
  const keys = new Set();

  for (const edge of edges) {
    const handle = direction === "input" ? edge.targetHandle : edge.sourceHandle;
    const key = parseHandleKey(handle, nodeId, direction);
    if (key) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort();
}

function parseHandleKey(handle, nodeId, direction) {
  const prefix = `${nodeId}-${direction}-`;
  if (typeof handle === "string" && handle.startsWith(prefix)) {
    return handle.slice(prefix.length);
  }
  return "";
}

function buildHandleMapping(currentKeys, nextKeys, direction) {
  const mapping = {};

  for (const key of currentKeys) {
    const mapped = mapHandleKey(key, nextKeys, direction);
    if (mapped) {
      mapping[key] = mapped;
    }
  }

  return mapping;
}

function mapHandleKey(currentKey, nextKeys, direction) {
  if (nextKeys.includes(currentKey)) {
    return currentKey;
  }

  if (direction === "input") {
    if (currentKey === "prompt" && nextKeys.includes("text")) {
      return "text";
    }

    if (currentKey === "text" && nextKeys.includes("prompt")) {
      return "prompt";
    }

    if (currentKey === "image" && nextKeys.includes("image_1")) {
      return "image_1";
    }

    if (currentKey === "image" && nextKeys.includes("input_image")) {
      return "input_image";
    }

    if (currentKey === "input_image" && nextKeys.includes("image")) {
      return "image";
    }
  }

  if (
    direction === "output" &&
    ["result", "image"].includes(currentKey) &&
    nextKeys.length === 1
  ) {
    return nextKeys[0];
  }

  return "";
}

function getDefinitionHandleKeys(definition, direction) {
  return normalizeHandleKeys(definition?.data?.handles?.[direction]);
}

function getRequiredHandleKeys(definition, direction) {
  const handles = definition?.data?.handles?.[direction];

  if (!handles) {
    return [];
  }

  if (Array.isArray(handles)) {
    return handles.filter((key) => !OPTIONAL_INPUT_KEYS.has(key));
  }

  return Object.entries(handles)
    .filter(([, value]) => value?.required !== false)
    .map(([key]) => key);
}

function normalizeHandleKeys(handles) {
  if (!handles) {
    return [];
  }

  if (Array.isArray(handles)) {
    return handles.slice();
  }

  return Object.keys(handles);
}

function normalizeDefinitionList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.nodeDefinitions)) {
    return payload.nodeDefinitions;
  }

  if (Array.isArray(payload?.items)) {
    return payload.items;
  }

  return [];
}

function normalizePriceEntries(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload?.prices)) {
    return payload.prices;
  }

  return [];
}

function createPriceLookup(entries) {
  const lookup = new Map();

  for (const entry of entries) {
    for (const key of [entry.modelName, entry.modelType, entry.name]) {
      if (!key || lookup.has(key)) {
        continue;
      }
      lookup.set(key, entry);
    }
  }

  return lookup;
}

function lookupPriceEntry(lookup, definition) {
  const modelName = getModelNameFromDefinition(definition);
  return (
    lookup.get(modelName) ||
    lookup.get(definition.type) ||
    lookup.get(getDefinitionName(definition)) ||
    null
  );
}

function getModelName(node) {
  return (
    node?.data?.model?.name ||
    node?.data?.kind?.model?.name ||
    ""
  );
}

function getModelNameFromDefinition(definition) {
  return definition?.data?.model?.name || "";
}

function getDefaultPreferencesForMode(repairMode) {
  switch (repairMode) {
    case "prompt-image":
      return PROMPT_IMAGE_PREFERENCES;
    case "image-edit":
      return IMAGE_EDIT_PREFERENCES;
    case "image-upscale":
      return IMAGE_UPSCALE_PREFERENCES;
    default:
      return [];
  }
}

function inferRepairMode(node, signature) {
  const keySet = new Set(
    Array.isArray(node.connectedInputs) && node.connectedInputs.length > 0
      ? node.connectedInputs
      : String(signature || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
  );
  const hasPrompt = hasAnyKey(keySet, ["prompt", "text"]);
  const hasImage = hasAnyKey(keySet, [
    "image",
    "image_1",
    "input_image",
    "reference_image",
  ]);
  const hasMask = hasAnyKey(keySet, ["mask"]);

  if (hasMask && hasImage && hasPrompt) {
    return "inpaint";
  }

  if (hasImage && hasPrompt) {
    return "image-edit";
  }

  if (hasImage) {
    return "image-upscale";
  }

  if (hasPrompt) {
    return "prompt-image";
  }

  return "generic";
}

function formatRepairMode(repairMode) {
  switch (repairMode) {
    case "prompt-image":
      return "prompt-only image";
    case "image-edit":
      return "image-guided";
    case "image-upscale":
      return "image-only";
    case "inpaint":
      return "masked image";
    default:
      return "compatible";
  }
}

function hasAnyKey(set, keys) {
  return keys.some((key) => set.has(key));
}

function findSourceHandleForTarget(targetKey, currentKeys, inputMap) {
  return currentKeys.find((sourceKey) => inputMap[sourceKey] === targetKey) || "";
}

function isCompatibleWithRepairMode(definition, repairMode, requiredInputKeys) {
  const inputKeys = getDefinitionHandleKeys(definition, "input");
  const outputKinds = getDefinitionOutputKinds(definition);
  const requiredKinds = new Set(
    requiredInputKeys.map((key) => inferHandleKind(key, definition, "input")),
  );

  if (!outputKinds.has("image")) {
    return false;
  }

  if (["video", "audio", "3d"].some((kind) => outputKinds.has(kind))) {
    return false;
  }

  switch (repairMode) {
    case "prompt-image":
      return (
        hasPromptLikeInput(inputKeys) &&
        !requiredKinds.has("image") &&
        !requiredKinds.has("mask") &&
        !requiredKinds.has("video")
      );
    case "image-edit":
      return (
        hasPromptLikeInput(inputKeys) &&
        requiredKinds.has("image") &&
        !requiredKinds.has("mask") &&
        !requiredKinds.has("video")
      );
    case "image-upscale":
      return (
        !hasPromptLikeInput(requiredInputKeys) &&
        requiredKinds.has("image") &&
        !requiredKinds.has("mask") &&
        !requiredKinds.has("video")
      );
    case "inpaint":
      return (
        hasPromptLikeInput(inputKeys) &&
        requiredKinds.has("image") &&
        requiredKinds.has("mask")
      );
    default:
      return true;
  }
}

function hasPromptLikeInput(keys) {
  return keys.some((key) => key === "prompt" || key === "text");
}

function getDefinitionOutputKinds(definition) {
  return new Set(
    getDefinitionHandleKeys(definition, "output")
      .map((key) => inferHandleKind(key, definition, "output"))
      .filter(Boolean),
  );
}

function inferHandleKind(key, definition, direction) {
  const handle =
    !Array.isArray(definition?.data?.handles?.[direction]) &&
    definition?.data?.handles?.[direction]
      ? definition.data.handles[direction][key]
      : null;
  const handleType = String(handle?.type || handle?.format || "").toLowerCase();

  if (handleType.includes("image") || handleType === "uri") {
    if (/image|result|reference/.test(key)) {
      return "image";
    }
  }

  if (handleType.includes("video")) {
    return "video";
  }

  if (handleType.includes("audio")) {
    return "audio";
  }

  if (handleType.includes("mask")) {
    return "mask";
  }

  if (handleType.includes("text")) {
    return "text";
  }

  if (/^(prompt|text|negative_prompt|system_prompt)$/.test(key)) {
    return "text";
  }

  if (/^(image|image_\d+|input_image|reference_image|result)$/.test(key)) {
    return "image";
  }

  if (/mask/.test(key)) {
    return "mask";
  }

  if (/video/.test(key)) {
    return "video";
  }

  if (/audio|voice/.test(key)) {
    return "audio";
  }

  if (/3d|mesh|model/.test(key)) {
    return "3d";
  }

  return "";
}

function scoreAlternative(definition, matchedPrice, repairMode) {
  const model = getModelNameFromDefinition(definition);
  const preferenceIndex = getDefaultPreferencesForMode(repairMode).findIndex(
    (entry) => entry.model === model,
  );
  const credits = Number(matchedPrice?.credits);
  const creditPenalty = Number.isFinite(credits) ? credits : 999;

  return (
    (preferenceIndex === -1 ? 0 : 100 - preferenceIndex * 5) -
    creditPenalty
  );
}

function dedupeAlternatives(entries) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    if (!entry || seen.has(entry.definitionId)) {
      continue;
    }
    seen.add(entry.definitionId);
    deduped.push(entry);
  }

  return deduped;
}

function getNodeOutputDimensions(node) {
  return (
    readDimensions(node?.data?.output?.result) ||
    readDimensions(node?.data?.output?.image) ||
    readDimensions(node?.data?.result) ||
    readDimensions(node?.data?.input?.workflow)
  );
}

function readDimensions(value) {
  const width = Number(value?.width);
  const height = Number(value?.height);

  if (width > 0 && height > 0) {
    return { width, height };
  }

  return null;
}

function parseAspectRatio(value) {
  if (typeof value !== "string") {
    return 0;
  }

  const parts = value.split(":").map((item) => Number(item));
  if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
    return parts[0] / parts[1];
  }

  return 0;
}

function aspectRatioFromDimensions(dimensions) {
  if (!dimensions?.width || !dimensions?.height) {
    return 0;
  }

  return dimensions.width / dimensions.height;
}

function getSafeDimensionsForAspectRatio(aspectRatio) {
  switch (aspectRatio) {
    case "1:1":
      return { width: 1024, height: 1024 };
    case "16:9":
      return { width: 1024, height: 576 };
    case "9:16":
      return { width: 576, height: 1024 };
    case "4:3":
      return { width: 1024, height: 768 };
    case "3:4":
      return { width: 768, height: 1024 };
    default:
      return null;
  }
}

function parseImageSize(value) {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width > 0 && height > 0) {
    return { width, height };
  }

  return null;
}

function getDefinitionName(definition) {
  return (
    definition?.data?.menu?.displayName ||
    definition?.data?.name ||
    definition?.type ||
    "Unnamed node"
  );
}

function getNodeColor(node) {
  return node?.data?.color || "Yambo_Black";
}

function buildSignature(keys) {
  return keys.slice().sort().join(",");
}

function buildEdgeHandle(nodeId, direction, key) {
  return `${nodeId}-${direction}-${key}`;
}

function cloneRecipe(recipe) {
  return {
    nodes: cloneJson(recipe.nodes || []),
    edges: cloneJson(recipe.edges || []),
    designAppMetadata: cloneJson(recipe.designAppMetadata || null),
    poster: recipe.poster || null,
    v3: recipe.v3,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  applyModelRepairPlan,
  buildModelRepairPlan,
  extractRecipeModelNodes,
  stabilizeRecipeForExecution,
};
