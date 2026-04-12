// @ts-nocheck
import type { GraphIR } from "../../graph/types.ts";
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import {
  appendCheckpoint,
  appendMessage,
  applyToolCall,
  issuesToAppliedToolCall,
  persistState,
} from "./shared.ts";

export async function applyToolStepNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  if (!state.registrySnapshot) {
    throw new Error("apply_tool_step requires registrySnapshot to be loaded.");
  }
  if (!state.workingGraph) {
    throw new Error("apply_tool_step requires a working graph.");
  }

  let nextGraph: GraphIR = state.workingGraph as GraphIR;
  const appliedToolCalls = [...state.appliedToolCalls];
  const resultMessages: string[] = [];

  for (const toolCall of state.proposedToolCalls) {
    const result = applyToolCall(nextGraph, state.registrySnapshot, toolCall);
    appliedToolCalls.push(issuesToAppliedToolCall(toolCall, result, runtime));
    resultMessages.push(
      result.applied
        ? `Applied ${toolCall.toolName}.`
        : `Rejected ${toolCall.toolName} because it would leave the graph invalid.`,
    );

    if (!result.applied) {
      break;
    }

    nextGraph = result.graph as GraphIR;
  }

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    workingGraph: nextGraph,
    appliedToolCalls,
    proposedToolCalls: [],
    status: "revalidate_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "apply_tool_step",
        role: "tool",
        content: resultMessages.join(" "),
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "apply_tool_step",
        note: "Applied a bounded batch of atomic tool calls.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
