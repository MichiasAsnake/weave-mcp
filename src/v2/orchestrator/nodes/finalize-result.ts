// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, persistState } from "./shared.ts";

export async function finalizeResultNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "finalize_result");
  if (!state.workingGraph) {
    throw new Error("finalize_result requires a working graph.");
  }

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    currentGraph: state.workingGraph,
    proposedToolCalls: [],
    status: "complete",
    messages: appendMessage(
      state,
      {
        nodeName: "finalize_result",
        role: "system",
        content: "Promoted the working graph to the current session graph and prepared the final result.",
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "finalize_result",
        note: "Final graph result persisted before completion.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
