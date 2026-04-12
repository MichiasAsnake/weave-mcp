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

const GoalGraphState = Annotation.Root({
  goal: Annotation(),
  mode: Annotation(),
  options: Annotation(),
  plan: Annotation(),
  draft: Annotation(),
  result: Annotation(),
  trace: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

const GRAPH_MODES = new Set([
  "plan",
  "draft",
  "materialize",
  "bootstrap",
  "cycle",
]);

class WeavyLangGraphOrchestrator {
  constructor(agent) {
    this.agent = agent;
    this.checkpointer = new MemorySaver();
    this.graph = buildGoalGraph(agent).compile({
      checkpointer: this.checkpointer,
      name: "weavy-goal-workflow",
      description:
        "Routes goal-oriented Weavy workflow authoring through explicit plan, draft, and execution stages.",
    });
  }

  async runGoal(goal, options = {}) {
    if (!goal || !goal.trim()) {
      throw new Error("A workflow goal is required.");
    }

    const mode = normalizeGraphMode(options);
    validateModeInputs(mode, options);

    const threadId = String(options.threadId || `weavy-${randomUUID()}`);
    const config = {
      configurable: {
        thread_id: threadId,
      },
    };

    const finalState = await this.graph.invoke(
      {
        goal: goal.trim(),
        mode,
        options: sanitizeGraphOptions(options),
        trace: [`Start LangGraph orchestration in ${mode} mode.`],
      },
      config,
    );
    const snapshot = await this.graph.getState(config);
    const finalResult = finalState.result || finalState.draft || finalState.plan || {};

    return {
      ...finalResult,
      agentic: true,
      plan: finalState.plan || null,
      draft: finalState.draft || null,
      trace: finalState.trace || [],
      langgraph: {
        threadId,
        mode,
        next: Array.isArray(snapshot.next) ? snapshot.next : [],
        checkpointId: snapshot.config?.configurable?.checkpoint_id || null,
      },
    };
  }
}

function buildGoalGraph(agent) {
  const graph = new StateGraph(GoalGraphState);

  graph.addNode("run-plan", async (state) => {
    const plan = await agent.plan(state.goal, {
      template: state.options.template,
      cheap: state.options.cheap,
    });

    return {
      plan,
      trace: [
        `Plan: selected ${plan.template.alias} for ${plan.intent.label.toLowerCase()}.`,
      ],
    };
  });

  graph.addNode("run-draft", async (state) => {
    const draft = await agent.draft(state.goal, {
      template: state.options.template,
      cheap: state.options.cheap,
    });

    return {
      draft,
      trace: [
        `Draft: prepared ${draft.draftMutations.length} safe mutation(s) and ${draft.structuralToolPlan.summary.readyToolCount} ready structural tool(s).`,
      ],
    };
  });

  graph.addNode("use-plan-result", async (state) => ({
    result: state.plan,
    trace: ["Finish: return planning output without mutating a recipe."],
  }));

  graph.addNode("use-draft-result", async (state) => ({
    result: state.draft,
    trace: ["Finish: return draft output without mutating a recipe."],
  }));

  graph.addNode("run-materialize", async (state) => {
    const result = await agent.materialize(state.goal, {
      template: state.options.template,
      target: state.options.target,
      cheap: state.options.cheap,
    });

    return {
      result,
      trace: [`Materialize: saved the drafted graph into ${state.options.target}.`],
    };
  });

  graph.addNode("run-bootstrap", async (state) => {
    const result = await agent.bootstrap(state.goal, {
      template: state.options.template,
      scope: state.options.scope,
      folderId: state.options.folderId,
      cheap: state.options.cheap,
    });

    return {
      result,
      trace: ["Bootstrap: created a fresh recipe and materialized the drafted graph."],
    };
  });

  graph.addNode("run-cycle", async (state) => {
    const result = await agent.cycle(state.goal, {
      template: state.options.template,
      target: state.options.target,
      scope: state.options.scope,
      folderId: state.options.folderId,
      cheap: state.options.cheap,
      overrides: state.options.overrides,
      numberOfRuns: state.options.numberOfRuns,
      execute: state.options.execute,
      wait: state.options.wait,
      intervalMs: state.options.intervalMs,
      timeoutMs: state.options.timeoutMs,
      repair: state.options.repair,
      maxRepairIterations: state.options.maxRepairIterations,
      executionSandbox: state.options.executionSandbox,
    });

    return {
      result,
      trace: [
        state.options.execute
          ? "Cycle: materialized and executed the workflow path."
          : "Cycle: materialized and estimated the workflow path.",
      ],
    };
  });

  graph.addEdge(START, "run-plan");
  graph.addConditionalEdges("run-plan", routeAfterPlan, [
    "run-draft",
    "use-plan-result",
  ]);
  graph.addConditionalEdges("run-draft", routeAfterDraft, [
    "use-draft-result",
    "run-materialize",
    "run-bootstrap",
    "run-cycle",
  ]);
  graph.addEdge("use-plan-result", END);
  graph.addEdge("use-draft-result", END);
  graph.addEdge("run-materialize", END);
  graph.addEdge("run-bootstrap", END);
  graph.addEdge("run-cycle", END);

  return graph;
}

function routeAfterPlan(state) {
  return state.mode === "plan" ? "use-plan-result" : "run-draft";
}

function routeAfterDraft(state) {
  switch (state.mode) {
    case "materialize":
      return "run-materialize";
    case "bootstrap":
      return "run-bootstrap";
    case "cycle":
      return "run-cycle";
    case "draft":
    default:
      return "use-draft-result";
  }
}

function normalizeGraphMode(options = {}) {
  const explicitMode = String(options.mode || "").trim().toLowerCase();
  if (GRAPH_MODES.has(explicitMode)) {
    return explicitMode;
  }

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

function sanitizeGraphOptions(options = {}) {
  return {
    template: options.template || undefined,
    cheap: Boolean(options.cheap),
    target: options.target || undefined,
    scope: options.scope || undefined,
    folderId: options.folderId || undefined,
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
  };
}

function validateModeInputs(mode, options = {}) {
  if (mode === "materialize" && !options.target) {
    throw new Error("LangGraph materialize mode requires a target recipe ID.");
  }
}

function toInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  WeavyLangGraphOrchestrator,
  normalizeGraphMode,
};

function resolveLangGraphFile(relativePath) {
  const packageJsonPath = require.resolve("@langchain/langgraph/package.json");
  return path.join(path.dirname(packageJsonPath), relativePath);
}
