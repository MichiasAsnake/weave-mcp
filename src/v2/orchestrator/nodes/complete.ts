// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, persistState } from "./shared.ts";

export async function completeNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  const nextState = OrchestratorStateSchema.parse({
    ...state,
    status: "complete",
    messages: appendMessage(
      state,
      {
        nodeName: "complete",
        role: "system",
        content: "Orchestrator finished successfully.",
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "complete",
        note: "Terminal success checkpoint.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
