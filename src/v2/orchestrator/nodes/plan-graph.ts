// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, persistState, runPlanModel } from "./shared.ts";

export async function planGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "plan_graph");
  if (!state.registrySnapshot) {
    throw new Error("plan_graph requires registrySnapshot to be loaded.");
  }

  const plan = await runPlanModel(state, state.registrySnapshot, runtime);
  const knownDefinitionIds = new Set(
    state.registrySnapshot.nodeSpecs.map((nodeSpec) => nodeSpec.source.definitionId),
  );
  const unknownDefinitionIds: Array<{ stepId: string; ids: string[] }> = [];
  const sanitizedPlan = {
    ...plan,
    steps: plan.steps.map((step) => {
      const validDefinitionIds = step.nodeDefinitionIds.filter((definitionId) =>
        knownDefinitionIds.has(definitionId)
      );
      const invalidDefinitionIds = step.nodeDefinitionIds.filter((definitionId) =>
        !knownDefinitionIds.has(definitionId)
      );

      if (invalidDefinitionIds.length > 0) {
        unknownDefinitionIds.push({ stepId: step.stepId, ids: invalidDefinitionIds });
      }

      return {
        ...step,
        nodeDefinitionIds: validDefinitionIds,
      };
    }),
  };

  const unknownDefinitionSummary = unknownDefinitionIds.length > 0
    ? ` Removed ${unknownDefinitionIds.length} step(s) with unknown definitionId(s): ${unknownDefinitionIds
        .map(({ stepId, ids }) => `${stepId}=[${ids.join(", ")}]`)
        .join("; ")}.`
    : "";

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    plan: sanitizedPlan,
    status: "draft_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "plan_graph",
        role: "assistant",
        content: `Planned ${sanitizedPlan.steps.length} graph step(s) with ${sanitizedPlan.appModePlan.exposureStrategy} App Mode exposure.${unknownDefinitionSummary}`,
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
