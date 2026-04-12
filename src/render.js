function render(flags, payload) {
  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (Array.isArray(payload)) {
    console.table(payload);
    return;
  }

  if (
    payload.recipeAnalysis ||
    payload.draftMutations ||
    payload.target ||
    payload.cycle ||
    payload.created ||
    payload.plan ||
    payload.repairPlan ||
    payload.repair ||
    payload.stage
  ) {
    printRichObject(payload);
    return;
  }

  console.log(JSON.stringify(payload, null, 2));
}

function printRichObject(payload) {
  if (payload.goal) {
    console.log(`Goal: ${payload.goal}`);
  }

  if (payload.agentic !== undefined) {
    console.log(`Agentic: ${payload.agentic ? "yes" : "no"}`);
  }

  if (payload.stage) {
    console.log(`Stage: ${payload.stage}`);
  }

  if (payload.template) {
    console.log(
      `Template: ${payload.template.label} (${payload.template.alias} / ${payload.template.id})`,
    );
  }

  if (payload.recipe) {
    console.log(`Recipe: ${payload.recipe.name} (${payload.recipe.id})`);
  }

  if (payload.intent) {
    console.log(`Intent: ${payload.intent.label}`);
  }

  if (payload.capabilityPlan?.goalProfile) {
    console.log(
      `Capabilities: ${(payload.capabilityPlan.goalProfile.capabilities || []).join(", ") || "n/a"}`,
    );
  }

  if (payload.authSource) {
    console.log(`Auth: ${payload.authSource}`);
  }

  if (payload.langgraph) {
    console.log(
      `LangGraph: mode=${payload.langgraph.mode} thread=${payload.langgraph.threadId}`,
    );
  }

  if (payload.recipeGraph) {
    console.log(
      `RecipeGraph: mode=${payload.recipeGraph.mode} thread=${payload.recipeGraph.threadId}`,
    );
  }

  if (payload.sessionGraph) {
    console.log(`SessionGraph: thread=${payload.sessionGraph.threadId}`);
  }

  if (payload.trace?.length) {
    console.log("\nTrace");
    for (const step of payload.trace) {
      console.log(`- ${step}`);
    }
  }

  if (payload.langgraph?.checkpointId || payload.langgraph?.next?.length) {
    console.log("\nCheckpoint");
    if (payload.langgraph.checkpointId) {
      console.log(`- checkpointId=${payload.langgraph.checkpointId}`);
    }
    if (payload.langgraph.next?.length) {
      console.log(`- next=${payload.langgraph.next.join(", ")}`);
    }
  }

  if (payload.recipeGraph?.checkpointId || payload.recipeGraph?.next?.length) {
    console.log("\nRecipe Checkpoint");
    if (payload.recipeGraph.checkpointId) {
      console.log(`- checkpointId=${payload.recipeGraph.checkpointId}`);
    }
    if (payload.recipeGraph.next?.length) {
      console.log(`- next=${payload.recipeGraph.next.join(", ")}`);
    }
  }

  if (payload.sessionGraph?.checkpointId || payload.sessionGraph?.next?.length) {
    console.log("\nSession Checkpoint");
    if (payload.sessionGraph.checkpointId) {
      console.log(`- checkpointId=${payload.sessionGraph.checkpointId}`);
    }
    if (payload.sessionGraph.next?.length) {
      console.log(`- next=${payload.sessionGraph.next.join(", ")}`);
    }
  }

  if (payload.capabilityPlan?.strategy) {
    console.log("\nCapability Plan");
    console.log(`- ${payload.capabilityPlan.strategy.summary}`);
    for (const step of payload.capabilityPlan.strategy.approach || []) {
      console.log(`- ${step}`);
    }

    const candidates = payload.capabilityPlan.candidates || [];
    if (candidates.length > 0) {
      console.log("Template Candidates");
      for (const candidate of candidates.slice(0, 3)) {
        const matched = (candidate.matchedCapabilities || []).join(", ") || "none";
        const missing = (candidate.missingCapabilities || []).join(", ") || "none";
        console.log(
          `- ${candidate.template.label}: score=${candidate.score} matched=[${matched}] missing=[${missing}]`,
        );
      }
    }
  }

  if (payload.recipeAnalysis) {
    console.log("\nRecipe Analysis");
    console.log(
      `- ${payload.recipeAnalysis.recipeName} | nodes=${payload.recipeAnalysis.nodeCount} edges=${payload.recipeAnalysis.edgeCount} visibility=${payload.recipeAnalysis.visibility}`,
    );

    if (payload.recipeAnalysis.capabilityProfile?.capabilities?.length) {
      console.log(
        `- Capabilities: ${payload.recipeAnalysis.capabilityProfile.capabilities.join(", ")}`,
      );
    }

    if (payload.recipeAnalysis.exposedNodes.length) {
      console.log("- Exposed nodes:");
      for (const node of payload.recipeAnalysis.exposedNodes) {
        console.log(
          `  ${node.name} [${node.type}]${node.promptPreview ? ` -> ${node.promptPreview}` : ""}`,
        );
      }
    }
  }

  if (payload.missingInputs?.length) {
    console.log("\nMissing Inputs");
    for (const item of payload.missingInputs) {
      console.log(`- ${item}`);
    }
  }

  if (payload.actions?.length) {
    console.log("\nActions");
    if (payload.actions.every((action) => action.step && action.detail)) {
      for (const action of payload.actions) {
        console.log(`${action.step}. ${action.detail}`);
      }
    } else {
      for (const action of payload.actions) {
        console.log(
          `- ${action.type}: ${action.nodeName || action.nodeId || action.model || "recipe"}`,
        );
      }
    }
  }

  if (payload.draftMutations?.length) {
    console.log("\nDraft Mutations");
    for (const mutation of payload.draftMutations) {
      console.log(`- ${mutation.type}: ${mutation.nodeName || mutation.target}`);
    }
  }

  if (payload.capabilityMutationPlan?.intents?.length) {
    console.log("\nCapability Mutations");
    for (const intent of payload.capabilityMutationPlan.intents) {
      console.log(`- ${intent.type}: ${intent.detail}`);
      const anchorBits = [];
      if (intent.anchors?.outputs?.length) {
        anchorBits.push(
          `outputs=${intent.anchors.outputs.map((entry) => entry.name || entry.id).join(", ")}`,
        );
      }
      if (intent.anchors?.promptNodes?.length) {
        anchorBits.push(
          `prompts=${intent.anchors.promptNodes.map((entry) => entry.name || entry.id).join(", ")}`,
        );
      }
      if (intent.anchors?.exposedNodes?.length) {
        anchorBits.push(
          `inputs=${intent.anchors.exposedNodes.map((entry) => entry.name || entry.id).join(", ")}`,
        );
      }
      if (anchorBits.length) {
        console.log(`  anchors: ${anchorBits.join(" | ")}`);
      }
    }
  }

  if (payload.structuralToolPlan?.tools?.length) {
    console.log("\nStructural Tools");
    for (const tool of payload.structuralToolPlan.tools) {
      console.log(
        `- ${tool.intentType}: ${tool.toolName || "n/a"} status=${tool.status} auto=${tool.autoApplicable ? "yes" : "no"}`,
      );
      if (tool.reason) {
        console.log(`  ${tool.reason}`);
      }
      for (const selection of tool.selections || []) {
        console.log(
          `  expose ${selection.nodeName} [${selection.nodeType}]${selection.required ? " required" : ""}`,
        );
      }
    }
  }

  if (payload.nextExecutionStep) {
    console.log("\nNext Step");
    console.log(`- ${payload.nextExecutionStep}`);
  }

  if (payload.created) {
    console.log("\nCreated");
    console.log(`- ${payload.created.id}`);
    console.log(`- ${payload.created.url}`);
  }

  if (payload.target) {
    console.log("\nTarget");
    console.log(`- ${payload.target.name} (${payload.target.id})`);
    console.log(`- ${payload.target.url}`);
  }

  if (payload.executionTarget) {
    console.log("\nExecution Sandbox");
    console.log(`- source: ${payload.executionTarget.sourceRecipeName || payload.sourceRecipeId || "n/a"} (${payload.executionTarget.sourceRecipeId || payload.sourceRecipeId || "n/a"})`);
    console.log(`- sandbox: ${payload.executionTarget.name} (${payload.executionTarget.id})`);
    console.log(`- ${payload.executionTarget.url}`);
  }

  if (payload.persisted) {
    console.log("\nPersisted");
    console.log(
      `- nodes=${payload.persisted.nodeCount} edges=${payload.persisted.edgeCount} updatedAt=${payload.persisted.updatedAt}`,
    );
  }

  if (payload.stopReason) {
    console.log("\nStop");
    console.log(`- ${payload.stopReason}`);
  }

  if (payload.cost) {
    console.log("\nCost");
    console.log(JSON.stringify(payload.cost, null, 2));
  }

  if (payload.plan?.summary) {
    printRepairPlan(payload.plan);
  }

  if (payload.repairPlan?.summary) {
    printRepairPlan(payload.repairPlan);
  }

  if (payload.appliedActions?.length || payload.skippedActions?.length) {
    printRepairOutcome(payload);
  }

  if (payload.repairAttempts?.length) {
    printRepairAttempts(payload.repairAttempts);
  }

  if (payload.diagnosis) {
    console.log("\nDiagnosis");
    console.log(`- ${payload.diagnosis.summary}`);
    console.log(`- ${payload.diagnosis.details}`);
  }

  if (payload.status?.summary) {
    console.log("\nRun Status");
    for (const run of payload.status.summary) {
      console.log(
        `- ${run.runId}: ${run.status} progress=${run.progress ?? "n/a"} outputs=${run.outputCount ?? 0}`,
      );
      for (const result of run.results || []) {
        console.log(`  ${result.type || "asset"} ${result.url || result.id}`);
      }
    }
  }

  if (payload.evaluation) {
    printEvaluation(payload.evaluation);
  }

  if (payload.semanticReview) {
    printSemanticReview(payload.semanticReview);
  }

  if (payload.revisionPlan) {
    printRevisionPlan(payload.revisionPlan);
  }

  if (payload.appliedRevisionActions?.length) {
    printRevisionOutcome(payload.appliedRevisionActions);
  }

  if (payload.appliedStructuralTools?.length || payload.skippedStructuralTools?.length) {
    printStructuralToolOutcome(payload.appliedStructuralTools, payload.skippedStructuralTools);
  }

  if (payload.iterations?.length) {
    printImprovementIterations(payload.iterations);
  }

  if (payload.comparison) {
    printImprovementComparison(payload.comparison);
  }

  if (payload.cycle) {
    console.log("\nCycle");
    if (payload.cycle.stage) {
      console.log(`- ${payload.cycle.stage}`);
    }
    if (payload.cycle.executionTarget) {
      console.log(
        `- sandbox: ${payload.cycle.executionTarget.name} (${payload.cycle.executionTarget.id})`,
      );
    }
    if (payload.cycle.diagnosis) {
      console.log(`- ${payload.cycle.diagnosis.summary}`);
    }
    if (payload.cycle.cost) {
      console.log(`- cost: ${JSON.stringify(payload.cycle.cost)}`);
    }
    if (payload.cycle.status?.summary) {
      for (const run of payload.cycle.status.summary) {
        console.log(
          `- ${run.runId}: ${run.status} progress=${run.progress ?? "n/a"} outputs=${run.outputCount ?? 0}`,
        );
      }
    }
    if (payload.cycle.evaluation) {
      printEvaluation(payload.cycle.evaluation);
    }
    if (payload.cycle.semanticReview) {
      printSemanticReview(payload.cycle.semanticReview);
    }
    if (payload.cycle.revisionPlan) {
      printRevisionPlan(payload.cycle.revisionPlan);
    }
    if (payload.cycle.repairPlan?.summary) {
      printRepairPlan(payload.cycle.repairPlan);
    }
    if (payload.cycle.repair?.appliedActions?.length) {
      printRepairOutcome(payload.cycle.repair);
    }
    if (payload.cycle.repairAttempts?.length) {
      printRepairAttempts(payload.cycle.repairAttempts);
    }
  }
}

function printStructuralToolOutcome(appliedTools, skippedTools) {
  console.log("\nStructural Tool Outcome");

  for (const tool of appliedTools || []) {
    console.log(`- applied ${tool.toolName}: ${tool.detail}`);
    for (const selection of tool.appliedSelections || []) {
      console.log(
        `  ${selection.nodeName} -> exposed order=${selection.order}${selection.required ? " required" : ""}`,
      );
    }
  }

  for (const tool of skippedTools || []) {
    console.log(`- skipped ${tool.toolName || tool.intentType}: ${tool.reason}`);
  }
}

function printEvaluation(evaluation) {
  console.log("\nEvaluation");
  if (evaluation.score != null) {
    console.log(`- score=${evaluation.score}`);
  }
  if (evaluation.verdict) {
    console.log(`- ${evaluation.verdict}`);
  }
  if (
    evaluation.expectedOutputCount != null ||
    evaluation.actualOutputCount != null
  ) {
    console.log(
      `- outputs: expected=${evaluation.expectedOutputCount ?? "n/a"} actual=${evaluation.actualOutputCount ?? "n/a"}`,
    );
  }
  if (evaluation.assetTypes?.length) {
    console.log(`- asset types: ${evaluation.assetTypes.join(", ")}`);
  }
  if (evaluation.dimensions?.length) {
    console.log(`- dimensions: ${evaluation.dimensions.join(", ")}`);
  }
  if (evaluation.aspectRatios?.length) {
    console.log(`- aspect ratios: ${evaluation.aspectRatios.join(", ")}`);
  }

  if (evaluation.strengths?.length) {
    console.log("Strengths");
    for (const strength of evaluation.strengths) {
      console.log(`- ${strength}`);
    }
  }

  if (evaluation.findings?.length) {
    console.log("Findings");
    for (const finding of evaluation.findings) {
      console.log(`- [${finding.severity}] ${finding.summary}`);
    }
  }

  if (evaluation.nextActions?.length) {
    console.log("Next Actions");
    for (const action of evaluation.nextActions) {
      console.log(`- ${action}`);
    }
  }
}

function printSemanticReview(review) {
  console.log("\nSemantic Review");

  if (!review.available) {
    console.log(`- unavailable: ${review.reason}`);
    return;
  }

  if (review.provider || review.model) {
    console.log(`- ${review.provider || "provider"} ${review.model || ""}`.trim());
  }
  if (review.score != null) {
    console.log(`- score=${review.score}`);
  }
  if (review.verdict) {
    console.log(`- ${review.verdict}`);
  }

  if (review.strengths?.length) {
    console.log("Strengths");
    for (const strength of review.strengths) {
      console.log(`- ${strength}`);
    }
  }

  if (review.findings?.length) {
    console.log("Findings");
    for (const finding of review.findings) {
      const suffix = finding.evidence ? ` | ${finding.evidence}` : "";
      console.log(`- [${finding.severity}] ${finding.summary}${suffix}`);
    }
  }

  if (review.nextActions?.length) {
    console.log("Next Actions");
    for (const action of review.nextActions) {
      console.log(`- ${action}`);
    }
  }
}

function printRevisionPlan(plan) {
  console.log("\nRevision Plan");
  if (plan.summary) {
    console.log(
      `- findings=${plan.summary.findingCount} safe-actions=${plan.summary.safeActionCount} skipped=${plan.summary.skippedCount}`,
    );
  }

  if (plan.actions?.length) {
    console.log("Actions");
    for (const action of plan.actions) {
      console.log(
        `- ${action.nodeName}: ${action.reason} -> ${action.current} => ${action.value.slice(0, 140)}${action.value.length > 140 ? "..." : ""}`,
      );
    }
  }

  if (plan.skipped?.length) {
    console.log("Skipped");
    for (const skipped of plan.skipped) {
      console.log(`- ${skipped.kind}: ${skipped.reason}`);
    }
  }
}

function printRevisionOutcome(actions) {
  console.log("\nApplied Revisions");
  for (const action of actions) {
    console.log(`- ${action.nodeName}: ${action.reason}`);
  }
}

function printImprovementComparison(comparison) {
  console.log("\nComparison");
  if (comparison.iterationCount != null) {
    console.log(`- iterations=${comparison.iterationCount}`);
  }
  console.log(`- revisions=${comparison.revisionCount}`);
  if (comparison.baseline) {
    console.log(
      `- baseline: semantic=${comparison.baseline.semanticScore ?? "n/a"} structural=${comparison.baseline.structuralScore ?? "n/a"}`,
    );
  }
  if (comparison.improved) {
    console.log(
      `- improved: semantic=${comparison.improved.semanticScore ?? "n/a"} structural=${comparison.improved.structuralScore ?? "n/a"}`,
    );
  }
  if (comparison.scoreDelta != null) {
    console.log(`- semantic delta=${comparison.scoreDelta}`);
  }
  if (comparison.structuralDelta != null) {
    console.log(`- structural delta=${comparison.structuralDelta}`);
  }
}

function printImprovementIterations(iterations) {
  console.log("\nIterations");
  for (const iteration of iterations) {
    const semanticDelta = iteration.comparison?.scoreDelta;
    const structuralDelta = iteration.comparison?.structuralDelta;
    console.log(
      `- #${iteration.iteration}: revisions=${iteration.appliedRevisionActions?.length || 0} semantic-delta=${semanticDelta ?? "n/a"} structural-delta=${structuralDelta ?? "n/a"}`,
    );
  }
}

function printRepairPlan(plan) {
  console.log("\nRepair Plan");
  console.log(
    `- blocked nodes=${plan.summary.blockedNodeCount} auto=${plan.summary.autoApplicableCount} review=${plan.summary.reviewCount}`,
  );

  for (const entry of plan.blockedNodes || []) {
    console.log(`- ${entry.nodeName || entry.name} [${entry.model || entry.type}]`);

    if (entry.connectedInputs?.length) {
      console.log(`  inputs: ${entry.connectedInputs.join(", ")}`);
    }

    if (entry.recommendedAction) {
      if (entry.recommendedAction.type === "bypass-node") {
        console.log("  action: bypass blocked node");
      } else if (entry.recommendedAction.candidate) {
        console.log(
          `  action: replace with ${entry.recommendedAction.candidate.name} (${entry.recommendedAction.candidate.type})`,
        );
      }
    }
  }
}

function printRepairOutcome(payload) {
  console.log("\nRepairs");

  if (payload.appliedActions?.length) {
    for (const action of payload.appliedActions) {
      if (action.type === "bypass-node") {
        console.log(`- bypassed ${action.nodeName}`);
      } else if (action.type === "replace-node") {
        console.log(
          `- replaced ${action.nodeName} with ${action.candidate?.name || action.candidate?.type}`,
        );
      }
    }
  }

  if (payload.skippedActions?.length) {
    for (const action of payload.skippedActions) {
      console.log(`- skipped ${action.nodeName || action.nodeId}: ${action.reason}`);
    }
  }
}

function printRepairAttempts(attempts) {
  console.log("\nRepair Attempts");

  for (const attempt of attempts) {
    const applied =
      (attempt.repair?.appliedActions?.length || 0) +
      (attempt.repair?.actions?.length || 0);
    console.log(
      `- iteration ${attempt.iteration}: blocked=${(attempt.blockedModels || []).join(", ") || "runtime"} applied=${applied} stage=${attempt.repair?.stage || "none"}`,
    );
  }
}

module.exports = {
  render,
};
