import { z } from "zod";

import { createGraphNodeIR, addNodeToGraph } from "../graph/builders.ts";
import { NodeParamSchemasByDefinitionId } from "../generated/node-schemas.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolResult } from "./types.ts";
import {
  CreateNodeToolInputSchema,
  finalizeToolMutation,
  getGraphNodeById,
  getNodeSpecByDefinitionId,
  makeInvalidToolResult,
  makeToolIssue,
} from "./types.ts";

export type CreateNodeToolInput = z.infer<typeof CreateNodeToolInputSchema>;

export function createNodeTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: CreateNodeToolInput,
): ToolResult {
  const input = CreateNodeToolInputSchema.parse(rawInput);
  const nodeSpec = getNodeSpecByDefinitionId(registry, input.definitionId);

  if (!nodeSpec) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.create_node.definition_missing",
        message: `Cannot create node for unknown definitionId \`${input.definitionId}\`.`,
        context: {
          definitionId: input.definitionId,
        },
      }),
    ]);
  }

  if (input.nodeId && getGraphNodeById(graph, input.nodeId)) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.create_node.node_id_conflict",
        message: `Cannot create node with duplicate nodeId \`${input.nodeId}\`.`,
        context: {
          nodeId: input.nodeId,
          definitionId: input.definitionId,
          nodeType: nodeSpec.nodeType,
        },
      }),
    ]);
  }

  const paramsSchema = NodeParamSchemasByDefinitionId[input.definitionId];
  const parsedParams = paramsSchema.safeParse(input.params || {});
  if (!parsedParams.success) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.create_node.params_invalid",
        message: `Provided params are invalid for definition \`${input.definitionId}\`: ${parsedParams.error.issues[0]?.message || "schema parse failed"}`,
        context: {
          definitionId: input.definitionId,
          nodeType: nodeSpec.nodeType,
        },
      }),
    ]);
  }

  const node = createGraphNodeIR({
    nodeId: input.nodeId,
    definitionId: input.definitionId,
    nodeType: nodeSpec.nodeType,
    displayName: input.displayName || nodeSpec.displayName,
    params: parsedParams.data,
  });

  const candidateGraph = addNodeToGraph(graph, node);
  return finalizeToolMutation(graph, candidateGraph, registry);
}
