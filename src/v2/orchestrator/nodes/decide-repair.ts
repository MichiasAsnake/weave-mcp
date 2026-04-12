import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendMessage, persistState, runRepairModel } from "./shared.ts";

export async function decideRepairNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  if (!state.validationResult || state.validationResult.ok) {
    return OrchestratorStateSchema.parse({
      ...state,
      status: "review_graph",
    });
  }

  if (state.revisionCount >= state.maxRevisionCount) {
    const nextState = OrchestratorStateSchema.parse({
      ...state,
      status: "failed",
      failureReason: {
        code: "orchestrator.retry_budget_exhausted",
        message: `Repair loop exhausted ${state.maxRevisionCount} revision attempt(s).`,
        nodeName: "decide_repair",
      },
      messages: appendMessage(
        state,
        {
          nodeName: "decide_repair",
          role: "system",
          content: "Retry budget exhausted before another repair attempt could begin.",
        },
        runtime,
      ),
    });

    await persistState(runtime, nextState);
    return nextState;
  }

  if (!state.registrySnapshot) {
    throw new Error("decide_repair requires registrySnapshot to be loaded.");
  }

  const repairDecision = await runRepairModel(state, state.registrySnapshot, runtime);
  const status =
    repairDecision.action === "repair"
      ? "repair_local"
      : repairDecision.action === "replan"
        ? "repair_replan"
        : "failed";

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    proposedToolCalls: repairDecision.proposedToolCalls,
    status,
    failureReason:
      repairDecision.action === "fail"
        ? {
            code: "orchestrator.repair_model_failed",
            message: repairDecision.rationale,
            nodeName: "decide_repair",
          }
        : undefined,
    messages: appendMessage(
      state,
      {
        nodeName: "decide_repair",
        role: "assistant",
        content: `Repair decision: ${repairDecision.action}. ${repairDecision.rationale}`,
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
