const { randomUUID } = require("node:crypto");
const path = require("node:path");

const {
  Annotation,
} = require(resolveLangGraphFile("dist/graph/annotation.cjs"));
const {
  END,
  START,
} = require(resolveLangGraphFile("dist/constants.cjs"));
const {
  StateGraph,
} = require(resolveLangGraphFile("dist/graph/state.cjs"));
const { MemorySaver } = require("@langchain/langgraph-checkpoint");

const {
  WeavyLangGraphOrchestrator,
} = require("./langgraph-orchestrator");
const {
  WeavyRecipeLangGraphOrchestrator,
} = require("./langgraph-recipe-orchestrator");

const SessionGraphState = Annotation.Root({
  goal: Annotation(),
  options: Annotation(),
  goalResult: Annotation(),
  recipeResult: Annotation(),
  result: Annotation(),
  trace: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

class WeavySessionLangGraphOrchestrator {
  constructor(agent) {
    this.agent = agent;
    this.goalOrchestrator = new WeavyLangGraphOrchestrator(agent);
    this.recipeOrchestrator = new WeavyRecipeLangGraphOrchestrator(agent);
    this.checkpointer = new MemorySaver();
    this.graph = buildSessionGraph(this.goalOrchestrator, this.recipeOrchestrator).compile({
      checkpointer: this.checkpointer,
      name: "weavy-session-workflow",
      description:
        "Composes goal authoring and post-run recipe review into a single LangGraph session.",
    });
  }

  async runSession(goal, options = {}) {
    if (!goal || !goal.trim()) {
      throw new Error("A workflow goal is required.");
    }

    const threadId = String(options.threadId || `session-${randomUUID()}`);
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const finalState = await this.graph.invoke(
      {
        goal: goal.trim(),
        options: sanitizeSessionOptions(options),
        trace: ["Start composed LangGraph session."],
      },
      config,
    );
    const snapshot = await this.graph.getState(config);

    return {
      ...(finalState.result || {}),
      goalResult: finalState.goalResult || null,
      recipeResult: finalState.recipeResult || null,
      trace: finalState.trace || [],
      sessionGraph: {
        threadId,
        next: Array.isArray(snapshot.next) ? snapshot.next : [],
        checkpointId: snapshot.config?.configurable?.checkpoint_id || null,
      },
    };
  }
}

function buildSessionGraph(goalOrchestrator, recipeOrchestrator) {
  const graph = new StateGraph(SessionGraphState);

  graph.addNode("run-goal-graph", async (state) => {
    const goalResult = await goalOrchestrator.runGoal(state.goal, state.options.goal);
    return {
      goalResult,
      trace: [`GoalGraph: completed ${goalResult.stage || state.options.goal.mode} stage.`],
    };
  });

  graph.addNode("skip-post-run", async (state) => ({
    result: {
      stage: "session-completed",
      goal: state.goal,
      workflow: state.goalResult,
      postRun: null,
      postRunSkippedReason: describePostRunSkip(state.goalResult, state.options.post),
    },
    trace: [
      `Finish: ${describePostRunSkip(state.goalResult, state.options.post)}`,
    ],
  }));

  graph.addNode("run-recipe-graph", async (state) => {
    const reviewTarget = deriveReviewTarget(state.goalResult);
    const recipeResult = await recipeOrchestrator.runRecipe(reviewTarget.recipeId, {
      ...state.options.post,
      runIds: reviewTarget.runIds,
    });

    return {
      recipeResult,
      trace: [
        `RecipeGraph: completed ${recipeResult.stage || state.options.post.mode} for ${reviewTarget.recipeId}.`,
      ],
    };
  });

  graph.addNode("assemble-session-result", async (state) => ({
    result: {
      stage: "session-completed",
      goal: state.goal,
      workflow: state.goalResult,
      postRun: state.recipeResult,
    },
    trace: ["Finish: combined goal workflow output with post-run recipe analysis."],
  }));

  graph.addEdge(START, "run-goal-graph");
  graph.addConditionalEdges("run-goal-graph", routeAfterGoalGraph, [
    "skip-post-run",
    "run-recipe-graph",
  ]);
  graph.addEdge("skip-post-run", END);
  graph.addEdge("run-recipe-graph", "assemble-session-result");
  graph.addEdge("assemble-session-result", END);

  return graph;
}

function routeAfterGoalGraph(state) {
  return canRunPostReview(state.goalResult, state.options.post)
    ? "run-recipe-graph"
    : "skip-post-run";
}

function canRunPostReview(goalResult, postOptions = {}) {
  if (!postOptions || !postOptions.enabled) {
    return false;
  }

  const reviewTarget = deriveReviewTarget(goalResult);
  const diagnosis = goalResult?.cycle?.diagnosis || null;
  return Boolean(
    reviewTarget.recipeId &&
      reviewTarget.runIds &&
      diagnosis &&
      diagnosis.kind === "completed",
  );
}

function deriveReviewTarget(goalResult = {}) {
  const cycle = goalResult.cycle || {};
  const executionTarget = cycle.executionTarget || {};
  const target = goalResult.target || goalResult.created || {};
  const recipeId = executionTarget.id || target.id || null;
  const runIds = Array.isArray(cycle.runIds) ? cycle.runIds.join(",") : cycle.runIds || null;

  return {
    recipeId,
    runIds,
  };
}

function describePostRunSkip(goalResult, postOptions = {}) {
  if (!postOptions || !postOptions.enabled) {
    return "no post-run review step was requested.";
  }

  const cycle = goalResult?.cycle || null;
  if (!cycle) {
    return "the goal graph did not produce a cycle result to review.";
  }

  const diagnosis = cycle.diagnosis || null;
  if (!diagnosis) {
    return "the execution result did not include a reviewable run diagnosis.";
  }

  if (diagnosis.kind === "running") {
    return "the run is still in progress, so post-run review was deferred.";
  }

  if (diagnosis.kind === "runtime-failure") {
    if (diagnosis.failureKinds?.includes("insufficient-credits")) {
      const remaining = Number.isFinite(diagnosis.remainingCredits)
        ? diagnosis.remainingCredits
        : Number.isFinite(diagnosis.userRemainingCredits)
          ? diagnosis.userRemainingCredits
          : null;
      return remaining == null
        ? "the run failed because the account does not have enough Weavy credits."
        : `the run failed because the account does not have enough Weavy credits (remaining ${remaining}).`;
    }

    return "the run did not complete successfully, so post-run review was skipped.";
  }

  return "no completed run was available for post-run review.";
}

function sanitizeSessionOptions(options = {}) {
  return {
    goal: {
      mode: options.goalMode || inferGoalMode(options),
      template: options.template || undefined,
      target: options.target || undefined,
      bootstrap: Boolean(options.bootstrap),
      scope: options.scope || "PERSONAL",
      folderId: options.folderId || undefined,
      cheap: Boolean(options.cheap),
      overrides: options.overrides || {},
      numberOfRuns: toInteger(options.numberOfRuns, 1),
      execute: Boolean(options.execute),
      wait: options.wait === undefined ? false : Boolean(options.wait),
      intervalMs: toInteger(options.intervalMs, 1000),
      timeoutMs: toInteger(options.timeoutMs, 30000),
      repair: Boolean(options.repair),
      maxRepairIterations: toInteger(options.maxRepairIterations, 3),
      executionSandbox:
        options.executionSandbox === undefined
          ? undefined
          : Boolean(options.executionSandbox),
    },
    post: {
      enabled: Boolean(options.postMode),
      mode: options.postMode || "review",
      threadId: options.postThreadId || undefined,
      apply: Boolean(options.apply),
      execute: Boolean(options.postExecute),
      target: options.postTarget || undefined,
      overrides: options.overrides || {},
      numberOfRuns: toInteger(options.numberOfRuns, 1),
      maxIterations: toInteger(options.maxIterations, 1),
      targetSemanticScore: toInteger(options.targetSemanticScore, 92),
      wait: options.wait === undefined ? true : Boolean(options.wait),
      intervalMs: toInteger(options.intervalMs, 1000),
      timeoutMs: toInteger(options.timeoutMs, 30000),
      repair: Boolean(options.repair),
      maxRepairIterations: toInteger(options.maxRepairIterations, 3),
    },
  };
}

function inferGoalMode(options = {}) {
  if (options.execute) {
    return "cycle";
  }

  if (options.target) {
    return "materialize";
  }

  if (options.bootstrap) {
    return "bootstrap";
  }

  return "draft";
}

function toInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveLangGraphFile(relativePath) {
  const packageJsonPath = require.resolve("@langchain/langgraph/package.json");
  return path.join(path.dirname(packageJsonPath), relativePath);
}

module.exports = {
  WeavySessionLangGraphOrchestrator,
};
