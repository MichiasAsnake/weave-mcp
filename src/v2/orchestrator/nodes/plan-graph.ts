import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, persistState, runPlanModel } from "./shared.ts";

export async function planGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  if (!state.registrySnapshot) {
    throw new Error("plan_graph requires registrySnapshot to be loaded.");
  }

  const plan = await runPlanModel(state, state.registrySnapshot, runtime);

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    plan,
    status: "draft_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "plan_graph",
        role: "assistant",
        content: `Planned ${plan.steps.length} graph step(s) with ${plan.appModePlan.exposureStrategy} App Mode exposure.`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "plan_graph",
        note: "Graph build plan recorded.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
