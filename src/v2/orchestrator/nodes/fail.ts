import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendMessage, persistState } from "./shared.ts";

export async function failNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  const nextState = OrchestratorStateSchema.parse({
    ...state,
    status: "failed",
    failureReason:
      state.failureReason || {
        code: "orchestrator.terminal_failure",
        message: "The orchestrator entered the fail state without a specific failure reason.",
        nodeName: "fail",
      },
    messages: appendMessage(
      state,
      {
        nodeName: "fail",
        role: "system",
        content: "Orchestrator terminated with failure.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
