// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendMessage, createGraphIfMissing, persistState, runDraftModel } from "./shared.ts";

export async function draftGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  if (!state.registrySnapshot) {
    throw new Error("draft_graph requires registrySnapshot to be loaded.");
  }

  const workingGraph = createGraphIfMissing(state, runtime);
  const draft = await runDraftModel(
    {
      ...state,
      workingGraph,
    },
    state.registrySnapshot,
    runtime,
  );

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    workingGraph,
    proposedToolCalls: draft.proposedToolCalls,
    status: "validate_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "draft_graph",
        role: "assistant",
        content: `Drafted ${draft.proposedToolCalls.length} atomic tool call(s).`,
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
