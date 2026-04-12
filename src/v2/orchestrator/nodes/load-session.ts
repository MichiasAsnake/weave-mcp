// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, loadPersistedState, persistState } from "./shared.ts";

export async function loadSessionNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "load_session");
  const persisted = await loadPersistedState(runtime, state.sessionId);
  const mergedState = persisted
    ? {
        ...persisted,
        requestId: state.requestId,
        turnId: state.turnId,
        userRequest: state.userRequest,
        messages: state.messages,
      }
    : state;

  const nextState = OrchestratorStateSchema.parse({
    ...mergedState,
    baseGraph: mergedState.baseGraph || mergedState.currentGraph,
    workingGraph: mergedState.workingGraph || mergedState.baseGraph || mergedState.currentGraph,
    status: "load_registry",
    messages: appendMessage(
      mergedState,
      {
        nodeName: "load_session",
        role: "system",
        content: persisted
          ? `Loaded persisted session state for ${state.sessionId}.`
          : `No persisted session state found for ${state.sessionId}; starting fresh.`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      mergedState,
      {
        nodeName: "load_session",
        note: persisted ? "Loaded persisted state and graph revision history." : "Started a new session state.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
