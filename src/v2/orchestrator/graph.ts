// @ts-nocheck
import { END, START, StateGraph } from "@langchain/langgraph";

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

  const builder: any = new StateGraph({
    state: OrchestratorStateSchema,
    input: OrchestratorInputSchema,
    output: OrchestratorStateSchema,
  });

  builder.addNode("receive_request", (state) => receiveRequestNode(state, runtime));
  builder.addNode("load_session", (state) => loadSessionNode(state, runtime));
  builder.addNode("load_registry", (state) => loadRegistryNode(state, runtime));
  builder.addNode("interpret_request", (state) => interpretRequestNode(state, runtime));
  builder.addNode("retrieve_context", (state) => retrieveContextNode(state, runtime));
  builder.addNode("plan_graph", (state) => planGraphNode(state, runtime));
  builder.addNode("draft_graph", (state) => draftGraphNode(state, runtime));
  builder.addNode("validate_graph", (state) => validateGraphNode(state, runtime));
  builder.addNode("decide_repair", (state) => decideRepairNode(state, runtime));
  builder.addNode("apply_tool_step", (state) => applyToolStepNode(state, runtime));
  builder.addNode("revalidate_graph", (state) => revalidateGraphNode(state, runtime));
  builder.addNode("review_graph", (state) => reviewGraphNode(state, runtime));
  builder.addNode("decide_finalize", (state) => decideFinalizeNode(state, runtime));
  builder.addNode("finalize_result", (state) => finalizeResultNode(state, runtime));
  builder.addNode("complete", (state) => completeNode(state, runtime));
  builder.addNode("fail", (state) => failNode(state, runtime));

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
    checkpointer: checkpointSaver,
    name: "weave-v2-agent-orchestrator",
    description:
      "Registry-backed LangGraph orchestrator for drafting, validating, repairing, and finalizing GraphIR workflows.",
  });

  return {
    graph,
    checkpointSaver,
  };
}

function routeAfterValidateGraph(state: OrchestratorState): "review_graph" | "decide_repair" {
  return state.validationResult?.ok ? "review_graph" : "decide_repair";
}

function routeAfterDecideRepair(
  state: OrchestratorState,
): "apply_tool_step" | "plan_graph" | "fail" {
  if (state.status === "repair_local") {
    return "apply_tool_step";
  }

  if (state.status === "repair_replan") {
    return "plan_graph";
  }

  return "fail";
}

function routeAfterRevalidateGraph(
  state: OrchestratorState,
): "review_graph" | "decide_repair" | "plan_graph" | "fail" {
  if (state.validationResult?.ok) {
    return "review_graph";
  }

  if (state.revisionCount >= state.maxRevisionCount) {
    return "fail";
  }

  if (hasNoProgressAfterTwoCycles(state.graphHistory)) {
    return "plan_graph";
  }

  return "decide_repair";
}

function routeAfterDecideFinalize(
  state: OrchestratorState,
): "finalize_result" | "apply_tool_step" | "plan_graph" | "fail" {
  if (state.status === "finalize" || state.status === "complete") {
    return "finalize_result";
  }

  if (state.status === "revise") {
    return "apply_tool_step";
  }

  if (state.status === "replan") {
    return "plan_graph";
  }

  return "fail";
}
