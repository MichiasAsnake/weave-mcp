const { randomUUID } = require("node:crypto");

const { MEDIA_IMPORT_NODE_TYPES, PROMPTISH_NODE_TYPES } = require("./config");
const { buildSavePayload, getNodeName, previewText } = require("./analysis");

const SUPPORTED_INTENT_TYPES = new Set([
  "add-reference-input",
  "add-style-control",
  "expose-design-app-inputs",
]);
const EXPOSABLE_NODE_TYPES = new Set([
  "import",
  "string",
  "prompt",
  "promptV2",
  "promptV3",
]);

function planStructuralTools({ recipe, recipeAnalysis, capabilityMutationPlan }) {
  const intents = capabilityMutationPlan?.intents || [];
  const plannedTools = [];

  for (const intent of intents) {
    if (!SUPPORTED_INTENT_TYPES.has(intent.type)) {
      plannedTools.push({
        intentType: intent.type,
        toolName: null,
        autoApplicable: false,
        status: "unsupported",
        detail: intent.detail,
        reason: "No deterministic structural tool is implemented for this intent yet.",
        selections: [],
      });
      continue;
    }

    const plan = planStructuralTool(intent, recipe, recipeAnalysis);
    plannedTools.push(plan);
  }

  return {
    summary: {
      plannedToolCount: plannedTools.length,
      readyToolCount: plannedTools.filter((entry) => entry.status === "ready").length,
      blockedToolCount: plannedTools.filter((entry) => entry.status === "blocked").length,
      unsupportedToolCount: plannedTools.filter((entry) => entry.status === "unsupported").length,
    },
    tools: plannedTools,
  };
}

function applyStructuralToolPlan(recipe, toolPlan) {
  const clonedRecipe = cloneRecipe(recipe);
  const designAppMetadata = clonedRecipe.designAppMetadata || {};
  let nextOrder = getNextMetadataOrder(designAppMetadata);
  const appliedTools = [];
  const skippedTools = [];

  for (const tool of toolPlan?.tools || []) {
    if (tool.status !== "ready" || tool.autoApplicable !== true) {
      skippedTools.push({
        intentType: tool.intentType,
        toolName: tool.toolName,
        reason: tool.reason || "This structural tool is not ready to auto-apply.",
      });
      continue;
    }

    const appliedSelections = [];

    if (tool.mode === "graft-reference-import") {
      const grafted = graftReferenceImportNode(clonedRecipe, tool.targetNodes || [], nextOrder);
      nextOrder = grafted.nextOrder;
      appliedSelections.push(...grafted.appliedSelections);
    } else {
      for (const selection of tool.selections || []) {
        const current = designAppMetadata[selection.nodeId] || {};
        const nextEntry = {
          order:
            typeof current.order === "number"
              ? current.order
              : nextOrder++,
          exposed: true,
          disabled: false,
          required: Boolean(selection.required),
        };
        designAppMetadata[selection.nodeId] = nextEntry;
        appliedSelections.push({
          nodeId: selection.nodeId,
          nodeName: selection.nodeName,
          required: nextEntry.required,
          order: nextEntry.order,
        });
      }
    }

    appliedTools.push({
      intentType: tool.intentType,
      toolName: tool.toolName,
      detail: tool.detail,
      appliedSelections,
    });
  }

  clonedRecipe.designAppMetadata = designAppMetadata;

  return {
    recipe: clonedRecipe,
    appliedTools,
    skippedTools,
  };
}

function buildStructuralSavePayload(nextRecipe, previousRecipe) {
  return buildSavePayload(nextRecipe, previousRecipe);
}

function planStructuralTool(intent, recipe, recipeAnalysis) {
  const selectionConfig = selectExposureCandidates(intent.type, recipe, recipeAnalysis);

  if (
    selectionConfig.mode !== "graft-reference-import" &&
    selectionConfig.selections.length === 0
  ) {
    return {
      intentType: intent.type,
      toolName: selectionConfig.toolName || "expose-design-app-inputs",
      autoApplicable: false,
      status: "blocked",
      detail: intent.detail,
      reason: selectionConfig.reason,
      selections: [],
    };
  }

  return {
    intentType: intent.type,
    toolName: selectionConfig.toolName || "expose-design-app-inputs",
    autoApplicable: true,
    status: "ready",
    detail: intent.detail,
    reason: selectionConfig.reason,
    mode: selectionConfig.mode || "expose-inputs",
    selections: selectionConfig.selections || [],
    targetNodes: selectionConfig.targetNodes || [],
  };
}

function selectExposureCandidates(intentType, recipe, recipeAnalysis) {
  const exposedIds = new Set((recipeAnalysis?.exposedNodes || []).map((entry) => entry.id));
  const nodes = recipe?.nodes || [];
  const hiddenImports = nodes
    .filter(
      (node) =>
        MEDIA_IMPORT_NODE_TYPES.has(node.type) &&
        canExposeNodeType(node.type) &&
        !exposedIds.has(node.id),
    )
    .map((node) => buildSelection(node, { required: true }));
  const hiddenPrompts = nodes
    .filter(
      (node) =>
        PROMPTISH_NODE_TYPES.has(node.type) &&
        canExposeNodeType(node.type) &&
        !exposedIds.has(node.id),
    )
    .map((node) => buildSelection(node, { required: false }));

  if (intentType === "add-reference-input") {
    if (hiddenImports.length === 0) {
      const graftableTargets = findReferenceCapableTargets(recipe);
      if (graftableTargets.length > 0) {
        return {
          mode: "graft-reference-import",
          toolName: "graft-reference-import",
          selections: [],
          targetNodes: graftableTargets,
          reason: `Create a new exposed import node and wire it into ${graftableTargets.length} compatible generator node(s).`,
        };
      }

      return {
        selections: [],
        toolName: "expose-design-app-inputs",
        reason:
          "This recipe has no hidden import/reference nodes to expose, so true reference support still needs graph authoring.",
      };
    }

    return {
      toolName: "expose-design-app-inputs",
      selections: hiddenImports.slice(0, 2),
      reason: `Expose ${Math.min(hiddenImports.length, 2)} hidden import node(s) as Design App inputs.`,
    };
  }

  if (intentType === "add-style-control") {
    const promptCandidates = hiddenPrompts
      .filter((entry) => isStyleLikeName(entry.nodeName) || entry.promptPreview)
      .sort(compareStyleCandidates)
      .slice(0, 3);

    if (promptCandidates.length === 0) {
      return {
        selections: [],
        toolName: "expose-design-app-inputs",
        reason:
          "This recipe has no hidden prompt-like nodes that can be safely promoted into reusable style controls.",
      };
    }

    return {
      toolName: "expose-design-app-inputs",
      selections: promptCandidates,
      reason: `Expose ${promptCandidates.length} hidden prompt node(s) as reusable style controls.`,
    };
  }

  const selections = [
    ...hiddenImports.slice(0, 2),
    ...hiddenPrompts
      .sort(compareGenericCandidates)
      .slice(0, 3),
  ];

  if (selections.length === 0) {
    return {
      selections: [],
      toolName: "expose-design-app-inputs",
      reason:
        "This recipe has no safe import or prompt nodes available to expose as Design App inputs.",
    };
  }

  return {
    toolName: "expose-design-app-inputs",
    selections,
    reason: `Expose ${selections.length} existing node(s) as Design App inputs without changing graph wiring.`,
  };
}

function buildSelection(node, { required }) {
  return {
    nodeId: node.id,
    nodeName: getNodeName(node),
    nodeType: node.type,
    required,
    promptPreview: previewText(extractPreviewText(node)),
  };
}

function extractPreviewText(node) {
  if (typeof node?.data?.value?.prompt === "string") {
    return node.data.value.prompt;
  }
  if (typeof node?.data?.value?.string === "string") {
    return node.data.value.string;
  }
  if (typeof node?.data?.prompt === "string") {
    return node.data.prompt;
  }
  if (typeof node?.data?.input?.prompt === "string") {
    return node.data.input.prompt;
  }
  if (typeof node?.data?.output?.prompt === "string") {
    return node.data.output.prompt;
  }
  return "";
}

function isStyleLikeName(value) {
  const name = String(value || "").toLowerCase();
  return /\b(style|look|brand|color|palette|mood|tone|element)\b/.test(name);
}

function compareStyleCandidates(left, right) {
  return scoreStyleCandidate(right) - scoreStyleCandidate(left);
}

function compareGenericCandidates(left, right) {
  return scoreGenericCandidate(right) - scoreGenericCandidate(left);
}

function scoreStyleCandidate(candidate) {
  let score = 0;
  if (isStyleLikeName(candidate.nodeName)) {
    score += 4;
  }
  if (candidate.promptPreview) {
    score += 2;
  }
  if (candidate.nodeType === "string") {
    score += 1;
  }
  return score;
}

function scoreGenericCandidate(candidate) {
  let score = 0;
  if (candidate.nodeType === "import") {
    score += 4;
  }
  if (candidate.promptPreview) {
    score += 2;
  }
  if (isStyleLikeName(candidate.nodeName)) {
    score += 1;
  }
  return score;
}

function canExposeNodeType(type) {
  return EXPOSABLE_NODE_TYPES.has(type);
}

function findReferenceCapableTargets(recipe) {
  const edges = recipe?.edges || [];
  const nodes = recipe?.nodes || [];

  return nodes
    .filter((node) => node?.type === "custommodelV2")
    .map((node) => {
      const inputHandles = node?.data?.handles?.input || {};
      const schema = node?.data?.schema || {};
      const modelName = node?.data?.model?.name || "";
      const acceptedHandleKey =
        "image" in inputHandles && "image" in schema
          ? "image"
          : "control_image" in inputHandles && "control_image" in schema
            ? "control_image"
            : "";
      if (!acceptedHandleKey) {
        return null;
      }
      if (modelName === "any_llm") {
        return null;
      }

      const hasPromptInput =
        "prompt" in inputHandles ||
        "prompt" in (node?.data?.input || {}) ||
        "prompt" in (node?.data?.schema || {});
      if (!hasPromptInput) {
        return null;
      }

      const expectedTargetHandle = `${node.id}-input-${acceptedHandleKey}`;
      const alreadyWired = edges.some(
        (edge) => edge.target === node.id && edge.targetHandle === expectedTargetHandle,
      );
      if (alreadyWired) {
        return null;
      }

      return {
        nodeId: node.id,
        nodeName: getNodeName(node),
        nodeType: node.type,
        inputHandleKey: acceptedHandleKey,
        position: node.position || { x: 0, y: 0 },
        color: node?.data?.color || null,
      };
    })
    .filter(Boolean);
}

function graftReferenceImportNode(recipe, targetNodes, nextOrder) {
  const designAppMetadata = recipe.designAppMetadata || {};
  const anchor = targetNodes[0] || {
    position: { x: 0, y: 0 },
  };
  const newNodeId = randomUUID();
  const importNode = buildReferenceImportNode({
    id: newNodeId,
    x: (anchor.position?.x || 0) - 420,
    y: (anchor.position?.y || 0) - 120,
  });
  recipe.nodes = [...(recipe.nodes || []), importNode];
  recipe.edges = [...(recipe.edges || [])];

  for (const target of targetNodes) {
    recipe.edges.push(
      buildReferenceEdge({
        sourceId: newNodeId,
        targetId: target.nodeId,
        targetHandleKey: target.inputHandleKey,
        targetColor: target.color,
      }),
    );
  }

  designAppMetadata[newNodeId] = {
    order: nextOrder,
    exposed: true,
    disabled: false,
    required: true,
  };
  recipe.designAppMetadata = designAppMetadata;

  return {
    nextOrder: nextOrder + 1,
    appliedSelections: [
      {
        nodeId: newNodeId,
        nodeName: "Reference Image",
        required: true,
        order: nextOrder,
      },
      ...targetNodes.map((target) => ({
        nodeId: target.nodeId,
        nodeName: target.nodeName,
        wiredHandle: target.inputHandleKey,
      })),
    ],
  };
}

function buildReferenceImportNode({ id, x, y }) {
  return {
    id,
    isModel: false,
    type: "import",
    position: { x, y },
    data: {
      name: "Reference Image",
      color: "Yambo_Blue",
      handles: {
        output: ["file"],
      },
      dark_color: "Yambo_Blue_Dark",
      border_color: "Yambo_Blue_Stroke",
    },
    dragHandle: ".node-header",
    originalName: "File",
  };
}

function buildReferenceEdge({ sourceId, targetId, targetHandleKey, targetColor }) {
  return {
    id: randomUUID(),
    data: {
      sourceColor: "Yambo_Blue",
      targetColor: targetColor || "Red",
    },
    type: "custom",
    source: sourceId,
    target: targetId,
    selected: false,
    sourceHandle: `${sourceId}-output-file`,
    targetHandle: `${targetId}-input-${targetHandleKey}`,
  };
}

function getNextMetadataOrder(metadata) {
  const orders = Object.values(metadata || {})
    .map((entry) => entry?.order)
    .filter((value) => Number.isFinite(value));
  const maxOrder = orders.length > 0 ? Math.max(...orders) : -1;
  return maxOrder + 1;
}

function cloneRecipe(recipe) {
  return JSON.parse(JSON.stringify(recipe));
}

module.exports = {
  applyStructuralToolPlan,
  buildStructuralSavePayload,
  planStructuralTools,
};
