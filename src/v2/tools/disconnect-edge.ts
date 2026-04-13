import { z } from "zod";

import { GraphIRSchema } from "../graph/zod.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolMutationOptions, ToolResult } from "./types.ts";
import {
  DisconnectEdgeToolInputSchema,
  finalizeToolMutation,
  makeInvalidToolResult,
  makeToolIssue,
} from "./types.ts";

export type DisconnectEdgeToolInput = z.infer<typeof DisconnectEdgeToolInputSchema>;

export function disconnectEdgeTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: DisconnectEdgeToolInput,
  options: ToolMutationOptions = {},
): ToolResult {
  const input = DisconnectEdgeToolInputSchema.parse(rawInput);
  const edgeExists = graph.edges.some((edge) => edge.edgeId === input.edgeId);

  if (!edgeExists) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.disconnect_edge.edge_missing",
        message: `Cannot disconnect missing edge \`${input.edgeId}\`.`,
        context: {
          edgeId: input.edgeId,
        },
      }),
    ]);
  }

  const candidateGraph = GraphIRSchema.parse({
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    edges: graph.edges.filter((edge) => edge.edgeId !== input.edgeId),
  });

  return finalizeToolMutation(graph, candidateGraph, registry, [], options);
}
