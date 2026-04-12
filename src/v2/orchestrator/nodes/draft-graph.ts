// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendMessage, createGraphIfMissing, persistState, runDraftModel } from "./shared.ts";

export async function draftGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "draft_graph");
  console.log("[node]", "draft_graph start");
  if (!state.registrySnapshot) {
    throw new Error("draft_graph requires registrySnapshot to be loaded.");
  }

  const workingGraph = createGraphIfMissing(state, runtime);
  console.log("[node]", "draft_graph llm call start");
  const draft = await Promise.race([
    runDraftModel(
      {
        ...state,
        workingGraph,
      },
      state.registrySnapshot,
      runtime,
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("draft_graph LLM call timeout after 60s")), 60000),
    ),
  ]);
  console.log("[node]", "draft_graph llm call complete");

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    workingGraph,
    proposedToolCalls: draft.proposedToolCalls,
    status: "validate_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "draft_graph",
        role: "assistant",
        content: `Drafted ${draft.proposedToolCalls.length} atomic tool call(s).`,
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
