function inferGoalCapabilities(goal) {
  const text = normalizeText(goal);
  const capabilities = new Set();
  const requiredInputs = new Set();
  const packaging = new Set();
  const mediaTargets = new Set();
  const signals = [];

  if (/\b(video|animation|animate|motion|reel|tiktok|ugc|voiceover|voice over)\b/.test(text)) {
    capabilities.add("video-output");
    mediaTargets.add("video");
    signals.push("Goal mentions video, animation, or UGC-style output.");
  }

  if (/\b(image|photo|photograph|poster|ad|creative|campaign|thumbnail)\b/.test(text)) {
    capabilities.add("image-output");
    mediaTargets.add("image");
    signals.push("Goal mentions image-style deliverables.");
  }

  if (/\b(3d|mesh|model|rodin)\b/.test(text)) {
    capabilities.add("3d-output");
    mediaTargets.add("3d");
    signals.push("Goal mentions 3D output.");
  }

  if (/\b(app|design app|tool|workflow app|template|share|reusable|self-serve|self serve)\b/.test(text)) {
    capabilities.add("design-app");
    packaging.add("design-app");
    signals.push("Goal implies a reusable packaged workflow or app.");
  }

  if (/\b(upload|reference|reference image|replicate|match|inspired by|use this ad|asset|assets)\b/.test(text)) {
    capabilities.add("reference-driven");
    requiredInputs.add("reference-asset");
    signals.push("Goal implies user-provided assets or style references.");
  }

  if (/\b(edit|replace background|swap|composite|remix|restyle|inpaint|variation|variant)\b/.test(text)) {
    capabilities.add("image-editing");
    signals.push("Goal implies editing or transforming existing imagery.");
  }

  if (/\b(multi[- ]view|angles|angle|front|side|profile|three[- ]quarter|45 degree|45 degrees|full body)\b/.test(text)) {
    capabilities.add("multi-view");
    capabilities.add("branch-variation");
    signals.push("Goal calls for multi-view or multi-angle outputs.");
  }

  if (/\b(multiple|variants|three outputs|3 outputs|several|set of)\b/.test(text)) {
    capabilities.add("multi-output");
    signals.push("Goal asks for multiple outputs or variants.");
  }

  if (/\b(style guide|brand|on brand|look and feel|visual system)\b/.test(text)) {
    capabilities.add("style-system");
    signals.push("Goal implies reusable stylistic consistency.");
  }

  if (/\b(voice|voiceover|narration|audio|sound)\b/.test(text)) {
    capabilities.add("audio-output");
    requiredInputs.add("voice-input");
    signals.push("Goal mentions voice or audio.");
  }

  if (capabilities.size === 0) {
    capabilities.add("image-output");
    signals.push("Defaulting to image-output because no stronger media signal was detected.");
  }

  return {
    goal: String(goal || "").trim(),
    capabilities: Array.from(capabilities).sort(),
    requiredInputs: Array.from(requiredInputs).sort(),
    packaging: Array.from(packaging).sort(),
    mediaTargets: Array.from(mediaTargets).sort(),
    signals,
  };
}

function summarizeRecipeCapabilities(recipeAnalysis) {
  const nodeTypes = new Set((recipeAnalysis.nodeTypes || []).map((entry) => entry.type));
  const capabilities = new Set();
  const constraints = [];
  const evidence = [];

  if (recipeAnalysis.hasDesignAppMetadata || recipeAnalysis.exposedNodes.length > 0) {
    capabilities.add("design-app");
    evidence.push("Recipe exposes Design App metadata or user-facing inputs.");
  }

  if (recipeAnalysis.outputs.length > 0) {
    capabilities.add("workflow-output");
    evidence.push(`Recipe exposes ${recipeAnalysis.outputs.length} workflow output node(s).`);
  }

  if (recipeAnalysis.importNodes.length > 0) {
    capabilities.add("reference-driven");
    evidence.push("Recipe includes import-style nodes for user assets or references.");
  }

  if (nodeTypes.has("crop") || nodeTypes.has("router")) {
    capabilities.add("branch-variation");
    evidence.push("Recipe contains routing or crop nodes that support branch variation.");
  }

  if ((recipeAnalysis.outputs || []).length > 1) {
    capabilities.add("multi-output");
    evidence.push("Recipe produces multiple outputs.");
  }

  if (nodeTypes.has("crop")) {
    capabilities.add("image-editing");
    evidence.push("Recipe includes crop or image transformation nodes.");
  }

  if (nodeTypes.has("anyllm")) {
    capabilities.add("llm-augmentation");
    evidence.push("Recipe uses an LLM-style node for text synthesis or prompt orchestration.");
  }

  if (nodeTypes.has("router")) {
    capabilities.add("multi-view");
    evidence.push("Recipe uses a router, which often fans out variations or view-specific branches.");
  }

  const videoNodeTypes = [
    "extract_video_frame",
    "video",
    "video_output",
    "audio",
    "voice",
  ];
  const hasVideoNodes = videoNodeTypes.some((type) => nodeTypes.has(type));
  if (hasVideoNodes) {
    capabilities.add("video-output");
    evidence.push("Recipe contains video or audio-related node types.");
  }

  if (recipeAnalysis.outputs.length > 0 && !hasVideoNodes) {
    capabilities.add("image-output");
    evidence.push("Recipe outputs appear to be image-first because no video-specific nodes were detected.");
  }

  if (!capabilities.has("reference-driven")) {
    constraints.push("No import nodes are present, so user asset workflows will need direct graph mutation or a different base recipe.");
  }

  if (!capabilities.has("design-app")) {
    constraints.push("Recipe is not already packaged as a Design App.");
  }

  return {
    capabilities: Array.from(capabilities).sort(),
    constraints,
    evidence,
  };
}

function rankTemplateCandidates(
  goalProfile,
  templateProfiles,
  { explicitTemplateId, preferCheap = false } = {},
) {
  const desired = new Set(goalProfile.capabilities || []);

  const ranked = templateProfiles
    .map((templateProfile) => {
      const provided = new Set(templateProfile.capabilityProfile?.capabilities || []);
      let score = 0;
      const matched = [];
      const missing = [];
      const reasons = [];
      const baselineEstimatedCost = Number(
        templateProfile.template?.baselineEstimatedCost,
      );

      for (const capability of desired) {
        if (provided.has(capability)) {
          score += 3;
          matched.push(capability);
        } else {
          missing.push(capability);
        }
      }

      if (provided.has("design-app") && desired.has("design-app")) {
        score += 2;
        reasons.push("Already exposes a Design App surface.");
      }

      if (provided.has("reference-driven") && desired.has("reference-driven")) {
        score += 2;
        reasons.push("Already supports reference-style inputs.");
      }

      if (provided.has("multi-output") && desired.has("multi-output")) {
        score += 1;
        reasons.push("Already produces multiple outputs.");
      }

      if (explicitTemplateId && templateProfile.template.id === explicitTemplateId) {
        score += 1000;
        reasons.push("Explicitly requested template.");
      }

      if (missing.length > 0) {
        reasons.push(`Missing direct support for: ${missing.join(", ")}.`);
      }

      if (preferCheap && Number.isFinite(baselineEstimatedCost)) {
        reasons.push(
          `Cheap mode prefers lower-cost bases; this template has a verified baseline near ${baselineEstimatedCost} credits.`,
        );
      }

      return {
        ...templateProfile,
        score,
        compatibilityScore: score,
        baselineEstimatedCost: Number.isFinite(baselineEstimatedCost)
          ? baselineEstimatedCost
          : null,
        matchedCapabilities: matched,
        missingCapabilities: missing,
        reasons,
      };
    })
    .sort((left, right) => compareRankedCandidates(left, right, { preferCheap }));

  return ranked;
}

function compareRankedCandidates(left, right, { preferCheap = false } = {}) {
  const leftCompatibility = Number(left.compatibilityScore || 0);
  const rightCompatibility = Number(right.compatibilityScore || 0);

  if (leftCompatibility !== rightCompatibility) {
    const diff = Math.abs(leftCompatibility - rightCompatibility);
    if (preferCheap && diff <= 2) {
      const costCompare = compareTemplateCost(left, right);
      if (costCompare !== 0) {
        return costCompare;
      }
    }

    return rightCompatibility - leftCompatibility;
  }

  if (preferCheap) {
    const costCompare = compareTemplateCost(left, right);
    if (costCompare !== 0) {
      return costCompare;
    }
  }

  return 0;
}

function compareTemplateCost(left, right) {
  const leftCost = Number.isFinite(left.baselineEstimatedCost)
    ? left.baselineEstimatedCost
    : Number.POSITIVE_INFINITY;
  const rightCost = Number.isFinite(right.baselineEstimatedCost)
    ? right.baselineEstimatedCost
    : Number.POSITIVE_INFINITY;

  if (leftCost === rightCost) {
    return 0;
  }

  return leftCost - rightCost;
}

function buildCapabilityPlan(
  goal,
  { templateProfiles, explicitTemplate, preferCheap = false } = {},
) {
  const goalProfile = inferGoalCapabilities(goal);
  const rankedTemplates = rankTemplateCandidates(goalProfile, templateProfiles, {
    explicitTemplateId: explicitTemplate?.id,
    preferCheap,
  });
  const selected = rankedTemplates[0] || null;
  const strategy = selected
    ? buildStrategy(goalProfile, selected)
    : {
        summary: "No template candidates are available yet.",
        approach: [],
      };

  return {
    goalProfile,
    candidates: rankedTemplates,
    selectedTemplate: selected?.template || explicitTemplate || null,
    selectedCapabilityProfile: selected?.capabilityProfile || null,
    preferCheap,
    strategy,
  };
}

function buildCapabilityMutationPlan({
  goalProfile,
  capabilityProfile,
  recipeAnalysis,
}) {
  const missingCapabilities = diffCapabilities(
    goalProfile?.capabilities,
    capabilityProfile?.capabilities,
  );
  const intents = [];
  const anchors = buildStructuralAnchors(recipeAnalysis);
  const hasImportNodes = (recipeAnalysis?.importNodes?.length || 0) > 0;
  const hasExposedImportNodes = (recipeAnalysis?.exposedNodes || []).some(
    (entry) => entry.type === "import",
  );
  const hiddenPromptControlCount = Math.max(
    0,
    (recipeAnalysis?.promptNodes?.length || 0) - (recipeAnalysis?.exposedNodes?.length || 0),
  );

  if (
    (goalProfile?.requiredInputs || []).includes("reference-asset") &&
    !hasExposedImportNodes
  ) {
    intents.push({
      type: "add-reference-input",
      priority: "high",
      autoApplicable: false,
      detail: hasImportNodes
        ? "Expose the existing import/reference inputs so users can supply source assets through the Design App surface."
        : "Add one or more import/reference nodes and wire them into the main generation path so users can supply source assets.",
      anchors: {
        promptNodes: anchors.promptNodes,
        outputs: anchors.outputs,
        exposedNodes: anchors.exposedNodes,
      },
    });
  }

  if ((goalProfile?.requiredInputs || []).includes("voice-input")) {
    intents.push({
      type: "add-voice-input",
      priority: "high",
      autoApplicable: false,
      detail:
        "Expose a voiceover or narration input and wire it into an audio-capable generation chain.",
      anchors: {
        outputs: anchors.outputs,
        exposedNodes: anchors.exposedNodes,
      },
    });
  }

  if (missingCapabilities.includes("video-output")) {
    intents.push({
      type: "add-video-output-chain",
      priority: "high",
      autoApplicable: false,
      detail:
        "Introduce or replace the output chain with video-capable nodes, then wire final outputs to video results instead of image-only assets.",
      anchors: {
        outputs: anchors.outputs,
      },
    });
  }

  if (missingCapabilities.includes("audio-output")) {
    intents.push({
      type: "add-audio-output-chain",
      priority: "high",
      autoApplicable: false,
      detail:
        "Add audio or voiceover generation nodes and connect them to the final packaged workflow.",
      anchors: {
        outputs: anchors.outputs,
        exposedNodes: anchors.exposedNodes,
      },
    });
  }

  if (
    (goalProfile?.capabilities || []).includes("branch-variation") &&
    !(capabilityProfile?.capabilities || []).includes("branch-variation")
  ) {
    intents.push({
      type: "add-branch-control",
      priority: "medium",
      autoApplicable: false,
      detail:
        "Split the workflow into multiple controlled branches so the agent can enforce view, crop, or narrative variation.",
      anchors: {
        promptNodes: anchors.promptNodes,
        outputs: anchors.outputs,
      },
    });
  }

  if (
    (goalProfile?.capabilities || []).includes("design-app") &&
    !(capabilityProfile?.capabilities || []).includes("design-app")
  ) {
    intents.push({
      type: "expose-design-app-inputs",
      priority: "medium",
      autoApplicable: false,
      detail:
        "Publish or expose user-facing Design App parameters after the workflow graph is stable.",
      anchors: {
        exposedNodes: anchors.exposedNodes,
      },
    });
  }

  if (
    shouldExposeMoreDesignAppInputs(goalProfile) &&
    hiddenPromptControlCount > 0
  ) {
    intents.push({
      type: "expose-design-app-inputs",
      priority: "medium",
      autoApplicable: false,
      detail:
        "Promote a small set of hidden prompt or input nodes into user-facing Design App controls so the workflow is more editable without changing graph wiring.",
      anchors: {
        promptNodes: anchors.promptNodes,
        exposedNodes: anchors.exposedNodes,
      },
    });
  }

  if (missingCapabilities.includes("style-system")) {
    intents.push({
      type: "add-style-control",
      priority: "medium",
      autoApplicable: false,
      detail:
        "Expose brand/style controls so the workflow can be reused across similar briefs without rewriting the graph.",
      anchors: {
        promptNodes: anchors.promptNodes,
        exposedNodes: anchors.exposedNodes,
      },
    });
  }

  return {
    missingCapabilities,
    summary: {
      missingCapabilityCount: missingCapabilities.length,
      structuralIntentCount: intents.length,
    },
    intents,
  };
}

function buildStructuralAnchors(recipeAnalysis) {
  return {
    outputs: (recipeAnalysis?.outputs || []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type,
    })),
    promptNodes: (recipeAnalysis?.promptNodes || []).slice(0, 4).map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type,
    })),
    exposedNodes: (recipeAnalysis?.exposedNodes || []).map((entry) => ({
      id: entry.id,
      name: entry.name,
      type: entry.type,
    })),
  };
}

function buildStrategy(goalProfile, candidate) {
  const approach = [];
  const matched = candidate.matchedCapabilities || [];
  const missing = candidate.missingCapabilities || [];

  approach.push(
    `Start from ${candidate.template.label} because it already supports ${matched.join(", ") || "the closest matching capabilities"}.`,
  );

  if (candidate.capabilityProfile?.capabilities?.includes("design-app")) {
    approach.push("Keep the existing Design App packaging and remap exposed inputs to the new brief.");
  } else if ((goalProfile.capabilities || []).includes("design-app")) {
    approach.push("Add or expose Design App inputs after the workflow logic is stable.");
  }

  if ((goalProfile.capabilities || []).includes("reference-driven")) {
    approach.push("Expect at least one user-provided reference or source asset and preserve that in the draft mutation plan.");
  }

  if ((goalProfile.capabilities || []).includes("branch-variation")) {
    approach.push("Plan for branch-specific prompt control rather than one shared prompt if distinct outputs matter.");
  }

  if (missing.length > 0) {
    approach.push(`Bridge missing capabilities with direct graph mutation: ${missing.join(", ")}.`);
  }

  if (Number.isFinite(candidate.template?.baselineEstimatedCost)) {
    approach.push(
      `Current verified baseline for this template is about ${candidate.template.baselineEstimatedCost} credits per run path before any extra revisions or retries.`,
    );
  }

  return {
    summary: `Use ${candidate.template.label} as the nearest capability match and extend it where needed.`,
    approach,
  };
}

function diffCapabilities(desiredValues, providedValues) {
  const desired = new Set(desiredValues || []);
  const provided = new Set(providedValues || []);
  return Array.from(desired).filter((value) => !provided.has(value));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function shouldExposeMoreDesignAppInputs(goalProfile) {
  const text = normalizeText(goalProfile?.goal);
  if (!(goalProfile?.capabilities || []).includes("design-app")) {
    return false;
  }

  return /\b(editable|controls?|tweak|adjust|customi[sz]e|few editable|creative controls?|inputs?)\b/.test(
    text,
  );
}

module.exports = {
  buildCapabilityPlan,
  buildCapabilityMutationPlan,
  inferGoalCapabilities,
  rankTemplateCandidates,
  summarizeRecipeCapabilities,
};
