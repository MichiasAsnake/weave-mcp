const {
  analyzeRecipe,
  extractPromptText,
  getNodeName,
  previewText,
} = require("./analysis");

function buildRevisionPlan({ recipe, evaluation, semanticReview }) {
  const analysis = analyzeRecipe(recipe);
  const nodesById = new Map((recipe.nodes || []).map((node) => [node.id, node]));
  const promptNodes = analysis.promptNodes
    .map((entry) => {
      const node = nodesById.get(entry.id);
      return node
        ? {
            id: node.id,
            name: getNodeName(node),
            type: node.type,
            value: extractPromptText(node),
          }
        : null;
    })
    .filter(Boolean);
  const branchTargets = findBranchGeneratorTargets(recipe, nodesById);

  const findings = collectRevisionSignals(evaluation, semanticReview);
  const targets = selectRevisionTargets(promptNodes);
  const actions = [];
  const skipped = [];

  for (const finding of findings) {
    if (finding.kind === "branch-variation") {
      if (branchTargets.length > 0) {
        const branchRoles = buildBranchRoles(branchTargets.length);
        branchTargets.forEach((target, index) => {
          actions.push(
            buildNodeRewriteAction({
              node: target,
              sourceFinding: finding,
              nextValue: rewriteBranchPrompt(
                getRevisionBaseValue(target),
                branchRoles[index],
              ),
              summary: `Differentiate branch ${index + 1} with ${branchRoles[index].label} framing.`,
            }),
          );
        });
        continue;
      }

      if (!targets.angleNode && !targets.compositionNode) {
        skipped.push({
          kind: finding.kind,
          reason:
            "No angle or composition prompt node was found, so branch-variation guidance needs manual graph editing.",
        });
        continue;
      }

      if (targets.angleNode) {
        actions.push(
          buildNodeRewriteAction({
            node: targets.angleNode,
            sourceFinding: finding,
            nextValue: rewriteAngleInstruction(targets.angleNode.value),
            summary:
              "Strengthen branch separation by demanding clearly different views and framing.",
          }),
        );
      }

      if (targets.compositionNode) {
        actions.push(
          buildNodeRewriteAction({
            node: targets.compositionNode,
            sourceFinding: finding,
            nextValue: rewriteCompositionInstruction(targets.compositionNode.value),
            summary:
              "Add stronger framing diversity so outputs do not read as near-duplicates.",
          }),
        );
      }

      continue;
    }

    if (finding.kind === "coverage") {
      if (branchTargets.length > 0) {
        const widestBranch = branchTargets[branchTargets.length - 1];
        actions.push(
          buildNodeRewriteAction({
            node: widestBranch,
            sourceFinding: finding,
            nextValue: appendInstruction(
              getRevisionBaseValue(widestBranch),
              "Show more of the subject so the full silhouette, fit, and length are clearly visible.",
            ),
            summary: "Reserve one branch for wider coverage and silhouette readability.",
          }),
        );
        continue;
      }

      if (
        targets.compositionNode &&
        actions.some((action) => action.nodeId === targets.compositionNode.id)
      ) {
        continue;
      }

      if (!targets.compositionNode) {
        skipped.push({
          kind: finding.kind,
          reason:
            "No composition prompt node was found for widening or full-subject coverage guidance.",
        });
        continue;
      }

      actions.push(
        buildNodeRewriteAction({
          node: targets.compositionNode,
          sourceFinding: finding,
          nextValue: appendInstruction(
            targets.compositionNode.value,
            "Include at least one wider full-subject shot that clearly shows overall silhouette and layout.",
          ),
          summary: "Ask for at least one wider framing to improve coverage.",
        }),
      );
      continue;
    }

    if (finding.kind === "continuity") {
      if (branchTargets.length > 0) {
        branchTargets.forEach((target) => {
          actions.push(
            buildNodeRewriteAction({
              node: target,
              sourceFinding: finding,
              nextValue: appendInstruction(
                getRevisionBaseValue(target),
                "Keep garment hardware, closures, collar shape, and core styling details identical to the same look across all branches.",
              ),
              summary: "Keep styling and garment construction consistent across branches.",
            }),
          );
        });
        continue;
      }

      if (!targets.briefNode) {
        skipped.push({
          kind: finding.kind,
          reason:
            "No long-form brief prompt node was found for continuity instructions.",
        });
        continue;
      }

      actions.push(
        buildNodeRewriteAction({
          node: targets.briefNode,
          sourceFinding: finding,
          nextValue: appendInstruction(
            targets.briefNode.value,
            "Keep the same subject identity, product details, styling, closures, and key design elements consistent across every output unless a branch explicitly calls for variation.",
          ),
          summary: "Lock subject and styling continuity across branches.",
        }),
      );
      continue;
    }

    if (finding.kind === "visibility") {
      if (branchTargets.length > 0) {
        branchTargets.forEach((target) => {
          actions.push(
            buildNodeRewriteAction({
              node: target,
              sourceFinding: finding,
              nextValue: appendInstruction(
                getRevisionBaseValue(target),
                "Use subtle rim or fill light and enough contrast to keep dark materials, seams, and surface texture clearly readable.",
              ),
              summary: "Improve local lighting and detail separation within each branch.",
            }),
          );
        });
        continue;
      }

      if (!targets.briefNode) {
        skipped.push({
          kind: finding.kind,
          reason:
            "No long-form brief prompt node was found for visibility or lighting guidance.",
        });
        continue;
      }

      actions.push(
        buildNodeRewriteAction({
          node: targets.briefNode,
          sourceFinding: finding,
          nextValue: appendInstruction(
            targets.briefNode.value,
            "Maintain clear subject-background separation and readable surface detail, using rim light, contrast, or cleaner background separation when needed.",
          ),
          summary: "Improve subject separation and detail readability.",
        }),
      );
    }
  }

  const dedupedActions = dedupeActions(actions);

  return {
    stage: "revision-plan",
    summary: {
      findingCount: findings.length,
      actionCount: dedupedActions.length,
      safeActionCount: dedupedActions.length,
      skippedCount: skipped.length,
    },
    findings,
    actions: dedupedActions,
    skipped,
  };
}

function collectRevisionSignals(evaluation, semanticReview) {
  const signals = [];
  const semanticTexts = [
    ...(semanticReview?.findings || []).map((finding) => ({
      source: "semantic",
      severity: finding.severity,
      text: `${finding.summary} ${finding.evidence || ""}`.trim(),
    })),
    ...(semanticReview?.nextActions || []).map((action) => ({
      source: "semantic-next",
      severity: "medium",
      text: action,
    })),
  ];

  const structuralTexts = [
    ...(evaluation?.findings || []).map((finding) => ({
      source: "structural",
      severity: finding.severity,
      text: `${finding.summary} ${finding.details || ""}`.trim(),
    })),
    ...(evaluation?.nextActions || []).map((action) => ({
      source: "structural-next",
      severity: "medium",
      text: action,
    })),
  ];

  for (const entry of [...semanticTexts, ...structuralTexts]) {
    const kinds = classifySignalKinds(entry.text);
    for (const kind of kinds) {
      if (!signals.some((signal) => signal.kind === kind)) {
        signals.push({
          kind,
          source: entry.source,
          severity: entry.severity,
          text: entry.text,
        });
      }
    }
  }

  return signals;
}

function classifySignalKinds(text) {
  const value = String(text || "").toLowerCase();
  const kinds = new Set();

  if (
    /\bvariation|duplicate|near-duplicate|angles|angle|profile|framing|camera distance|branch divergence|branch separation|pose\b/.test(
      value,
    )
  ) {
    kinds.add("branch-variation");
  }

  if (/\bfull-body|full subject|wider|wide shot|camera distance|coverage|silhouette\b/.test(value)) {
    kinds.add("coverage");
  }

  if (/\bcontinuity|consistent|consistency|same subject|same look|collar|closure|zip|seam placement\b/.test(value)) {
    kinds.add("continuity");
  }

  if (
    /\blighting|rim light|kicker light|background|dark-on-dark|readability|texture|separation|contrast\b/.test(
      value,
    )
  ) {
    kinds.add("visibility");
  }

  return Array.from(kinds);
}

function selectRevisionTargets(promptNodes) {
  const sortedByLength = [...promptNodes].sort(
    (left, right) => (right.value?.length || 0) - (left.value?.length || 0),
  );

  const angleNode =
    findPromptNode(
      promptNodes,
      (node) => /\bviews?|angles?|frontal|front|side|profile|45 degrees|grid\b/i.test(node.value),
    ) || null;

  const compositionNode =
    findPromptNode(
      promptNodes,
      (node) =>
        node.id !== angleNode?.id &&
        /\bphotograph|portrait|full body|camera|framing|shot\b/i.test(node.value),
    ) || null;

  const briefNode =
    findPromptNode(
      sortedByLength,
      (node) => (node.value || "").length >= 180 && /\bmodel|subject|style|background|aesthetic\b/i.test(node.value),
    ) ||
    sortedByLength[0] ||
    null;

  return {
    angleNode,
    compositionNode,
    briefNode,
  };
}

function findBranchGeneratorTargets(recipe, nodesById) {
  const outputs = (recipe.nodes || []).filter((node) => node.type === "workflow_output");
  const edges = recipe.edges || [];
  const branchTargets = [];

  for (const output of outputs) {
    const incoming = edges.filter((edge) => edge.target === output.id);
    for (const edge of incoming) {
      const sourceNode = nodesById.get(edge.source);
      if (!sourceNode) {
        continue;
      }

      const promptValue = extractPromptText(sourceNode);
      const hasImageInput = Boolean(sourceNode?.data?.input?.image);
      if (!promptValue || !hasImageInput) {
        continue;
      }

      if (branchTargets.some((target) => target.id === sourceNode.id)) {
        continue;
      }

      const promptEdgeConnected = edges.some(
        (candidate) =>
          candidate.target === sourceNode.id &&
          typeof candidate.targetHandle === "string" &&
          /-input-prompt$/i.test(candidate.targetHandle),
      );

      branchTargets.push({
        id: sourceNode.id,
        name: getNodeName(sourceNode),
        type: sourceNode.type,
        value: promptValue,
        currentValue: promptValue,
        baseValue:
          extractWorkflowPromptFromOutput(output?.data?.input?.workflow) || promptValue,
        promptEdgeConnected,
      });
    }
  }

  return branchTargets;
}

function buildBranchRoles(count) {
  const roles = [
    {
      label: "a front-facing three-quarter hero angle",
      instruction:
        "Compose this branch as a strong three-quarter hero angle with confident posture and a clear read of the front silhouette.",
    },
    {
      label: "a true side or profile view",
      instruction:
        "Compose this branch as a true side or profile view so the side silhouette and garment shape are clearly distinct from the other branches.",
    },
    {
      label: "a wider full-subject view",
      instruction:
        "Compose this branch as a wider full-subject view with more environment and body coverage so the full silhouette and fit are visible.",
    },
    {
      label: "a detail-focused alternate view",
      instruction:
        "Compose this branch as a tighter detail-led alternate view that still feels distinct in pose, framing, and emphasis.",
    },
  ];

  return Array.from({ length: count }, (_, index) => roles[index] || roles[roles.length - 1]);
}

function findPromptNode(nodes, predicate) {
  return nodes.find((node) => predicate(node)) || null;
}

function buildNodeRewriteAction({ node, nextValue, sourceFinding, summary }) {
  const currentValue = node.currentValue ?? node.value ?? "";
  const instructionBase = getRevisionBaseValue(node);
  return {
    type: "rewrite-prompt-node",
    nodeId: node.id,
    nodeName: node.name,
    nodeType: node.type,
    current: previewText(currentValue),
    currentValue,
    value: nextValue,
    instruction: extractInstruction(instructionBase, nextValue),
    reason: summary,
    sourceFinding,
    disconnectPromptEdge:
      node.type === "custommodelV2" && Boolean(node.promptEdgeConnected),
  };
}

function getRevisionBaseValue(node) {
  return node?.baseValue || node?.currentValue || node?.value || "";
}

function rewriteAngleInstruction(current) {
  return replaceOrAppend(
    current,
    /\b3 views?.*$/i,
    "3 clearly distinct views in a vertical grid: one 3/4 view, one true side or profile view, and one wider full-subject view. Each output must use noticeably different framing and pose.",
  );
}

function rewriteBranchPrompt(current, role) {
  return appendInstruction(
    current,
    `${role.instruction} Make this output visibly different from the other branches in angle, crop, and pose while keeping the same subject and styling.`,
  );
}

function rewriteCompositionInstruction(current) {
  return replaceOrAppend(
    current,
    /\brealistic photograph.*$/i,
    "realistic photograph. Use clearly different framing across outputs, including at least one wider full-subject shot.",
  );
}

function appendInstruction(current, instruction) {
  const normalizedCurrent = normalizeWhitespace(current);
  const normalizedInstruction = normalizeWhitespace(instruction);

  if (!normalizedCurrent) {
    return instruction;
  }

  if (normalizedCurrent.toLowerCase().includes(normalizedInstruction.toLowerCase())) {
    return current;
  }

  const separator = /[.!?]\s*$/.test(normalizedCurrent) ? " " : ". ";
  return `${normalizedCurrent}${separator}${instruction}`;
}

function replaceOrAppend(current, pattern, replacement) {
  const normalizedCurrent = normalizeWhitespace(current);
  if (!normalizedCurrent) {
    return replacement;
  }

  if (pattern.test(normalizedCurrent)) {
    return normalizedCurrent.replace(pattern, replacement);
  }

  return appendInstruction(normalizedCurrent, replacement);
}

function dedupeActions(actions) {
  const byNodeId = new Map();

  for (const action of actions) {
    const existing = byNodeId.get(action.nodeId);
    if (!existing) {
      byNodeId.set(action.nodeId, action);
      continue;
    }

    existing.value = appendInstruction(existing.value, action.instruction || action.value);
    existing.reason = `${existing.reason} ${action.reason}`.trim();
    existing.disconnectPromptEdge =
      Boolean(existing.disconnectPromptEdge) || Boolean(action.disconnectPromptEdge);
  }

  return Array.from(byNodeId.values()).filter(
    (action) =>
      normalizeWhitespace(action.currentValue) !== normalizeWhitespace(action.value) ||
      Boolean(action.disconnectPromptEdge),
  );
}

function extractInstruction(current, nextValue) {
  const normalizedCurrent = normalizeWhitespace(current);
  const normalizedNext = normalizeWhitespace(nextValue);

  if (!normalizedCurrent) {
    return normalizedNext;
  }

  if (normalizedNext.startsWith(normalizedCurrent)) {
    return normalizedNext.slice(normalizedCurrent.length).replace(/^[.\s]+/, "");
  }

  return normalizedNext;
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWorkflowPromptFromOutput(workflow) {
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

module.exports = {
  buildRevisionPlan,
};
