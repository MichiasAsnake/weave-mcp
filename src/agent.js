const {
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
  inferIntent,
  inferMissingInputs,
  summarizeRunStatus,
} = require("./analysis");
const {
  buildCapabilityMutationPlan,
  buildCapabilityPlan,
} = require("./capability-planner");
const { WeavyRequestError } = require("./client");
const { listTemplates, resolveTemplate } = require("./config");
const {
  applyModelRepairPlan,
  buildModelRepairPlan,
  stabilizeRecipeForExecution,
} = require("./fallbacks");
const { buildRevisionPlan } = require("./revision-planner");
const { reviewRunSemantics } = require("./semantic-review");
const {
  applyStructuralToolPlan,
  buildStructuralSavePayload,
  planStructuralTools,
} = require("./structural-tools");

class WeavyWorkflowAgent {
  constructor(client) {
    this.client = client;
  }

  async createExecutionSandbox(recipeId, options = {}) {
    const sourceRecipe = await this.client.getRecipe(recipeId);
    const duplicated = await this.client.duplicateRecipe(recipeId);
    const sandboxName = buildExecutionSandboxName(
      sourceRecipe.name || duplicated.name || recipeId,
      options.label,
    );
    await this.client.renameRecipe(duplicated.id, sandboxName);

    return {
      sourceRecipeId: recipeId,
      sourceRecipeName: sourceRecipe.name || null,
      id: duplicated.id,
      name: sandboxName,
      url: `https://app.weavy.ai/flow/${duplicated.id}`,
    };
  }

  async inspect(recipeId) {
    const recipe = await this.client.getRecipe(recipeId);
    return analyzeRecipe(recipe);
  }

  async createBlank({ scope, folderId } = {}) {
    const recipe = await this.client.createRecipe({ scope, folderId });
    return {
      created: {
        id: recipe.id,
        name: recipe.name,
        scope: recipe.scope,
        visibility: recipe.visibility,
        url: `https://app.weavy.ai/flow/${recipe.id}`,
      },
    };
  }

  async plan(goal, { template, cheap = false } = {}) {
    if (!goal || !goal.trim()) {
      throw new Error("A workflow goal is required.");
    }

    const trace = [];
    trace.push("Observe available public templates.");
    const intent = inferIntent(goal);
    trace.push(`Infer workflow intent: ${intent.label}.`);
    if (cheap) {
      trace.push("Bias template selection toward the cheapest verified compatible base.");
    }

    const explicitTemplate = template ? resolveTemplate(template) : null;
    const templatesToInspect = explicitTemplate
      ? [explicitTemplate]
      : listTemplates().map((entry) => resolveTemplate(entry.alias));
    const templateProfiles = await Promise.all(
      templatesToInspect.map(async (candidate) => {
        const recipe = await this.client.getRecipe(candidate.id);
        return {
          template: {
            alias: candidate.alias,
            id: candidate.id,
            label: candidate.label,
            description: candidate.description,
            baselineEstimatedCost: candidate.baselineEstimatedCost || null,
            costNotes: candidate.costNotes || null,
          },
          recipeAnalysis: analyzeRecipe(recipe),
        };
      }),
    );
    trace.push(`Inspect ${templateProfiles.length} template graph(s).`);

    const capabilityPlan = buildCapabilityPlan(goal, {
      templateProfiles: templateProfiles.map((entry) => ({
        template: entry.template,
        capabilityProfile: entry.recipeAnalysis.capabilityProfile,
      })),
      explicitTemplate,
      preferCheap: cheap,
    });
    const selectedTemplate = capabilityPlan.selectedTemplate || explicitTemplate;
    trace.push(
      `Select template: ${selectedTemplate.alias}${
        selectedTemplate.baselineEstimatedCost
          ? ` (baseline ~${selectedTemplate.baselineEstimatedCost} credits)`
          : ""
      }.`,
    );

    const selectedProfile = templateProfiles.find(
      (entry) => entry.template.id === selectedTemplate.id,
    );
    const analysis = selectedProfile
      ? selectedProfile.recipeAnalysis
      : analyzeRecipe(await this.client.getRecipe(selectedTemplate.id));

    const missingInputs = inferMissingInputs(goal, analysis, {
      goalProfile: capabilityPlan.goalProfile,
      capabilityProfile: capabilityPlan.selectedCapabilityProfile,
    });
    const actions = buildActionPlan(goal, selectedTemplate, analysis, intent, {
      goalProfile: capabilityPlan.goalProfile,
      capabilityProfile: capabilityPlan.selectedCapabilityProfile,
    });
    trace.push("Draft a concrete execution plan.");

    return {
      goal,
      agentic: true,
      stage: "planning",
      trace,
      template: {
        alias: selectedTemplate.alias,
        id: selectedTemplate.id,
        label: selectedTemplate.label,
        description: selectedTemplate.description,
        baselineEstimatedCost: selectedTemplate.baselineEstimatedCost || null,
        costNotes: selectedTemplate.costNotes || null,
      },
      intent,
      capabilityPlan,
      recipeAnalysis: analysis,
      missingInputs,
      actions,
      unsupportedEndpoints: {
        duplicate: `/v1/recipes/${selectedTemplate.id}/duplicate`,
        notes:
          "These routes exist in the shipped client bundle but are undocumented and can change without notice.",
      },
    };
  }

  async draft(goal, { template, cheap = false } = {}) {
    const plan = await this.plan(goal, { template, cheap });
    const recipe = await this.client.getRecipe(plan.template.id);
    const draftMutations = buildDraftMutations(goal, recipe, plan.recipeAnalysis);
    const capabilityMutationPlan = buildCapabilityMutationPlan({
      goalProfile: plan.capabilityPlan?.goalProfile,
      capabilityProfile: plan.capabilityPlan?.selectedCapabilityProfile,
      recipeAnalysis: plan.recipeAnalysis,
    });
    const structuralToolPlan = planStructuralTools({
      recipe,
      recipeAnalysis: plan.recipeAnalysis,
      capabilityMutationPlan,
    });

    return {
      ...plan,
      stage: "draft",
      draftMutations,
      capabilityMutationPlan,
      structuralToolPlan,
      readyToAutoDuplicate: Boolean(this.client.token),
      nextExecutionStep:
        structuralToolPlan.summary.readyToolCount > 0
          ? "Apply the safe draft mutations first, then run the ready structural tools on a duplicate before spending credits."
          : capabilityMutationPlan.intents.length > 0
            ? "Apply the safe draft mutations first, then resolve the remaining structural capability intents before expecting the workflow to match the goal fully."
          : this.client.token
            ? "Duplicate the template, then apply these mutations with your own authenticated tool."
            : "Set WEAVY_BEARER_TOKEN if you want to automate duplication later.",
    };
  }

  async structure(recipeId, { goal, apply = false, cheap = false } = {}) {
    if (!recipeId) {
      throw new Error("A recipe ID is required.");
    }
    if (!goal || !goal.trim()) {
      throw new Error("A goal is required so the structural planner knows what to bridge.");
    }

    const recipe = await this.client.getRecipe(recipeId);
    const recipeAnalysis = analyzeRecipe(recipe);
    const capabilityPlan = buildCapabilityPlan(goal, {
      templateProfiles: [
        {
          template: {
            alias: recipeId,
            id: recipe.id,
            label: recipe.name,
            description: "Live recipe",
          },
          capabilityProfile: recipeAnalysis.capabilityProfile,
        },
      ],
      explicitTemplate: {
        alias: recipeId,
        id: recipe.id,
        label: recipe.name,
        description: "Live recipe",
      },
      preferCheap: cheap,
    });
    const capabilityMutationPlan = buildCapabilityMutationPlan({
      goalProfile: capabilityPlan.goalProfile,
      capabilityProfile: recipeAnalysis.capabilityProfile,
      recipeAnalysis,
    });
    const structuralToolPlan = planStructuralTools({
      recipe,
      recipeAnalysis,
      capabilityMutationPlan,
    });

    if (!apply) {
      return {
        goal,
        stage: "structure-plan",
        recipe: {
          id: recipe.id,
          name: recipe.name,
          url: `https://app.weavy.ai/flow/${recipe.id}`,
        },
        recipeAnalysis,
        capabilityPlan,
        capabilityMutationPlan,
        structuralToolPlan,
        authSource: this.client.authSource,
      };
    }

    const applied = applyStructuralToolPlan(recipe, structuralToolPlan);
    if (applied.appliedTools.length === 0) {
      return {
        goal,
        stage: "structure-skipped",
        recipe: {
          id: recipe.id,
          name: recipe.name,
          url: `https://app.weavy.ai/flow/${recipe.id}`,
        },
        recipeAnalysis,
        capabilityPlan,
        capabilityMutationPlan,
        structuralToolPlan,
        appliedStructuralTools: [],
        skippedStructuralTools: applied.skippedTools,
        authSource: this.client.authSource,
      };
    }

    const savePayload = buildStructuralSavePayload(applied.recipe, recipe);
    await this.client.saveRecipe(recipe.id, savePayload);
    const persistedRecipe = await this.client.getRecipe(recipe.id);
    const persistedAnalysis = analyzeRecipe(persistedRecipe);

    return {
      goal,
      stage: "structure-applied",
      recipe: {
        id: persistedRecipe.id,
        name: persistedRecipe.name,
        url: `https://app.weavy.ai/flow/${persistedRecipe.id}`,
      },
      recipeAnalysis: persistedAnalysis,
      capabilityPlan,
      capabilityMutationPlan,
      structuralToolPlan,
      appliedStructuralTools: applied.appliedTools,
      skippedStructuralTools: applied.skippedTools,
      authSource: this.client.authSource,
      persisted: {
        nodeCount: persistedRecipe.nodes?.length || 0,
        edgeCount: persistedRecipe.edges?.length || 0,
        updatedAt: persistedRecipe.updatedAt,
      },
    };
  }

  async materialize(goal, { template, target, cheap = false } = {}) {
    if (!target) {
      throw new Error("A target recipe ID is required.");
    }

    const draft = await this.draft(goal, { template, cheap });
    const sourceRecipe = await this.client.getRecipe(draft.template.id);
    const targetRecipe = await this.client.getRecipe(target);
    const materializedRecipe = applyDraftMutationsToRecipe(
      sourceRecipe,
      draft.draftMutations,
    );
    const structuralApplication = applyStructuralToolPlan(
      materializedRecipe,
      draft.structuralToolPlan,
    );

    const savePayload = buildSavePayload(structuralApplication.recipe, targetRecipe);
    await this.client.saveRecipe(targetRecipe.id, savePayload);

    const nextName = buildDraftName(goal);
    await this.client.renameRecipe(targetRecipe.id, nextName);
    const persistedRecipe = await this.client.getRecipe(targetRecipe.id);

    return {
      ...draft,
      stage: "materialized",
      target: {
        id: targetRecipe.id,
        previousName: targetRecipe.name,
        name: persistedRecipe.name,
        visibility: persistedRecipe.visibility,
        url: `https://app.weavy.ai/flow/${targetRecipe.id}`,
      },
      authSource: this.client.authSource,
      persisted: {
        nodeCount: persistedRecipe.nodes?.length || 0,
        edgeCount: persistedRecipe.edges?.length || 0,
        updatedAt: persistedRecipe.updatedAt,
      },
      appliedStructuralTools: structuralApplication.appliedTools,
      skippedStructuralTools: structuralApplication.skippedTools,
    };
  }

  async bootstrap(goal, { template, scope, folderId, cheap = false } = {}) {
    const createdRecipe = await this.client.createRecipe({ scope, folderId });
    const materialized = await this.materialize(goal, {
      template,
      target: createdRecipe.id,
      cheap,
    });

    return {
      ...materialized,
      stage: "bootstrapped",
      created: {
        id: createdRecipe.id,
        name: createdRecipe.name,
        scope: createdRecipe.scope,
        url: `https://app.weavy.ai/flow/${createdRecipe.id}`,
      },
    };
  }

  async planRepair(recipeId, options = {}) {
    const recipe = await this.client.getRecipe(recipeId);
    const nodeDefinitions = await this.client.getPublicNodeDefinitions();
    const modelPrices = await this.client.getModelPrices();
    const plan = buildModelRepairPlan(recipe, {
      blockedModels: options.blockedModels,
      nodeDefinitions,
      modelPrices,
    });

    return {
      stage: "repair-plan",
      recipeId,
      authSource: this.client.authSource,
      plan,
    };
  }

  async repair(recipeId, options = {}) {
    const recipe = await this.client.getRecipe(recipeId);
    const nodeDefinitions = await this.client.getPublicNodeDefinitions();
    const modelPrices = await this.client.getModelPrices();
    const plan = buildModelRepairPlan(recipe, {
      blockedModels: options.blockedModels,
      nodeDefinitions,
      modelPrices,
    });

    if (options.apply === false) {
      return {
        stage: "repair-plan",
        recipeId,
        authSource: this.client.authSource,
        plan,
      };
    }

    const repaired = applyModelRepairPlan(recipe, plan, {
      nodeDefinitions,
    });

    if (repaired.appliedActions.length === 0) {
      return {
        stage: "repair-skipped",
        recipeId,
        authSource: this.client.authSource,
        plan,
        appliedActions: [],
        skippedActions: repaired.skippedActions,
      };
    }

    const savePayload = buildSavePayload(repaired.recipe, recipe);
    await this.client.saveRecipe(recipeId, savePayload);
    const persistedRecipe = await this.client.getRecipe(recipeId);

    return {
      stage: "repair-applied",
      recipeId,
      authSource: this.client.authSource,
      plan,
      appliedActions: repaired.appliedActions,
      skippedActions: repaired.skippedActions,
      persisted: {
        nodeCount: persistedRecipe.nodes?.length || 0,
        edgeCount: persistedRecipe.edges?.length || 0,
        updatedAt: persistedRecipe.updatedAt,
      },
    };
  }

  async stabilize(recipeId, options = {}) {
    const recipe = await this.client.getRecipe(recipeId);
    const stabilized = stabilizeRecipeForExecution(recipe, options);

    if (stabilized.actions.length === 0) {
      return {
        stage: "stabilize-skipped",
        recipeId,
        authSource: this.client.authSource,
        actions: [],
      };
    }

    const savePayload = buildSavePayload(stabilized.recipe, recipe);
    await this.client.saveRecipe(recipeId, savePayload);
    const persistedRecipe = await this.client.getRecipe(recipeId);

    return {
      stage: "stabilized",
      recipeId,
      authSource: this.client.authSource,
      actions: stabilized.actions,
      persisted: {
        nodeCount: persistedRecipe.nodes?.length || 0,
        edgeCount: persistedRecipe.edges?.length || 0,
        updatedAt: persistedRecipe.updatedAt,
      },
    };
  }

  async estimateRun(recipeId, options = {}) {
    const recipe = await this.client.getRecipe(recipeId);
    const built = buildDesignAppRunPayload(recipe, {
      numberOfRuns: options.numberOfRuns,
      overrides: options.overrides,
    });

    if (built.missingInputs.length > 0) {
      return {
        stage: "cost",
        recipeId,
        canRun: false,
        missingInputs: built.missingInputs,
        payloadPreview: built.payload,
      };
    }

    const cost = await this.client.estimateRecipeCost(recipeId, built.payload);
    return {
      stage: "cost",
      recipeId,
      canRun: true,
      payloadPreview: built.payload,
      cost,
    };
  }

  async review(recipeId, options = {}) {
    const runIds = normalizeRunIds(options.runIds);
    if (runIds.length === 0) {
      throw new Error("At least one run ID is required for review.");
    }

    const collected = await this.collectReview(recipeId, runIds);
    return collected.response;
  }

  async revise(recipeId, options = {}) {
    const runIds = normalizeRunIds(options.runIds);
    if (runIds.length === 0) {
      throw new Error("At least one run ID is required for revision planning.");
    }

    const collected = await this.collectReview(recipeId, runIds);
    const { recipe, response } = collected;
    const revisionPlan = response.revisionPlan;

    if (!options.apply) {
      return {
        ...response,
        stage: "revision-plan",
      };
    }

    if (!revisionPlan || revisionPlan.actions.length === 0) {
      return {
        ...response,
        stage: "revision-skipped",
      };
    }

    const revisedRecipe = applyDraftMutationsToRecipe(recipe, revisionPlan.actions);
    const savePayload = buildSavePayload(revisedRecipe, recipe);
    await this.client.saveRecipe(recipeId, savePayload);
    const persistedRecipe = await this.client.getRecipe(recipeId);

    return {
      ...response,
      stage: "revision-applied",
      appliedRevisionActions: revisionPlan.actions,
      persisted: {
        nodeCount: persistedRecipe.nodes?.length || 0,
        edgeCount: persistedRecipe.edges?.length || 0,
        updatedAt: persistedRecipe.updatedAt,
      },
    };
  }

  async improve(recipeId, options = {}) {
    const runIds = normalizeRunIds(options.runIds);
    if (runIds.length === 0) {
      throw new Error("At least one run ID is required for improvement planning.");
    }

    const maxIterations = Math.max(
      1,
      Number.isFinite(options.maxIterations) ? options.maxIterations : 1,
    );
    const baseline = await this.collectReview(recipeId, runIds);
    const initialRevisionPlan = baseline.response.revisionPlan;
    if (!initialRevisionPlan || initialRevisionPlan.actions.length === 0) {
      return {
        ...baseline.response,
        stage: "improve-skipped",
        baselineRecipeId: recipeId,
      };
    }
    const baselineStop = shouldStopImprovement(baseline.response, [], options);
    if (baselineStop?.stop) {
      return {
        ...baseline.response,
        stage: "improve-skipped",
        baselineRecipeId: recipeId,
        stopReason: baselineStop.reason,
      };
    }

    const targetRecipe = options.target
      ? await this.client.getRecipe(options.target)
      : await this.client.duplicateRecipe(recipeId);
    const targetRecipeId = targetRecipe.id;
    const initialTarget = await this.client.getRecipe(targetRecipeId);
    await this.client.renameRecipe(
      targetRecipeId,
      buildImprovedName(initialTarget.name || baseline.recipe.name || recipeId),
    );

    let currentReview = baseline.response;
    let persistedRecipe = await this.client.getRecipe(targetRecipeId);
    const iterations = [];
    let stopReason = "";

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const stopDecision =
        iteration > 1 ? shouldStopImprovement(currentReview, iterations, options) : null;
      if (stopDecision?.stop) {
        stopReason = stopDecision.reason;
        break;
      }

      const revisionPlan = currentReview.revisionPlan;
      if (!revisionPlan || revisionPlan.actions.length === 0) {
        break;
      }

      const targetCurrent = await this.client.getRecipe(targetRecipeId);
      const revisedRecipe = applyDraftMutationsToRecipe(
        targetCurrent,
        revisionPlan.actions,
      );
      const savePayload = buildSavePayload(revisedRecipe, targetCurrent);
      await this.client.saveRecipe(targetRecipeId, savePayload);
      persistedRecipe = await this.client.getRecipe(targetRecipeId);

      const iterationResult = {
        iteration,
        basedOnRunIds: currentReview.runIds || [],
        appliedRevisionActions: revisionPlan.actions,
        persisted: {
          nodeCount: persistedRecipe.nodes?.length || 0,
          edgeCount: persistedRecipe.edges?.length || 0,
          updatedAt: persistedRecipe.updatedAt,
        },
      };

      if (!options.execute) {
        iterations.push(iterationResult);
        break;
      }

      const improvedRun = await this.run(targetRecipeId, {
        overrides: options.overrides,
        numberOfRuns: options.numberOfRuns,
        wait: options.wait !== false,
        intervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs,
        repair: Boolean(options.repair),
        maxRepairIterations: options.maxRepairIterations,
      });

      iterationResult.improved = improvedRun;
      iterationResult.comparison = buildImprovementComparison(
        currentReview,
        improvedRun,
        revisionPlan,
      );
      iterations.push(iterationResult);
      currentReview = improvedRun;
    }

    const latestIteration = iterations[iterations.length - 1] || null;
    const finalReview = latestIteration?.improved || currentReview;
    const response = {
      stage: options.execute ? "improve-completed" : "improve-prepared",
      baselineRecipeId: recipeId,
      recipeId: targetRecipeId,
      target: {
        id: targetRecipeId,
        name: persistedRecipe.name,
        url: `https://app.weavy.ai/flow/${targetRecipeId}`,
      },
      baseline: baseline.response,
      appliedRevisionActions: latestIteration?.appliedRevisionActions || [],
      iterations,
      persisted: {
        nodeCount: persistedRecipe.nodes?.length || 0,
        edgeCount: persistedRecipe.edges?.length || 0,
        updatedAt: persistedRecipe.updatedAt,
      },
      final: finalReview,
      stopReason: stopReason || null,
    };

    if (options.execute && latestIteration?.improved) {
      response.improved = latestIteration.improved;
    }

    if (iterations.length > 0) {
      response.comparison = buildImprovementSummary(
        baseline.response,
        finalReview,
        iterations,
      );
    }

    return response;
  }

  async run(recipeId, options = {}) {
    if (options.executionSandbox) {
      const executionTarget = await this.createExecutionSandbox(recipeId, {
        label: options.executionSandboxLabel,
      });
      const sandboxedRun = await this.run(executionTarget.id, {
        ...options,
        executionSandbox: false,
      });

      return {
        ...sandboxedRun,
        sourceRecipeId: recipeId,
        executionTarget,
      };
    }

    const maxRepairIterations = Math.max(
      0,
      Number.isFinite(options.maxRepairIterations)
        ? options.maxRepairIterations
        : options.repair
          ? 3
          : 0,
    );
    const repairAttempts = [];

    for (
      let repairIteration = 0;
      repairIteration <= maxRepairIterations;
      repairIteration += 1
    ) {
      const attempt = await this.runOnce(recipeId, options);

      if (
        !options.repair ||
        !["run-failed", "run-failed-runtime"].includes(attempt.stage) ||
        repairIteration === maxRepairIterations
      ) {
        if (repairAttempts.length === 0) {
          return attempt;
        }

        return {
          ...attempt,
          stage:
            attempt.stage === "run-completed"
              ? "run-repaired-completed"
              : attempt.stage === "run-started"
                ? "run-repaired-started"
                : "run-repaired",
          repairAttempts,
          repairsApplied: repairAttempts.reduce(
            (count, item) =>
              count +
              (item.repair?.appliedActions?.length || 0) +
              (item.repair?.actions?.length || 0),
            0,
          ),
        };
      }

      const repair =
        attempt.stage === "run-failed" &&
        attempt.diagnosis?.kind === "unverified-model"
          ? await this.repair(recipeId, {
              blockedModels: attempt.diagnosis.blockedModels,
            })
          : attempt.stage === "run-failed-runtime" &&
              attempt.diagnosis?.autoFixable
            ? await this.stabilize(recipeId, {
                diagnosis: attempt.diagnosis,
              })
            : null;
      repairAttempts.push({
        iteration: repairIteration + 1,
        blockedModels: attempt.diagnosis?.blockedModels || [],
        repairPlan: attempt.repairPlan || null,
        repair,
      });

      if (
        !repair ||
        !(
          (repair.stage === "repair-applied" &&
            repair.appliedActions.length > 0) ||
          (repair.stage === "stabilized" && repair.actions.length > 0)
        )
      ) {
        return {
          ...attempt,
          stage: "run-repaired",
          repairAttempts,
          repairsApplied: repairAttempts.reduce(
            (count, item) =>
              count +
              (item.repair?.appliedActions?.length || 0) +
              (item.repair?.actions?.length || 0),
            0,
          ),
        };
      }
    }

    throw new Error("Repair loop exceeded its iteration budget.");
  }

  async runOnce(recipeId, options = {}) {
    const recipe = await this.client.getRecipe(recipeId);
    const built = buildDesignAppRunPayload(recipe, {
      numberOfRuns: options.numberOfRuns,
      overrides: options.overrides,
    });

    if (built.missingInputs.length > 0) {
      return {
        stage: "run-blocked",
        recipeId,
        canRun: false,
        missingInputs: built.missingInputs,
        payloadPreview: built.payload,
      };
    }

    const estimatedCost = await this.client.estimateRecipeCost(recipeId, built.payload);

    try {
      const runResponse = await this.client.runRecipe(recipeId, built.payload);
      const runIds = runResponse.runIds || [];

      if (!options.wait) {
        return {
          stage: "run-started",
          recipeId,
          canRun: true,
          estimatedCost,
          runIds,
        };
      }

      const status = await this.waitForRuns(recipeId, runIds, {
        intervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs,
      });
      const diagnosis = diagnoseRunStatus(status.raw);
      const evaluation =
        diagnosis.kind === "completed"
          ? evaluateCompletedRun(recipe, status.raw)
          : null;
      const semanticReview =
        diagnosis.kind === "completed"
          ? await reviewRunSemantics({
              recipe,
              structuralEvaluation: evaluation,
              diagnosis,
              runIds,
            })
          : null;
      const revisionPlan =
        diagnosis.kind === "completed"
          ? buildRevisionPlan({
              recipe,
              evaluation,
              semanticReview,
            })
          : null;

      return {
        stage: !status.completed
          ? "run-wait-timeout"
          : diagnosis.kind === "runtime-failure"
            ? "run-failed-runtime"
            : "run-completed",
        recipeId,
        canRun: true,
        estimatedCost,
        runIds,
        status,
        diagnosis,
        evaluation,
        semanticReview,
        revisionPlan,
      };
    } catch (error) {
      if (error instanceof WeavyRequestError) {
        const diagnosis = classifyRunError(error);
        const failure = {
          stage: "run-failed",
          recipeId,
          canRun: false,
          estimatedCost,
          diagnosis,
          error: {
            status: error.status,
            message: error.message,
            payload: error.payload,
          },
        };

        if (diagnosis.kind === "unverified-model") {
          const repairPlan = await this.planRepair(recipeId, {
            blockedModels: diagnosis.blockedModels,
          });
          failure.repairPlan = repairPlan.plan;
        }

        return failure;
      }

      throw error;
    }
  }

  async cycle(goal, options = {}) {
    const targetRecipeId =
      options.target ||
      (
        await this.client.createRecipe({
          scope: options.scope,
          folderId: options.folderId,
        })
      ).id;

    const materialized = await this.materialize(goal, {
          template: options.template,
          target: targetRecipeId,
          cheap: Boolean(options.cheap),
        });

    const run = options.execute
      ? await this.run(targetRecipeId, {
          overrides: options.overrides,
          numberOfRuns: options.numberOfRuns,
          wait: Boolean(options.wait),
          intervalMs: options.intervalMs,
          timeoutMs: options.timeoutMs,
          repair: Boolean(options.repair),
          maxRepairIterations: options.maxRepairIterations,
          executionSandbox:
            options.executionSandbox !== undefined
              ? Boolean(options.executionSandbox)
              : Boolean(options.repair),
        })
      : await this.estimateRun(targetRecipeId, {
          overrides: options.overrides,
          numberOfRuns: options.numberOfRuns,
        });

    return {
      ...materialized,
      cycle: run,
    };
  }

  async waitForRuns(recipeId, runIds, options = {}) {
    const intervalMs = options.intervalMs || 1000;
    const timeoutMs = options.timeoutMs || 30000;
    const startedAt = Date.now();

    while (true) {
      const statusPayload = await this.client.getRunStatus(recipeId, runIds);
      const summary = summarizeRunStatus(statusPayload);
      const diagnosis = diagnoseRunStatus(statusPayload);
      const active = summary.filter((run) => run.status === "RUNNING");

      if (active.length === 0) {
        return {
          completed: true,
          summary,
          diagnosis,
          raw: statusPayload,
        };
      }

      if (Date.now() - startedAt >= timeoutMs) {
        return {
          completed: false,
          summary,
          diagnosis,
          raw: statusPayload,
        };
      }

      await sleep(intervalMs);
    }
  }

  async collectReview(recipeId, runIds) {
    const recipe = await this.client.getRecipe(recipeId);
    const statusPayload = await this.client.getRunStatus(recipeId, runIds);
    const diagnosis = diagnoseRunStatus(statusPayload);
    const evaluation =
      diagnosis.kind === "completed"
        ? evaluateCompletedRun(recipe, statusPayload)
        : null;
    const semanticReview =
      diagnosis.kind === "completed"
        ? await reviewRunSemantics({
            recipe,
            structuralEvaluation: evaluation,
            diagnosis,
            runIds,
          })
        : null;
    const revisionPlan =
      diagnosis.kind === "completed"
        ? buildRevisionPlan({
            recipe,
            evaluation,
            semanticReview,
          })
        : null;

    return {
      recipe,
      response: {
        stage:
          diagnosis.kind === "completed"
            ? "review-completed"
            : diagnosis.kind === "runtime-failure"
              ? "review-failed"
              : "review-running",
        recipeId,
        runIds,
        diagnosis,
        status: {
          completed: diagnosis.kind !== "running",
          summary: summarizeRunStatus(statusPayload),
          diagnosis,
          raw: statusPayload,
        },
        evaluation,
        semanticReview,
        revisionPlan,
      },
    };
  }
}

function buildImprovedName(name) {
  const base = String(name || "workflow")
    .replace(/\s+/g, " ")
    .replace(/^(Agent Improve -\s*)+/i, "")
    .trim();
  const clipped = base.slice(0, 42);
  return `Agent Improve - ${clipped}`;
}

function buildExecutionSandboxName(name, label) {
  const base = String(name || "workflow")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  const suffix = label
    ? `[${String(label).replace(/\s+/g, " ").trim().slice(0, 24)}]`
    : "[Execution Sandbox]";
  return `${base} ${suffix}`.trim().slice(0, 96);
}

function buildImprovementSummary(baseline, improved, iterations) {
  return {
    iterationCount: iterations.length,
    revisionCount: iterations.reduce(
      (count, item) => count + (item.appliedRevisionActions?.length || 0),
      0,
    ),
    baseline: summarizeReviewScores(baseline),
    improved: summarizeReviewScores(improved),
    scoreDelta:
      scoreValue(improved?.semanticReview?.score) -
      scoreValue(baseline?.semanticReview?.score),
    structuralDelta:
      scoreValue(improved?.evaluation?.score) - scoreValue(baseline?.evaluation?.score),
  };
}

function shouldStopImprovement(currentReview, iterations, options = {}) {
  const semanticScore = scoreValue(currentReview?.semanticReview?.score);
  const structuralScore = scoreValue(currentReview?.evaluation?.score);
  const severityLevels = collectSemanticSeverities(currentReview?.semanticReview);
  const highestSeverity = getHighestSeverity(severityLevels);
  const targetSemanticScore = Number.isFinite(options.targetSemanticScore)
    ? options.targetSemanticScore
    : 92;
  const minStructuralScore = Number.isFinite(options.minStructuralScore)
    ? options.minStructuralScore
    : 100;

  if (
    semanticScore != null &&
    semanticScore >= targetSemanticScore &&
    structuralScore != null &&
    structuralScore >= minStructuralScore &&
    highestSeverity <= severityRank("low")
  ) {
    return {
      stop: true,
      reason: `Semantic score ${semanticScore} reached the target with only low-severity findings remaining.`,
    };
  }

  const lastIteration = iterations[iterations.length - 1];
  if (!lastIteration?.comparison) {
    return null;
  }

  const lastDelta = Number(lastIteration.comparison.scoreDelta);
  if (
    Number.isFinite(lastDelta) &&
    lastDelta <= 0 &&
    semanticScore != null &&
    semanticScore >= 90 &&
    highestSeverity <= severityRank("low")
  ) {
    return {
      stop: true,
      reason: `The last round did not improve the semantic score and only low-severity issues remain.`,
    };
  }

  return null;
}

function buildImprovementComparison(baseline, improved, revisionPlan) {
  return {
    revisionCount: revisionPlan?.actions?.length || 0,
    baseline: summarizeReviewScores(baseline),
    improved: summarizeReviewScores(improved),
    scoreDelta:
      scoreValue(improved?.semanticReview?.score) -
      scoreValue(baseline?.semanticReview?.score),
    structuralDelta:
      scoreValue(improved?.evaluation?.score) - scoreValue(baseline?.evaluation?.score),
  };
}

function summarizeReviewScores(payload) {
  return {
    stage: payload?.stage || null,
    semanticScore: scoreValue(payload?.semanticReview?.score),
    semanticVerdict: payload?.semanticReview?.verdict || null,
    structuralScore: scoreValue(payload?.evaluation?.score),
    structuralVerdict: payload?.evaluation?.verdict || null,
    runIds: payload?.runIds || [],
  };
}

function scoreValue(value) {
  return Number.isFinite(value) ? value : null;
}

function collectSemanticSeverities(semanticReview) {
  return (semanticReview?.findings || [])
    .map((finding) => severityRank(finding?.severity))
    .filter((value) => value >= 0);
}

function getHighestSeverity(values) {
  if (!values.length) {
    return severityRank("low");
  }

  return Math.max(...values);
}

function severityRank(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "high") {
    return 2;
  }
  if (normalized === "medium") {
    return 1;
  }
  if (normalized === "low") {
    return 0;
  }
  return -1;
}

function normalizeRunIds(runIds) {
  if (!runIds) {
    return [];
  }

  if (Array.isArray(runIds)) {
    return runIds.flatMap((entry) => normalizeRunIds(entry));
  }

  return String(runIds)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  WeavyWorkflowAgent,
};
