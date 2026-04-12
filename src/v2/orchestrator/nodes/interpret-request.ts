// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, persistState, runIntentModel } from "./shared.ts";

export async function interpretRequestNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "interpret_request");
  const interpretedIntent = await runIntentModel(state, runtime);
  const normalizedSelectedTemplateId = interpretedIntent.targetTemplateId ?? undefined;

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    interpretedIntent,
    requestMode: interpretedIntent.requestMode,
    selectedTemplateId: normalizedSelectedTemplateId,
    status: "retrieve_context",
    messages: appendMessage(
      state,
      {
        nodeName: "interpret_request",
        role: "assistant",
        content: `Interpreted the request as ${interpretedIntent.requestMode} with template strategy ${interpretedIntent.templateStrategy}.`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "interpret_request",
        note: "Structured intent extraction completed.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
