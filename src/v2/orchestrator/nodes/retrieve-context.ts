import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import {
  appendMessage,
  buildContextArtifacts,
  getTemplateCandidates,
  persistState,
} from "./shared.ts";

export async function retrieveContextNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  const templateCandidates = await getTemplateCandidates(runtime, state);
  const selectedTemplateId =
    state.selectedTemplateId ||
    (state.interpretedIntent?.templateStrategy === "reuse" && templateCandidates[0]
      ? templateCandidates[0].templateId
      : undefined);

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    templateCandidates,
    selectedTemplateId,
    contextArtifacts: buildContextArtifacts({
      ...state,
      selectedTemplateId,
    }),
    status: "plan_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "retrieve_context",
        role: "system",
        content: `Retrieved ${templateCandidates.length} template candidate(s) and assembled deterministic context artifacts.`,
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
