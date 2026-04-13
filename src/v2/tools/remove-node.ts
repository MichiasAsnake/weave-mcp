import { z } from "zod";

import { GraphIRSchema } from "../graph/zod.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolMutationOptions, ToolResult } from "./types.ts";
import {
  RemoveNodeToolInputSchema,
  getGraphNodeById,
  finalizeToolMutation,
  makeInvalidToolResult,
  makeToolIssue,
} from "./types.ts";

export type RemoveNodeToolInput = z.infer<typeof RemoveNodeToolInputSchema>;

export function removeNodeTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: RemoveNodeToolInput,
  options: ToolMutationOptions = {},
): ToolResult {
  const input = RemoveNodeToolInputSchema.parse(rawInput);
  const node = getGraphNodeById(graph, input.nodeId);

  if (!node) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.remove_node.node_missing",
        message: `Cannot remove missing node \`${input.nodeId}\`.`,
        context: {
          nodeId: input.nodeId,
        },
      }),
    ]);
  }

  const remainingFields = graph.appMode.fields.filter((field) => field.source.nodeId !== input.nodeId);
  const remainingFieldKeys = new Set(remainingFields.map((field) => field.key));

  const candidateGraph = GraphIRSchema.parse({
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    nodes: graph.nodes.filter((currentNode) => currentNode.nodeId !== input.nodeId),
    edges: graph.edges.filter(
      (edge) => edge.from.nodeId !== input.nodeId && edge.to.nodeId !== input.nodeId,
    ),
    outputs: {
      nodeIds: graph.outputs.nodeIds.filter((nodeId) => nodeId !== input.nodeId),
    },
    appMode: {
      ...graph.appMode,
      fields: remainingFields,
      layout: {
        sections: graph.appMode.layout.sections
          .map((section) => ({
            ...section,
            fieldKeys: section.fieldKeys.filter((fieldKey) => remainingFieldKeys.has(fieldKey)),
          }))
          .filter((section) => section.fieldKeys.length > 0),
      },
    },
  });

  return finalizeToolMutation(graph, candidateGraph, registry, [], options);
}
