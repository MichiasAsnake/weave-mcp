// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import {
  appendCheckpoint,
  appendMessage,
  persistGraphRevisionEntry,
  persistState,
  pushGraphHistoryEntry,
  validateCurrentGraph,
} from "./shared.ts";

export async function revalidateGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "revalidate_graph");
  const validationResult = validateCurrentGraph(state);
  if (!state.workingGraph) {
    throw new Error("revalidate_graph requires a working graph.");
  }

  const historyUpdate = pushGraphHistoryEntry(state, runtime, {
    graph: state.workingGraph,
    validationResult,
    note: "Post-repair validation pass.",
  });

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    validationResult,
    graphHistory: historyUpdate.graphHistory,
    graphRevisionIndex: historyUpdate.graphRevisionIndex,
    revisionCount: validationResult.ok ? state.revisionCount : state.revisionCount + 1,
    status: validationResult.ok ? "review_graph" : "decide_repair",
    messages: appendMessage(
      state,
      {
        nodeName: "revalidate_graph",
        role: "system",
        content: validationResult.ok
          ? "Repair step produced a structurally valid graph."
          : `Repair step still leaves ${validationResult.errorCount} validation error(s).`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "revalidate_graph",
        note: "Revalidation result captured after atomic tool execution.",
      },
      runtime,
    ),
  });

  await persistGraphRevisionEntry(runtime, nextState, historyUpdate.entry);
  await persistState(runtime, nextState);
  return nextState;
}
