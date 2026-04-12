import { z } from "zod";

import { setGraphOutputs } from "../graph/builders.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolResult } from "./types.ts";
import {
  SetOutputsToolInputSchema,
  finalizeToolMutation,
  getGraphNodeById,
  makeInvalidToolResult,
  makeToolIssue,
} from "./types.ts";

export type SetOutputsToolInput = z.infer<typeof SetOutputsToolInputSchema>;

export function setOutputsTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: SetOutputsToolInput,
): ToolResult {
  const input = SetOutputsToolInputSchema.parse(rawInput);
  const missingNodeIds = input.nodeIds.filter((nodeId) => !getGraphNodeById(graph, nodeId));

  if (missingNodeIds.length > 0) {
    return makeInvalidToolResult(
      graph,
      missingNodeIds.map((nodeId) =>
        makeToolIssue({
          code: "tool.set_outputs.node_missing",
          message: `Cannot mark missing node \`${nodeId}\` as a graph output.`,
          context: {
            nodeId,
          },
        }),
      ),
    );
  }

  const candidateGraph = setGraphOutputs(graph, input.nodeIds);
  return finalizeToolMutation(graph, candidateGraph, registry);
}
