// @ts-nocheck
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import { runV2OrchestratorMigrations } from "../db/migrations.ts";
import { getSharedPostgresPool } from "../db/connection.ts";
import { PostgresCheckpointSaver } from "../db/postgres-saver.ts";
import {
  OrchestratorInputSchema,
  OrchestratorStateSchema,
  type OrchestratorGraphBundle,
  type OrchestratorRuntime,
  type OrchestratorState,
} from "./types.ts";
import { applyToolStepNode } from "./nodes/apply-tool-step.ts";
import { completeNode } from "./nodes/complete.ts";
import { decideFinalizeNode } from "./nodes/decide-finalize.ts";
import { decideRepairNode } from "./nodes/decide-repair.ts";
import { draftGraphNode } from "./nodes/draft-graph.ts";
import { failNode } from "./nodes/fail.ts";
import { finalizeResultNode } from "./nodes/finalize-result.ts";
import { interpretRequestNode } from "./nodes/interpret-request.ts";
import { loadRegistryNode } from "./nodes/load-registry.ts";
import { loadSessionNode } from "./nodes/load-session.ts";
import { planGraphNode } from "./nodes/plan-graph.ts";
import { receiveRequestNode } from "./nodes/receive-request.ts";
import { retrieveContextNode } from "./nodes/retrieve-context.ts";
import { revalidateGraphNode } from "./nodes/revalidate-graph.ts";
import { reviewGraphNode } from "./nodes/review-graph.ts";
import { validateGraphNode } from "./nodes/validate-graph.ts";
import { hasNoProgressAfterTwoCycles } from "./nodes/shared.ts";

const OrchestratorAnnotation = Annotation.Root({
  data: Annotation<OrchestratorState>({
    reducer: (_prev, next) => next,
    default: () => ({}) as OrchestratorState,
  }),
});

export async function createOrchestratorGraph(
  runtimeOverrides: Partial<OrchestratorRuntime> & Pick<OrchestratorRuntime, "model">,
): Promise<OrchestratorGraphBundle> {
  const pool = runtimeOverrides.pool || getSharedPostgresPool();
  await runV2OrchestratorMigrations(pool);

  const checkpointSaver =
    runtimeOverrides.checkpointSaver || new PostgresCheckpointSaver(pool);

  const runtime: OrchestratorRuntime = {
    ...runtimeOverrides,
    pool,
    checkpointSaver,
  };

  const builder: any = new StateGraph(OrchestratorAnnotation);

  const addTracedNode = (
    name: string,
    fn: (state: OrchestratorState, runtime: OrchestratorRuntime) => Promise<OrchestratorState>,
  ) => {
    builder.addNode(name, async (annotatedState) => {
      const startedAt = Date.now();
      runtime.breadcrumbs?.push(`[${startedAt}] enter ${name}`);
      try {
        const data = await fn(annotatedState.data, runtime);
        runtime.breadcrumbs?.push(`[${Date.now()}] exit ${name} (+${Date.now() - startedAt}ms)`);
        return { data };
      } catch (error) {
        runtime.breadcrumbs?.push(
          `[${Date.now()}] throw ${name} (+${Date.now() - startedAt}ms): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        throw error;
      }
    });
  };

  addTracedNode("receive_request", receiveRequestNode);
  addTracedNode("load_session", loadSessionNode);
  addTracedNode("load_registry", loadRegistryNode);
  addTracedNode("interpret_request", interpretRequestNode);
  addTracedNode("retrieve_context", retrieveContextNode);
  addTracedNode("plan_graph", planGraphNode);
  addTracedNode("draft_graph", draftGraphNode);
  addTracedNode("validate_graph", validateGraphNode);
  addTracedNode("decide_repair", decideRepairNode);
  addTracedNode("apply_tool_step", applyToolStepNode);
  addTracedNode("revalidate_graph", revalidateGraphNode);
  addTracedNode("review_graph", reviewGraphNode);
  addTracedNode("decide_finalize", decideFinalizeNode);
  addTracedNode("finalize_result", finalizeResultNode);
  addTracedNode("complete", completeNode);
  addTracedNode("fail", failNode);

  builder.addEdge(START, "receive_request");
  builder.addEdge("receive_request", "load_session");
  builder.addEdge("load_session", "load_registry");
  builder.addEdge("load_registry", "interpret_request");
  builder.addEdge("interpret_request", "retrieve_context");
  builder.addEdge("retrieve_context", "plan_graph");
  builder.addEdge("plan_graph", "draft_graph");
  builder.addEdge("draft_graph", "validate_graph");
  builder.addConditionalEdges("validate_graph", routeAfterValidateGraph, [
    "review_graph",
    "decide_repair",
  ]);
  builder.addConditionalEdges("decide_repair", routeAfterDecideRepair, [
    "apply_tool_step",
    "plan_graph",
    "fail",
  ]);
  builder.addEdge("apply_tool_step", "revalidate_graph");
  builder.addConditionalEdges("revalidate_graph", routeAfterRevalidateGraph, [
    "review_graph",
    "decide_repair",
    "plan_graph",
    "fail",
  ]);
  builder.addEdge("review_graph", "decide_finalize");
  builder.addConditionalEdges("decide_finalize", routeAfterDecideFinalize, [
    "finalize_result",
    "apply_tool_step",
    "plan_graph",
    "fail",
  ]);
  builder.addEdge("finalize_result", "complete");
  builder.addEdge("complete", END);
  builder.addEdge("fail", END);

  const graph = builder.compile({
    // Temporarily disable LangGraph checkpoint persistence while debugging
    // the core orchestrator flow. Session state still persists via v2_agent_sessions.
    // checkpointer: checkpointSaver,
    name: "weave-v2-agent-orchestrator",
    description:
      "Registry-backed LangGraph orchestrator for drafting, validating, repairing, and finalizing GraphIR workflows.",
  });

  return {
    graph,
    checkpointSaver,
  };
}

function routeAfterValidateGraph(annotatedState): "review_graph" | "decide_repair" {
  const state = annotatedState.data;
  const decision = state.validationResult?.ok ? "review_graph" : "decide_repair";
  console.log("[route]", "validate_graph ->", decision, {
    ok: state.validationResult?.ok ?? false,
    errors: state.validationResult?.errorCount ?? null,
    warnings: state.validationResult?.warningCount ?? null,
  });
  return decision;
}

function routeAfterDecideRepair(
  annotatedState,
): "apply_tool_step" | "plan_graph" | "fail" {
  const state = annotatedState.data;
  let decision: "apply_tool_step" | "plan_graph" | "fail";
  if (state.status === "repair_local") {
    decision = "apply_tool_step";
  } else if (state.status === "repair_replan") {
    decision = "plan_graph";
  } else {
    decision = "fail";
  }
  console.log("[route]", "decide_repair ->", decision, {
    status: state.status,
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
    proposedToolCalls: state.proposedToolCalls.length,
  });
  return decision;
}

function routeAfterRevalidateGraph(
  annotatedState,
): "review_graph" | "decide_repair" | "plan_graph" | "fail" {
  const state = annotatedState.data;
  let decision: "review_graph" | "decide_repair" | "plan_graph" | "fail";
  if (state.validationResult?.ok) {
    decision = "review_graph";
  } else if (state.revisionCount >= state.maxRevisionCount) {
    decision = "fail";
  } else if (hasNoProgressAfterTwoCycles(state.graphHistory)) {
    decision = "plan_graph";
  } else {
    decision = "decide_repair";
  }
  console.log("[route]", "revalidate_graph ->", decision, {
    ok: state.validationResult?.ok ?? false,
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
    graphHistory: state.graphHistory.length,
  });
  return decision;
}

function routeAfterDecideFinalize(
  annotatedState,
): "finalize_result" | "apply_tool_step" | "plan_graph" | "fail" {
  const state = annotatedState.data;
  let decision: "finalize_result" | "apply_tool_step" | "plan_graph" | "fail";
  if (state.status === "finalize" || state.status === "complete") {
    decision = "finalize_result";
  } else if (state.status === "revise") {
    decision = "apply_tool_step";
  } else if (state.status === "replan") {
    decision = "plan_graph";
  } else {
    decision = "fail";
  }
  console.log("[route]", "decide_finalize ->", decision, {
    status: state.status,
    hasReviewResult: Boolean(state.reviewResult),
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
  });
  return decision;
}
