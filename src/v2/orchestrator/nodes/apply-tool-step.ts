// @ts-nocheck
import type { GraphIR } from "../../graph/types.ts";
import { validateGraph } from "../../validate/index.ts";
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
  console.log("[node]", "apply_tool_step");
  if (!state.registrySnapshot) {
    throw new Error("apply_tool_step requires registrySnapshot to be loaded.");
  }
  if (!state.workingGraph) {
    throw new Error("apply_tool_step requires a working graph.");
  }

  const originalGraph: GraphIR = state.workingGraph as GraphIR;
  let candidateGraph: GraphIR = originalGraph;
  const appliedToolCalls = [...state.appliedToolCalls];
  const resultMessages: string[] = [];
  let batchFailed = false;

  if (state.proposedToolCalls.length === 0) {
    resultMessages.push("No tool calls were proposed for application.");
  }

  for (const toolCall of state.proposedToolCalls) {
    const result = applyToolCall(candidateGraph, state.registrySnapshot, toolCall, {
      skipGraphValidation: true,
    });
    appliedToolCalls.push(issuesToAppliedToolCall(toolCall, result, runtime));

    const message = result.applied
      ? `Applied ${toolCall.toolName}.`
      : `Rejected ${toolCall.toolName}: ${result.issues?.[0]?.message || "unknown reason"}`;

    resultMessages.push(message);

    if (!result.applied) {
      batchFailed = true;
      break;
    }

    candidateGraph = result.graph as GraphIR;
  }

  let nextGraph: GraphIR = originalGraph;
  if (!batchFailed) {
    const finalValidation = validateGraph(candidateGraph, state.registrySnapshot);
    if (finalValidation.ok) {
      nextGraph = candidateGraph;
    } else {
      const firstError = finalValidation.issues.find((issue) => issue.severity === "error");
      resultMessages.push(
        `Rejected tool batch: ${firstError?.message || "final graph would be invalid"}`,
      );
    }
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
