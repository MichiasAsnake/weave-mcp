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

export async function validateGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  const validationResult = validateCurrentGraph(state);
  const workingGraph = state.workingGraph;
  if (!workingGraph) {
    throw new Error("validate_graph requires a working graph.");
  }

  const historyUpdate = pushGraphHistoryEntry(state, runtime, {
    graph: workingGraph,
    validationResult,
    note: "Initial graph validation pass.",
  });

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    validationResult,
    graphHistory: historyUpdate.graphHistory,
    graphRevisionIndex: historyUpdate.graphRevisionIndex,
    status: validationResult.ok ? "review_graph" : "decide_repair",
    messages: appendMessage(
      state,
      {
        nodeName: "validate_graph",
        role: "system",
        content: validationResult.ok
          ? "Validation passed with no blocking errors."
          : `Validation found ${validationResult.errorCount} error(s) and ${validationResult.warningCount} warning(s).`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "validate_graph",
        note: "Validation result persisted before routing.",
      },
      runtime,
    ),
  });

  await persistGraphRevisionEntry(runtime, nextState, historyUpdate.entry);
  await persistState(runtime, nextState);
  return nextState;
}
