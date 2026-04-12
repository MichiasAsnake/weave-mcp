import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendMessage, persistState, runFinalizeRevisionModel } from "./shared.ts";

export async function decideFinalizeNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  if (!state.reviewResult) {
    const failedState = OrchestratorStateSchema.parse({
      ...state,
      status: "failed",
      failureReason: {
        code: "orchestrator.review_missing",
        message: "Cannot decide finalization without a review result.",
        nodeName: "decide_finalize",
      },
    });
    await persistState(runtime, failedState);
    return failedState;
  }

  if (state.reviewResult.satisfiesRequest && state.reviewResult.recommendedAction === "finalize") {
    const finalized = OrchestratorStateSchema.parse({
      ...state,
      status: "finalize",
      messages: appendMessage(
        state,
        {
          nodeName: "decide_finalize",
          role: "system",
          content: "Graph is structurally valid and semantically complete; finalizing.",
        },
        runtime,
      ),
    });
    await persistState(runtime, finalized);
    return finalized;
  }

  if (state.revisionCount >= state.maxRevisionCount) {
    const failedState = OrchestratorStateSchema.parse({
      ...state,
      status: "failed",
      failureReason: {
        code: "orchestrator.semantic_retry_budget_exhausted",
        message: `Semantic revision loop exhausted ${state.maxRevisionCount} attempt(s).`,
        nodeName: "decide_finalize",
      },
    });
    await persistState(runtime, failedState);
    return failedState;
  }

  if (state.reviewResult.recommendedAction === "replan") {
    const replanned = OrchestratorStateSchema.parse({
      ...state,
      proposedToolCalls: [],
      status: "replan",
      messages: appendMessage(
        state,
        {
          nodeName: "decide_finalize",
          role: "system",
          content: "Semantic review requested replanning rather than local revision.",
        },
        runtime,
      ),
    });
    await persistState(runtime, replanned);
    return replanned;
  }

  if (!state.registrySnapshot) {
    throw new Error("decide_finalize requires registrySnapshot to be loaded.");
  }

  const revisionDraft = await runFinalizeRevisionModel(state, state.registrySnapshot, runtime);
  const nextState = OrchestratorStateSchema.parse({
    ...state,
    proposedToolCalls: revisionDraft.proposedToolCalls,
    status: "revise",
    messages: appendMessage(
      state,
      {
        nodeName: "decide_finalize",
        role: "assistant",
        content: `Planned ${revisionDraft.proposedToolCalls.length} semantic revision tool call(s).`,
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
