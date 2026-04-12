import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, persistState, runReviewModel } from "./shared.ts";

export async function reviewGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  if (!state.registrySnapshot) {
    throw new Error("review_graph requires registrySnapshot to be loaded.");
  }

  const reviewResult = await runReviewModel(state, state.registrySnapshot, runtime);

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    reviewResult,
    status: "decide_finalize",
    messages: appendMessage(
      state,
      {
        nodeName: "review_graph",
        role: "assistant",
        content: `Review action: ${reviewResult.recommendedAction}. ${reviewResult.rationale}`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "review_graph",
        note: "Semantic review completed.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
