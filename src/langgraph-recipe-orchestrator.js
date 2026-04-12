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

const RecipeGraphState = Annotation.Root({
  recipeId: Annotation(),
  runIds: Annotation(),
  mode: Annotation(),
  options: Annotation(),
  review: Annotation(),
  result: Annotation(),
  trace: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

const RECIPE_GRAPH_MODES = new Set(["review", "revise", "improve"]);

class WeavyRecipeLangGraphOrchestrator {
  constructor(agent) {
    this.agent = agent;
    this.checkpointer = new MemorySaver();
    this.graph = buildRecipeGraph(agent).compile({
      checkpointer: this.checkpointer,
      name: "weavy-recipe-workflow",
      description:
        "Routes recipe review, revision, and iterative improvement through explicit LangGraph state.",
    });
  }

  async runRecipe(recipeId, options = {}) {
    if (!recipeId) {
      throw new Error("A recipe ID is required.");
    }
    if (!options.runIds) {
      throw new Error("At least one run ID is required.");
    }

    const mode = normalizeRecipeGraphMode(options);
    const threadId = String(options.threadId || `recipe-${randomUUID()}`);
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const finalState = await this.graph.invoke(
      {
        recipeId,
        runIds: String(options.runIds),
        mode,
        options: sanitizeRecipeGraphOptions(options),
        trace: [`Start LangGraph recipe orchestration in ${mode} mode.`],
      },
      config,
    );
    const snapshot = await this.graph.getState(config);
    const finalResult = finalState.result || finalState.review || {};

    return {
      ...finalResult,
      recipeGraph: {
        threadId,
        mode,
        next: Array.isArray(snapshot.next) ? snapshot.next : [],
        checkpointId: snapshot.config?.configurable?.checkpoint_id || null,
      },
      review: finalState.review || null,
      trace: finalState.trace || [],
    };
  }
}

function buildRecipeGraph(agent) {
  const graph = new StateGraph(RecipeGraphState);

  graph.addNode("collect-review", async (state) => {
    const review = await agent.review(state.recipeId, {
      runIds: state.runIds,
    });

    return {
      review,
      trace: [
        `Review: collected structural and semantic findings for ${state.recipeId}.`,
      ],
    };
  });

  graph.addNode("use-review-result", async (state) => ({
    result: state.review,
    trace: ["Finish: return review findings without mutating the recipe."],
  }));

  graph.addNode("run-revise", async (state) => {
    const result = await agent.revise(state.recipeId, {
      runIds: state.runIds,
      apply: state.options.apply,
    });

    return {
      result,
      trace: [
        state.options.apply
          ? "Revise: applied safe revision actions to the source recipe."
          : "Revise: produced a revision plan without applying it.",
      ],
    };
  });

  graph.addNode("run-improve", async (state) => {
    const result = await agent.improve(state.recipeId, {
      runIds: state.runIds,
      target: state.options.target,
      execute: state.options.execute,
      overrides: state.options.overrides,
      numberOfRuns: state.options.numberOfRuns,
      maxIterations: state.options.maxIterations,
      targetSemanticScore: state.options.targetSemanticScore,
      wait: state.options.wait,
      intervalMs: state.options.intervalMs,
      timeoutMs: state.options.timeoutMs,
      repair: state.options.repair,
      maxRepairIterations: state.options.maxRepairIterations,
    });

    return {
      result,
      trace: [
        state.options.execute
          ? "Improve: duplicated or reused a sandbox recipe and executed the improvement loop."
          : "Improve: prepared the next improvement step without running the sandbox recipe.",
      ],
    };
  });

  graph.addEdge(START, "collect-review");
  graph.addConditionalEdges("collect-review", routeAfterReview, [
    "use-review-result",
    "run-revise",
    "run-improve",
  ]);
  graph.addEdge("use-review-result", END);
  graph.addEdge("run-revise", END);
  graph.addEdge("run-improve", END);

  return graph;
}

function routeAfterReview(state) {
  switch (state.mode) {
    case "revise":
      return "run-revise";
    case "improve":
      return "run-improve";
    case "review":
    default:
      return "use-review-result";
  }
}

function normalizeRecipeGraphMode(options = {}) {
  const explicitMode = String(options.mode || "").trim().toLowerCase();
  if (RECIPE_GRAPH_MODES.has(explicitMode)) {
    return explicitMode;
  }

  if (options.execute || options.target || options.iterations != null) {
    return "improve";
  }

  if (options.apply) {
    return "revise";
  }

  return "review";
}

function sanitizeRecipeGraphOptions(options = {}) {
  return {
    apply: Boolean(options.apply),
    execute: Boolean(options.execute),
    target: options.target || undefined,
    overrides: options.overrides || {},
    numberOfRuns: toInteger(options.numberOfRuns, 1),
    maxIterations: toInteger(options.maxIterations, 1),
    targetSemanticScore: toInteger(options.targetSemanticScore, 92),
    wait: options.wait === undefined ? true : Boolean(options.wait),
    intervalMs: toInteger(options.intervalMs, 1000),
    timeoutMs: toInteger(options.timeoutMs, 30000),
    repair: Boolean(options.repair),
    maxRepairIterations: toInteger(options.maxRepairIterations, 3),
  };
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
  WeavyRecipeLangGraphOrchestrator,
  normalizeRecipeGraphMode,
};
