// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, getRemainingPlannedSteps, hasUsablePlannedSteps, persistState, runReviewModel } from "./shared.ts";

export async function reviewGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "review_graph");
  if (!state.registrySnapshot) {
    throw new Error("review_graph requires registrySnapshot to be loaded.");
  }

  const reviewResult = await runReviewModel(state, state.registrySnapshot, runtime);
  const remainingSteps = getRemainingPlannedSteps(state);
  const shouldForceRevise =
    reviewResult.recommendedAction === "replan"
    && (state.workingGraph?.nodes.length || 0) > 0
    && hasUsablePlannedSteps(state)
    && remainingSteps.length > 0;
  const normalizedReviewResult = shouldForceRevise
    ? {
        ...reviewResult,
        recommendedAction: "revise" as const,
        rationale: `${reviewResult.rationale} Deterministic override: the graph already contains nodes and the sanitized plan still has ${remainingSteps.length} remaining step(s) with valid definitionIds, so continue with local revision instead of replanning.`,
      }
    : reviewResult;

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    reviewResult: normalizedReviewResult,
    status: "decide_finalize",
    messages: appendMessage(
      state,
      {
        nodeName: "review_graph",
        role: "assistant",
        content: `Review action: ${normalizedReviewResult.recommendedAction}. ${normalizedReviewResult.rationale}`,
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
