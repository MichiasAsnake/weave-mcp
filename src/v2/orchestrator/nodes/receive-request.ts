import {
  OrchestratorInputSchema,
  OrchestratorStateSchema,
  createEmptyOrchestratorState,
  type OrchestratorInput,
  type OrchestratorRuntime,
  type OrchestratorState,
} from "../types.ts";
import { appendMessage, persistState } from "./shared.ts";

export async function receiveRequestNode(
  rawState: OrchestratorInput | OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  const parsedInput = OrchestratorInputSchema.safeParse(rawState);
  const baseState = parsedInput.success
    ? createEmptyOrchestratorState(parsedInput.data)
    : OrchestratorStateSchema.parse(rawState);

  const nextState = OrchestratorStateSchema.parse({
    ...baseState,
    status: "load_session",
    messages: appendMessage(
      baseState,
      {
        nodeName: "receive_request",
        role: "system",
        content: "Normalized the incoming request into the orchestrator state envelope.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
