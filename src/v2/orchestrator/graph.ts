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

  builder.addNode("receive_request", async (annotatedState) => ({
    data: await receiveRequestNode(annotatedState.data, runtime),
  }));
  builder.addNode("load_session", async (annotatedState) => ({
    data: await loadSessionNode(annotatedState.data, runtime),
  }));
  builder.addNode("load_registry", async (annotatedState) => ({
    data: await loadRegistryNode(annotatedState.data, runtime),
  }));
  builder.addNode("interpret_request", async (annotatedState) => ({
    data: await interpretRequestNode(annotatedState.data, runtime),
  }));
  builder.addNode("retrieve_context", async (annotatedState) => ({
    data: await retrieveContextNode(annotatedState.data, runtime),
  }));
  builder.addNode("plan_graph", async (annotatedState) => ({
    data: await planGraphNode(annotatedState.data, runtime),
  }));
  builder.addNode("draft_graph", async (annotatedState) => ({
    data: await draftGraphNode(annotatedState.data, runtime),
  }));
  builder.addNode("validate_graph", async (annotatedState) => ({
    data: await validateGraphNode(annotatedState.data, runtime),
  }));
  builder.addNode("decide_repair", async (annotatedState) => ({
    data: await decideRepairNode(annotatedState.data, runtime),
  }));
  builder.addNode("apply_tool_step", async (annotatedState) => ({
    data: await applyToolStepNode(annotatedState.data, runtime),
  }));
  builder.addNode("revalidate_graph", async (annotatedState) => ({
    data: await revalidateGraphNode(annotatedState.data, runtime),
  }));
  builder.addNode("review_graph", async (annotatedState) => ({
    data: await reviewGraphNode(annotatedState.data, runtime),
  }));
  builder.addNode("decide_finalize", async (annotatedState) => ({
    data: await decideFinalizeNode(annotatedState.data, runtime),
  }));
  builder.addNode("finalize_result", async (annotatedState) => ({
    data: await finalizeResultNode(annotatedState.data, runtime),
  }));
  builder.addNode("complete", async (annotatedState) => ({
    data: await completeNode(annotatedState.data, runtime),
  }));
  builder.addNode("fail", async (annotatedState) => ({
    data: await failNode(annotatedState.data, runtime),
  }));

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

function routeAfterValidateGraph(annotatedState): "review_graph" | "decide_repair" {
  const state = annotatedState.data;
  console.log("[route]", "validate_graph", {
    ok: state.validationResult?.ok ?? false,
    errors: state.validationResult?.errorCount ?? null,
    warnings: state.validationResult?.warningCount ?? null,
  });
  return state.validationResult?.ok ? "review_graph" : "decide_repair";
}

function routeAfterDecideRepair(
  annotatedState,
): "apply_tool_step" | "plan_graph" | "fail" {
  const state = annotatedState.data;
  console.log("[route]", "decide_repair", {
    status: state.status,
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
    proposedToolCalls: state.proposedToolCalls.length,
  });
  if (state.status === "repair_local") {
    return "apply_tool_step";
  }

  if (state.status === "repair_replan") {
    return "plan_graph";
  }

  return "fail";
}

function routeAfterRevalidateGraph(
  annotatedState,
): "review_graph" | "decide_repair" | "plan_graph" | "fail" {
  const state = annotatedState.data;
  console.log("[route]", "revalidate_graph", {
    ok: state.validationResult?.ok ?? false,
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
    graphHistory: state.graphHistory.length,
  });
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
  annotatedState,
): "finalize_result" | "apply_tool_step" | "plan_graph" | "fail" {
  const state = annotatedState.data;
  console.log("[route]", "decide_finalize", {
    status: state.status,
    hasReviewResult: Boolean(state.reviewResult),
    revisionCount: state.revisionCount,
    maxRevisionCount: state.maxRevisionCount,
  });
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
