const {
  BODY_TYPE_WORDS,
  COLOR_WORDS,
  ETHNICITY_WORDS,
  FASHION_ITEM_WORDS,
  MEDIA_IMPORT_NODE_TYPES,
  PROMPTISH_NODE_TYPES,
  STYLE_WORDS,
} = require("./config");
const { summarizeRecipeCapabilities } = require("./capability-planner");

function analyzeRecipe(recipe) {
  const nodeTypes = countNodeTypes(recipe.nodes || []);
  const exposedNodes = getExposedNodes(recipe);
  const promptNodes = (recipe.nodes || [])
    .filter((node) => isPromptNode(node))
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: getNodeName(node),
      promptPreview: previewText(extractPromptText(node)),
    }));

  const importNodes = (recipe.nodes || [])
    .filter((node) => MEDIA_IMPORT_NODE_TYPES.has(node.type))
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: getNodeName(node),
    }));

  const baseAnalysis = {
    recipeId: recipe.id,
    recipeName: recipe.name,
    visibility: recipe.visibility,
    version: recipe.version,
    nodeCount: (recipe.nodes || []).length,
    edgeCount: (recipe.edges || []).length,
    hasDesignAppMetadata: Boolean(recipe.designAppMetadata),
    publishedVersions: recipe.publishedVersions?.length || 0,
    nodeTypes,
    exposedNodes,
    promptNodes,
    importNodes,
    outputs: findOutputs(recipe),
  };

  return {
    ...baseAnalysis,
    capabilityProfile: summarizeRecipeCapabilities(baseAnalysis),
  };
}

function countNodeTypes(nodes) {
  const counts = {};

  for (const node of nodes) {
    counts[node.type] = (counts[node.type] || 0) + 1;
  }

  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => ({ type, count }));
}

function getExposedNodes(recipe) {
  const metadata = recipe.designAppMetadata || {};
  const nodesById = new Map((recipe.nodes || []).map((node) => [node.id, node]));

  return Object.entries(metadata)
    .filter(([, config]) => config?.exposed)
    .sort((left, right) => (left[1].order || 0) - (right[1].order || 0))
    .map(([nodeId, config]) => {
      const node = nodesById.get(nodeId);
      return {
        id: nodeId,
        name: node ? getNodeName(node) : nodeId,
        type: node?.type || "unknown",
        required: Boolean(config.required),
        disabled: Boolean(config.disabled),
        promptPreview: previewText(extractPromptText(node)),
      };
    });
}

function findOutputs(recipe) {
  return (recipe.nodes || [])
    .filter((node) => node.type === "workflow_output" || node.type === "export")
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: getNodeName(node),
    }));
}

function inferIntent(goal) {
  const lowerGoal = String(goal || "").toLowerCase();

  if (/\b(video|animate|animation|motion)\b/.test(lowerGoal)) {
    return {
      type: "video",
      label: "Video or animation workflow",
    };
  }

  if (/\b(3d|model|mesh|rodin)\b/.test(lowerGoal)) {
    return {
      type: "3d",
      label: "3D workflow",
    };
  }

  if (/\b(angle|angles|front|side|45|multi[- ]view)\b/.test(lowerGoal)) {
    return {
      type: "multi-view",
      label: "Multi-view image workflow",
    };
  }

  if (/\b(style|brand|look|guide)\b/.test(lowerGoal)) {
    return {
      type: "style-system",
      label: "Reusable style workflow",
    };
  }

  return {
    type: "general-image",
    label: "General image generation workflow",
  };
}

function inferMissingInputs(goal, analysis, options = {}) {
  const lowerGoal = String(goal || "").toLowerCase();
  const missing = new Set();
  const brief = inferStructuredBrief(goal);
  const goalProfile = options.goalProfile || null;
  const capabilityProfile = options.capabilityProfile || null;

  if (analysis.importNodes.length > 0) {
    missing.add(
      "At least one reference asset is likely required because the template includes media import nodes.",
    );
  }

  if (!/\b(square|portrait|landscape|16:9|9:16|1:1|4:5)\b/.test(lowerGoal)) {
    missing.add("Output aspect ratio is still unspecified.");
  }

  if (!/\b(photo|photograph|illustration|render|3d|video|motion)\b/.test(lowerGoal)) {
    missing.add("Target medium is still vague.");
  }

  if (!/\b(style|brand|cinematic|minimal|editorial|playful|luxury|gritty)\b/.test(lowerGoal)) {
    missing.add("Style direction is underspecified.");
  }

  if (analysis.exposedNodes.length === 0) {
    missing.add(
      "This template has no exposed Design App inputs, so automation will need direct recipe mutation rather than simple app parameters.",
    );
  }

  for (const requiredInput of goalProfile?.requiredInputs || []) {
    if (requiredInput === "reference-asset") {
      missing.add("A reference asset is required by the goal.");
      if (!analysis.exposedNodes.some((entry) => entry.type === "import")) {
        missing.add(
          analysis.importNodes.length > 0
            ? "The recipe has import support, but no reference file input is exposed to the Design App yet."
            : "The recipe does not expose any reference file input yet.",
        );
      }
    }
    if (requiredInput === "voice-input") {
      missing.add("Voiceover or narration input is required by the goal.");
    }
  }

  const missingCapabilities = findMissingCapabilities(goalProfile, capabilityProfile);
  if (missingCapabilities.length > 0) {
    missing.add(
      `The selected template does not directly support: ${missingCapabilities.join(", ")}.`,
    );
  }

  for (const node of analysis.exposedNodes) {
    const inferred = inferFieldValue(goal, node, brief);
    if (inferred.status === "missing") {
      missing.add(inferred.reason);
    }
  }

  return Array.from(missing);
}

function buildActionPlan(goal, template, analysis, intent, options = {}) {
  const actions = [
    {
      step: 1,
      type: "select-template",
      detail: `Start from "${template.label}" (${template.id}).`,
    },
    {
      step: 2,
      type: "duplicate-template",
      detail:
        "Duplicate the template into your account using the undocumented authenticated route.",
    },
  ];

  if (analysis.exposedNodes.length > 0) {
    actions.push({
      step: actions.length + 1,
      type: "fill-exposed-inputs",
      detail: `Populate ${analysis.exposedNodes.length} exposed Design App inputs from the user's request.`,
    });
  }

  if (analysis.promptNodes.length > 0) {
    actions.push({
      step: actions.length + 1,
      type: "rewrite-prompts",
      detail:
        "Rewrite prompt-like nodes while preserving the workflow graph and node wiring.",
    });
  }

  if (analysis.importNodes.length > 0) {
    actions.push({
      step: actions.length + 1,
      type: "attach-references",
      detail:
        "Upload or link the user’s reference assets before running the recipe.",
    });
  }

  if (
    (options.goalProfile?.requiredInputs || []).includes("reference-asset") &&
    !analysis.exposedNodes.some((entry) => entry.type === "import")
  ) {
    actions.push({
      step: actions.length + 1,
      type: "expose-reference-input",
      detail:
        analysis.importNodes.length > 0
          ? "Expose the existing import node as a Design App input so the user can upload reference assets."
          : "Add a reference import path before expecting the workflow to accept user assets.",
    });
  }

  const missingCapabilities = findMissingCapabilities(
    options.goalProfile,
    options.capabilityProfile || analysis.capabilityProfile,
  );
  if (missingCapabilities.length > 0) {
    actions.push({
      step: actions.length + 1,
      type: "bridge-capability-gap",
      detail: `Add or mutate graph structure to cover missing capabilities: ${missingCapabilities.join(", ")}.`,
    });
  }

  actions.push({
    step: actions.length + 1,
    type: "run-and-review",
    detail: `Execute a first pass and let the agent inspect outputs for ${intent.label.toLowerCase()}.`,
  });

  actions.push({
    step: actions.length + 1,
    type: "publish",
    detail:
      "If the result becomes reusable, publish it as a Design App for non-builder users.",
  });

  return actions;
}

function findMissingCapabilities(goalProfile, capabilityProfile) {
  const desired = new Set(goalProfile?.capabilities || []);
  const provided = new Set(capabilityProfile?.capabilities || []);

  return Array.from(desired).filter((capability) => !provided.has(capability));
}

function buildDraftMutations(goal, recipe, analysis) {
  const mutations = [];
  const brief = inferStructuredBrief(goal);

  mutations.push({
    type: "rename-recipe",
    target: recipe.id,
    value: buildDraftName(goal),
  });

  for (const exposedNode of analysis.exposedNodes) {
    const inferred = inferFieldValue(goal, exposedNode, brief);

    if (inferred.status === "set") {
      mutations.push({
        type: "set-exposed-value",
        nodeId: exposedNode.id,
        nodeName: exposedNode.name,
        value: inferred.value,
      });
    } else if (MEDIA_IMPORT_NODE_TYPES.has(exposedNode.type)) {
      mutations.push({
        type: "attach-media",
        nodeId: exposedNode.id,
        nodeName: exposedNode.name,
        value: "<user asset required>",
      });
    } else if (inferred.status === "missing") {
      mutations.push({
        type: "needs-user-input",
        nodeId: exposedNode.id,
        nodeName: exposedNode.name,
        value: inferred.reason,
      });
    } else {
      mutations.push({
        type: "keep-existing",
        nodeId: exposedNode.id,
        nodeName: exposedNode.name,
        value: exposedNode.promptPreview || "<leave template default>",
      });
    }
  }

  if (mutations.length === 1) {
    for (const node of recipe.nodes || []) {
      if (!isPromptNode(node)) {
        continue;
      }

      mutations.push({
        type: "rewrite-prompt-node",
        nodeId: node.id,
        nodeName: getNodeName(node),
        current: previewText(extractPromptText(node)),
        value: goal,
      });
    }
  }

  return mutations;
}

function applyDraftMutationsToRecipe(recipe, draftMutations) {
  const cloned = JSON.parse(
    JSON.stringify({
      nodes: recipe.nodes || [],
      edges: recipe.edges || [],
      designAppMetadata: recipe.designAppMetadata || null,
      poster: recipe.poster || null,
      v3: recipe.v3,
    }),
  );

  const nodesById = new Map(cloned.nodes.map((node) => [node.id, node]));

  for (const mutation of draftMutations) {
    if (
      mutation.type !== "set-exposed-value" &&
      mutation.type !== "rewrite-prompt-node"
    ) {
      continue;
    }

    const node = nodesById.get(mutation.nodeId);
    if (!node) {
      continue;
    }

    applyValueToNode(node, mutation.value);

    if (mutation.disconnectPromptEdge) {
      cloned.edges = cloned.edges.filter(
        (edge) =>
          !(
            edge.target === mutation.nodeId &&
            typeof edge.targetHandle === "string" &&
            /-input-prompt$/i.test(edge.targetHandle)
          ),
      );
    }
  }

  return cloned;
}

function applyValueToNode(node, value) {
  if (!node?.data) {
    return;
  }

  if (node.data.output && typeof node.data.output === "object") {
    if ("prompt" in node.data.output) {
      node.data.output.prompt = value;
    }
    if ("text" in node.data.output) {
      node.data.output.text = value;
    }
    if ("value" in node.data.output) {
      node.data.output.value = value;
    }
  }

  if (node.data.result && typeof node.data.result === "object") {
    if ("prompt" in node.data.result) {
      node.data.result.prompt = value;
    }
    if ("text" in node.data.result) {
      node.data.result.text = value;
    }
    if ("value" in node.data.result) {
      node.data.result.value = value;
    }
  }

  if (node.data.input?.prompt && typeof node.data.input.prompt === "object") {
    if ("value" in node.data.input.prompt) {
      node.data.input.prompt.value = value;
    }
    if ("prompt" in node.data.input.prompt) {
      node.data.input.prompt.prompt = value;
    }
  } else if (typeof node.data.input?.prompt === "string") {
    node.data.input.prompt = value;
  }

  if (typeof node.data.prompt === "string") {
    node.data.prompt = value;
  }
}

function buildSavePayload(sourceRecipe, targetRecipe) {
  return {
    nodes: sourceRecipe.nodes || [],
    edges: sourceRecipe.edges || [],
    v3:
      typeof sourceRecipe.v3 === "boolean"
        ? sourceRecipe.v3
        : Boolean(targetRecipe.v3),
    posterImageUrl: sourceRecipe.poster || undefined,
    designAppMetadata: sourceRecipe.designAppMetadata || undefined,
    lastUpdatedAt: targetRecipe.updatedAt || new Date().toISOString(),
  };
}

function buildDesignAppRunPayload(recipe, options = {}) {
  const overrides = normalizeRunOverrides(options.overrides || {});
  const numberOfRuns = options.numberOfRuns || 1;
  const exposedNodes = getExposedNodes(recipe)
    .map((entry) => recipe.nodes.find((node) => node.id === entry.id))
    .filter(Boolean);

  const inputs = exposedNodes.map((node) => {
    const override = findRunOverrideForNode(node, overrides);

    const input = buildDesignAppInputForNode(node, override);

    return {
      nodeId: node.id,
      input,
      disabled: false,
      name: getNodeName(node),
    };
  });

  const missingInputs = inputs
    .filter((entry) => entry.input == null)
    .map((entry) => `${entry.name} needs a supported input value before run.`);

  return {
    payload: {
      inputs: inputs.filter((entry) => entry.input != null),
      numberOfRuns,
      recipeVersion: recipe.version,
    },
    missingInputs,
  };
}

function buildDesignAppInputForNode(node, override) {
  if (override != null) {
    if (node.type === "string" && typeof override === "string") {
      return { string: override };
    }

    if (node.type === "import") {
      return normalizeImportOverride(override);
    }

    if (
      node.type === "prompt" ||
      node.type === "promptV2" ||
      node.type === "promptV3"
    ) {
      if (typeof override === "string") {
        return { prompt: override };
      }
      if (typeof override === "object" && override !== null) {
        return "prompt" in override ? override : { prompt: String(override.value || "") };
      }
    }

    if (typeof override === "object") {
      return override;
    }

    return override;
  }

  if (node.type === "prompt" || node.type === "promptV2" || node.type === "promptV3") {
    return { prompt: extractPromptText(node) };
  }

  if (node.type === "string") {
    return { string: extractPromptText(node) };
  }

  if (node.type === "import") {
    return normalizeImportOverride(node?.data?.input || node?.data?.output || null);
  }

  return node?.data?.value || null;
}

function normalizeImportOverride(value) {
  if (!value) {
    return null;
  }

  if (value.file) {
    return value;
  }

  return { file: value };
}

function normalizeRunOverrides(overrides) {
  const byId = new Map();
  const byName = new Map();

  for (const [key, value] of Object.entries(overrides)) {
    if (/^[a-z0-9-]{20,}$/i.test(key)) {
      byId.set(key, value);
    } else {
      byName.set(key.toLowerCase(), value);
    }
  }

  return { byId, byName };
}

function findRunOverrideForNode(node, overrides) {
  const explicit =
    overrides.byId.get(node.id) ||
    overrides.byName.get((getNodeName(node) || "").toLowerCase());

  if (explicit != null) {
    return explicit;
  }

  if (node?.type === "import") {
    return (
      overrides.byName.get("reference") ||
      overrides.byName.get("reference image") ||
      overrides.byName.get("asset") ||
      overrides.byName.get("input image") ||
      null
    );
  }

  return null;
}

function summarizeRunStatus(statusPayload) {
  const runs = statusPayload?.runs || {};
  const summary = [];

  for (const [runId, run] of Object.entries(runs)) {
    summary.push({
      runId,
      status: run.status,
      progress: run.progress ?? null,
      outputCount: run.outputCount ?? null,
      error: run.error || null,
      results: (run.results || []).map((result) => ({
        id: result.id,
        name: result.name || null,
        type: result.type,
        url: result.url || result.viewUrl || result.thumbnailUrl || null,
        width: result.width ?? null,
        height: result.height ?? null,
        input: result.input || null,
      })),
    });
  }

  return summary;
}

function diagnoseRunStatus(statusPayload) {
  const summary = summarizeRunStatus(statusPayload);
  const failedRuns = summary.filter((run) => run.status === "FAILED");
  const runningRuns = summary.filter((run) => run.status === "RUNNING");
  const completedRuns = summary.filter((run) => run.status === "COMPLETED");
  const remainingCredits = numericOrNull(statusPayload?.remainingCredits);
  const userRemainingCredits = numericOrNull(statusPayload?.userRemainingCredits);

  if (failedRuns.length > 0) {
    const failures = failedRuns.map((run) => ({
      runId: run.runId,
      ...classifyRuntimeRunError(run.error),
    }));
    const autoFixable = failures.every((failure) => failure.autoFixable);
    const uniqueKinds = Array.from(new Set(failures.map((failure) => failure.kind)));

    return {
      kind: "runtime-failure",
      summary: "The run started but one or more nodes failed during execution.",
      details: failures.map((failure) => failure.details).filter(Boolean).join(" | "),
      failures,
      failedRuns,
      autoFixable,
      retryable: autoFixable,
      failureKinds: uniqueKinds,
      completedRuns: completedRuns.length,
      runningRuns: runningRuns.length,
      remainingCredits,
      userRemainingCredits,
    };
  }

  if (runningRuns.length > 0) {
    return {
      kind: "running",
      summary: "The run is still in progress.",
      details: `${runningRuns.length} run(s) still active.`,
      completedRuns: completedRuns.length,
      runningRuns: runningRuns.length,
      remainingCredits,
      userRemainingCredits,
    };
  }

  return {
    kind: "completed",
    summary: "The run completed successfully.",
    details: `${completedRuns.length} run(s) completed.`,
    completedRuns: completedRuns.length,
    runningRuns: 0,
    remainingCredits,
    userRemainingCredits,
    assets: completedRuns.flatMap((run) => run.results || []),
  };
}

function evaluateCompletedRun(recipe, statusPayload) {
  const diagnosis = diagnoseRunStatus(statusPayload);

  if (diagnosis.kind !== "completed") {
    return {
      kind: "incomplete",
      score: null,
      verdict: "Review unavailable until the run completes successfully.",
      findings: [],
      strengths: [],
      nextActions: [],
    };
  }

  const outputNodes = summarizeWorkflowOutputs(recipe);
  const assets = diagnosis.assets || [];
  const findings = [];
  const strengths = [];
  const nextActions = [];
  const expectedOutputCount = outputNodes.length;
  const actualOutputCount = assets.length;
  let score = 100;

  if (actualOutputCount === 0) {
    score -= 60;
    findings.push({
      severity: "high",
      kind: "missing-assets",
      summary: "The run completed without any output assets.",
      details:
        "Inspect the final workflow_output nodes and their upstream branches. A completed run with zero assets is usually a wiring or export issue.",
    });
    nextActions.push(
      "Inspect the final workflow_output branches and confirm each output node is still connected to generated media.",
    );
  } else {
    strengths.push(`Produced ${actualOutputCount} output asset(s).`);
  }

  if (expectedOutputCount > 0) {
    if (actualOutputCount === expectedOutputCount) {
      strengths.push(
        `Output count matches the graph: ${actualOutputCount}/${expectedOutputCount}.`,
      );
    } else {
      score -= 25;
      findings.push({
        severity: actualOutputCount < expectedOutputCount ? "high" : "medium",
        kind: "output-count-mismatch",
        summary: `Output count mismatch: expected ${expectedOutputCount}, received ${actualOutputCount}.`,
        details:
          "One or more output branches may be failing, bypassed, or fanning into a shared export node.",
      });
      nextActions.push(
        "Check whether each workflow_output node has a healthy upstream generator and that branches are not collapsing into a single export path.",
      );
    }
  }

  const assetTypes = uniqueValues(assets.map((asset) => asset.type).filter(Boolean));
  if (assetTypes.length === 1) {
    strengths.push(`All outputs share the same asset type: ${assetTypes[0]}.`);
  } else if (assetTypes.length > 1) {
    score -= 10;
    findings.push({
      severity: "medium",
      kind: "mixed-asset-types",
      summary: `Outputs mix asset types: ${assetTypes.join(", ")}.`,
      details:
        "Mixed asset types can be intentional, but usually mean the last branch stages are inconsistent.",
    });
    nextActions.push(
      "Normalize the final branch outputs so the recipe emits a consistent asset type per run.",
    );
  }

  const dimensionLabels = uniqueValues(
    assets
      .map((asset) =>
        Number.isFinite(asset.width) && Number.isFinite(asset.height)
          ? `${asset.width}x${asset.height}`
          : "",
      )
      .filter(Boolean),
  );
  if (dimensionLabels.length === 1 && assets.length > 0) {
    strengths.push(`All delivered assets share the same dimensions: ${dimensionLabels[0]}.`);
  } else if (dimensionLabels.length > 1) {
    score -= 15;
    findings.push({
      severity: "medium",
      kind: "dimension-mismatch",
      summary: `Output dimensions are inconsistent: ${dimensionLabels.join(", ")}.`,
      details:
        "This usually means different branches are using different generator settings or uncoupled crop/resize steps.",
    });
    nextActions.push(
      "Normalize final generator aspect ratios or add a shared resize/export stage across all output branches.",
    );
  }

  const aspectRatios = uniqueValues(
    assets
      .map((asset) => formatAspectRatio(asset.width, asset.height))
      .filter(Boolean),
  );
  if (aspectRatios.length === 1 && assets.length > 0) {
    strengths.push(`All delivered assets share the same aspect ratio: ${aspectRatios[0]}.`);
  } else if (aspectRatios.length > 1) {
    score -= 10;
    findings.push({
      severity: "medium",
      kind: "aspect-ratio-mismatch",
      summary: `Output aspect ratios vary across the run: ${aspectRatios.join(", ")}.`,
      details:
        "If the recipe is meant to be reusable, divergent aspect ratios will make downstream layouts and Design Apps unpredictable.",
    });
    nextActions.push(
      "Lock the generator or export nodes to a single aspect ratio unless the recipe intentionally emits multiple layouts.",
    );
  }

  const branchProvenance = uniqueValues(
    outputNodes.map((output) => output.sourceBranchId).filter(Boolean),
  );
  if (branchProvenance.length >= Math.min(expectedOutputCount || actualOutputCount, actualOutputCount)) {
    if (branchProvenance.length > 1) {
      strengths.push(
        `Outputs appear to come from ${branchProvenance.length} distinct upstream branches.`,
      );
    }
  } else if (actualOutputCount > 1) {
    score -= 10;
    findings.push({
      severity: "medium",
      kind: "limited-branch-diversity",
      summary: "Multiple outputs appear to reuse the same upstream branch.",
      details:
        "If this recipe is supposed to create distinct variations, branch diversity is currently weak.",
    });
    nextActions.push(
      "Add or restore per-output branch differences, such as unique crop nodes or branch-specific prompt modifiers.",
    );
  }

  const workflowPrompts = uniqueValues(
    outputNodes.map((output) => normalizeWhitespace(output.workflowPrompt)).filter(Boolean),
  );
  if (workflowPrompts.length === 1 && actualOutputCount > 1) {
    strengths.push("All output branches are grounded in the same synthesized workflow prompt.");
  } else if (workflowPrompts.length > 1) {
    strengths.push(`The workflow is using ${workflowPrompts.length} distinct branch prompt variants.`);
  }

  const exposedPrompts = uniqueValues(
    assets
      .map((asset) => normalizeWhitespace(asset.input?.prompt))
      .filter(Boolean),
  );
  if (exposedPrompts.length === 1 && exposedPrompts[0].length > 0) {
    strengths.push(`Run inputs stayed consistent across outputs: "${previewText(exposedPrompts[0])}".`);
  }

  if (workflowPrompts.length <= 1 && branchProvenance.length <= 1 && actualOutputCount > 1) {
    score -= 15;
    findings.push({
      severity: "medium",
      kind: "variation-risk",
      summary: "The recipe has limited evidence of per-output variation.",
      details:
        "Shared prompts plus a shared upstream branch often lead to near-duplicate outputs, even when multiple assets are returned.",
    });
    nextActions.push(
      "Introduce branch-specific prompt instructions, seeds, crops, or style modifiers if you want genuinely distinct variations.",
    );
  }

  score = Math.max(0, Math.min(100, score));

  return {
    kind: "completed-review",
    score,
    verdict: describeEvaluationScore(score),
    expectedOutputCount,
    actualOutputCount,
    assetTypes,
    dimensions: dimensionLabels,
    aspectRatios,
    branchCount: branchProvenance.length,
    workflowPromptCount: workflowPrompts.length,
    exposedPromptCount: exposedPrompts.length,
    outputSummaries: outputNodes.map((output) => ({
      id: output.id,
      name: output.name,
      sourceBranchId: output.sourceBranchId || null,
      sourceCrop: output.sourceCrop || null,
      intermediateSize: output.intermediateSize,
      promptPreview: previewText(output.workflowPrompt),
    })),
    findings,
    strengths,
    nextActions: uniqueValues(nextActions),
  };
}

function classifyRuntimeRunError(message) {
  const normalized = String(message || "").trim();
  const nodeMatch = normalized.match(/^Failed running ([^:]+):\s*(.*)$/i);
  const nodeName = nodeMatch?.[1] || "";
  const details = nodeMatch?.[2] || normalized;

  if (/Invalid crop coordinates/i.test(normalized)) {
    return {
      kind: "crop-geometry",
      summary: "One or more crop nodes are using invalid coordinates for the current image size.",
      details,
      nodeName,
      autoFixable: true,
    };
  }

  if (/aspect_ratio must be one of/i.test(normalized)) {
    return {
      kind: "unsupported-aspect-ratio",
      summary: "A model node is using an aspect ratio that the provider does not support.",
      details,
      nodeName,
      autoFixable: true,
    };
  }

  if (/required|missing/i.test(normalized)) {
    return {
      kind: "missing-input",
      summary: "A required runtime input is missing or invalid.",
      details,
      nodeName,
      autoFixable: false,
    };
  }

  if (/insufficient credits?/i.test(normalized)) {
    return {
      kind: "insufficient-credits",
      summary: "The run could not continue because the account does not have enough Weavy credits.",
      details,
      nodeName,
      autoFixable: false,
    };
  }

  return {
    kind: "runtime-error",
    summary: "A node failed during execution for an unclassified reason.",
    details,
    nodeName,
    autoFixable: false,
  };
}

function summarizeWorkflowOutputs(recipe) {
  return (recipe.nodes || [])
    .filter((node) => node.type === "workflow_output" || node.type === "export")
    .map((node) => {
      const workflow = node?.data?.input?.workflow || node?.data?.input?.file || null;
      const nestedImage = workflow?.input?.image?.input?.image || workflow?.input?.image || null;
      const transformation = nestedImage?.transformations?.[0] || null;
      const resize = transformation?.resize || null;

      return {
        id: node.id,
        name: getNodeName(node),
        workflowPrompt: extractNestedWorkflowPrompt(workflow),
        sourceBranchId: transformation?.nodeIdentifier || null,
        sourceCrop: resize
          ? {
              width: numericOrNull(resize.width),
              height: numericOrNull(resize.height),
              x: numericOrNull(resize.x_pos),
              y: numericOrNull(resize.y_pos),
            }
          : null,
        intermediateSize:
          Number.isFinite(workflow?.width) && Number.isFinite(workflow?.height)
            ? {
                width: workflow.width,
                height: workflow.height,
              }
            : null,
      };
    });
}

function classifyRunError(error) {
  const payload = error?.payload || {};
  const message = payload.message || error?.message || "Unknown run error";
  const blockedModels = extractBlockedModelNames(message);

  if (payload.internalErrorCode === 1076) {
    return {
      kind: "unverified-model",
      summary: "The current account is not approved to run one or more models in this flow.",
      details: message,
      blockedModels,
    };
  }

  if (/Authentication Error/i.test(message)) {
    return {
      kind: "auth",
      summary: "The run failed because the session is not authenticated.",
      details: message,
    };
  }

  if (/required/i.test(message)) {
    return {
      kind: "missing-input",
      summary: "The run failed because a required input is missing or invalid.",
      details: message,
    };
  }

  return {
    kind: "unknown",
    summary: "The run failed for an unclassified reason.",
    details: message,
  };
}

function extractBlockedModelNames(message) {
  const values = new Set();
  const text = String(message || "");
  const matches = text.match(
    /\b[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+\b/gi,
  );

  if (matches?.length) {
    for (const match of matches) {
      values.add(match);
    }
  }

  const tail = text.split(":").pop() || "";
  for (const entry of tail.split(",")) {
    const normalized = entry.trim();
    if (/^[a-z0-9][a-z0-9._/-]*$/i.test(normalized)) {
      values.add(normalized);
    }
  }

  return Array.from(values);
}

function isPromptNode(node) {
  return Boolean(node) && PROMPTISH_NODE_TYPES.has(node.type);
}

function getNodeName(node) {
  return (
    node?.data?.name ||
    node?.data?.label ||
    node?.originalName ||
    node?.type ||
    "Unnamed node"
  );
}

function extractPromptText(node) {
  if (!node) {
    return "";
  }

  if (typeof node?.data?.value?.prompt === "string") {
    return node.data.value.prompt;
  }

  if (typeof node?.data?.value?.string === "string") {
    return node.data.value.string;
  }

  return (
    node?.data?.result?.prompt ||
    node?.data?.output?.prompt ||
    node?.data?.input?.prompt?.value ||
    node?.data?.input?.prompt ||
    node?.data?.prompt ||
    ""
  );
}

function extractNestedWorkflowPrompt(workflow) {
  if (!workflow) {
    return "";
  }

  return (
    workflow?.input?.prompt?.value ||
    workflow?.input?.prompt?.prompt ||
    workflow?.input?.prompt ||
    workflow?.input?.image?.input?.prompt?.value ||
    workflow?.input?.image?.input?.prompt?.prompt ||
    workflow?.input?.image?.input?.prompt ||
    workflow?.input?.image?.prompt ||
    ""
  );
}

function buildDraftName(goal) {
  const sanitized = String(goal || "").replace(/\s+/g, " ").trim();
  const clipped = sanitized.slice(0, 48);
  return `Agent Draft - ${clipped}`;
}

function inferStructuredBrief(goal) {
  const lowerGoal = String(goal || "").toLowerCase();

  return {
    gender:
      matchOne(lowerGoal, ["woman", "female", "man", "male", "girl", "boy", "unisex"]) ||
      "",
    age: extractAge(lowerGoal),
    ethnicity: matchOne(lowerGoal, ETHNICITY_WORDS),
    bodyType: matchOne(lowerGoal, BODY_TYPE_WORDS),
    clothing: extractMatches(lowerGoal, FASHION_ITEM_WORDS).join(", "),
    style: extractMatches(lowerGoal, STYLE_WORDS).join(", "),
    colors: extractMatches(lowerGoal, COLOR_WORDS).join(", "),
    element: extractElement(lowerGoal),
  };
}

function inferFieldValue(goal, node, brief = inferStructuredBrief(goal)) {
  const name = (node.name || "").toLowerCase().trim();
  const rawType = (node.type || "").trim();

  if (MEDIA_IMPORT_NODE_TYPES.has(rawType)) {
    return {
      status: "missing",
      reason: `${node.name || "This node"} needs a user-provided asset.`,
    };
  }

  if (!PROMPTISH_NODE_TYPES.has(rawType) && rawType !== "unknown") {
    return { status: "keep" };
  }

  if (name.includes("gender")) {
    return brief.gender
      ? { status: "set", value: brief.gender }
      : { status: "missing", reason: "Gender is not specified in the goal." };
  }

  if (name.includes("age")) {
    return brief.age
      ? { status: "set", value: brief.age }
      : { status: "missing", reason: "Age is not specified in the goal." };
  }

  if (name.includes("ethnicity")) {
    return brief.ethnicity
      ? { status: "set", value: brief.ethnicity }
      : { status: "missing", reason: "Ethnicity is not specified in the goal." };
  }

  if (name.includes("body")) {
    return brief.bodyType
      ? { status: "set", value: brief.bodyType }
      : { status: "missing", reason: "Body type is not specified in the goal." };
  }

  if (name.includes("cloth") || name.includes("outfit") || name.includes("apparel")) {
    return brief.clothing
      ? { status: "set", value: brief.clothing }
      : {
          status: "missing",
          reason: "Clothing or product details are not specific enough.",
        };
  }

  if (name.includes("style")) {
    return brief.style
      ? { status: "set", value: brief.style }
      : { status: "missing", reason: "Style direction is not specified in the goal." };
  }

  if (name.includes("color")) {
    return brief.colors
      ? { status: "set", value: brief.colors }
      : { status: "missing", reason: "Color direction is not specified in the goal." };
  }

  if (name.includes("element") || name.includes("object") || name.includes("subject")) {
    return brief.element
      ? { status: "set", value: brief.element }
      : {
          status: "missing",
          reason: "Primary subject or element is not specified clearly enough.",
        };
  }

  return { status: "keep" };
}

function previewText(value) {
  if (!value) {
    return "";
  }

  const singleLine = String(value).replace(/\s+/g, " ").trim();
  return singleLine.length > 110
    ? `${singleLine.slice(0, 107)}...`
    : singleLine;
}

function describeEvaluationScore(score) {
  if (score >= 90) {
    return "The run looks structurally healthy and reusable.";
  }

  if (score >= 75) {
    return "The run is healthy, with a few consistency risks worth tightening.";
  }

  if (score >= 60) {
    return "The run works, but the graph still has noticeable quality or reuse risks.";
  }

  return "The run completed, but the outputs still need structural fixes before this is reliable.";
}

function formatAspectRatio(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "";
  }

  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);

  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }

  return a || 1;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function numericOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function uniqueValues(values) {
  return Array.from(new Set(values));
}

function extractAge(lowerGoal) {
  const match =
    lowerGoal.match(/\b(\d{2})[- ]year[- ]old\b/) ||
    lowerGoal.match(/\bage\s*(\d{2})\b/) ||
    lowerGoal.match(/\b(\d{2})\s*yo\b/);
  return match ? match[1] : "";
}

function matchOne(haystack, candidates) {
  for (const candidate of candidates) {
    if (haystack.includes(candidate)) {
      return candidate;
    }
  }

  return "";
}

function extractMatches(haystack, candidates) {
  return candidates.filter((candidate) => haystack.includes(candidate));
}

function extractElement(lowerGoal) {
  const quotedMatch = lowerGoal.match(/["']([^"']{3,60})["']/);
  if (quotedMatch?.[1]) {
    const candidate = sanitizeElementCandidate(quotedMatch[1]);
    if (candidate) {
      return candidate;
    }
  }

  const labeledMatch = lowerGoal.match(
    /\b(reference(?: image)?|product|item|object|subject|asset)\s+(?:is|of|for|:)?\s*(?:a|an|the)?\s*([a-z0-9 -]{3,40})/,
  );

  if (labeledMatch?.[2]) {
    const candidate = sanitizeElementCandidate(labeledMatch[2]);
    if (candidate) {
      return candidate;
    }
  }

  const fashionMatches = extractMatches(lowerGoal, FASHION_ITEM_WORDS);
  if (fashionMatches.length > 0) {
    return fashionMatches.join(", ");
  }

  return "";
}

function sanitizeElementCandidate(value) {
  const candidate = normalizeWhitespace(value)
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\b(with|that|which|and|to|for)\b.*$/i, "")
    .trim();
  const genericTerms = new Set([
    "ad",
    "ads",
    "asset",
    "assets",
    "image",
    "images",
    "reference",
    "reference ad",
    "reference image",
    "workflow",
    "app",
    "video",
    "videos",
    "content",
  ]);

  if (!candidate) {
    return "";
  }

  if (candidate.length < 3) {
    return "";
  }

  if (candidate.split(/\s+/).length > 6) {
    return "";
  }

  if (genericTerms.has(candidate)) {
    return "";
  }

  if (/\b(upload|workflow|app|assets?|reference|matching|generate|create|make)\b/i.test(candidate)) {
    return "";
  }

  return candidate;
}

module.exports = {
  analyzeRecipe,
  applyDraftMutationsToRecipe,
  buildActionPlan,
  buildDesignAppRunPayload,
  buildDraftMutations,
  buildDraftName,
  buildSavePayload,
  classifyRunError,
  diagnoseRunStatus,
  evaluateCompletedRun,
  extractPromptText,
  getExposedNodes,
  getNodeName,
  inferIntent,
  inferMissingInputs,
  previewText,
  summarizeRunStatus,
};
