import { z } from "zod";

import { GraphIRSchema } from "../graph/zod.ts";
import { NodeParamSchemasByDefinitionId } from "../generated/node-schemas.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolMutationOptions, ToolResult } from "./types.ts";
import {
  SetNodeParamToolLLMInputSchema,
  SetNodeParamToolInputSchema,
  finalizeToolMutation,
  getGraphNodeById,
  getNodeSpecByDefinitionId,
  makeInvalidToolResult,
  makeToolIssue,
} from "./types.ts";

export type SetNodeParamToolInput = z.infer<typeof SetNodeParamToolInputSchema>;
export type SetNodeParamToolLLMInput = z.infer<typeof SetNodeParamToolLLMInputSchema>;

const SetNodeParamToolAnyInputSchema = z.union([
  SetNodeParamToolInputSchema,
  SetNodeParamToolLLMInputSchema,
]);

export function setNodeParamTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: SetNodeParamToolInput | SetNodeParamToolLLMInput,
  options: ToolMutationOptions = {},
): ToolResult {
  const input = SetNodeParamToolAnyInputSchema.parse(rawInput);
  const targetNode = getGraphNodeById(graph, input.nodeId);

  if (!targetNode) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.set_node_param.node_missing",
        message: `Cannot set param on missing node \`${input.nodeId}\`.`,
        context: {
          nodeId: input.nodeId,
          bindingType: "param",
          bindingKey: input.paramKey,
        },
      }),
    ]);
  }

  const nodeSpec = getNodeSpecByDefinitionId(registry, targetNode.definitionId);
  if (!nodeSpec) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.set_node_param.definition_missing",
        message: `Node \`${input.nodeId}\` references unknown definition \`${targetNode.definitionId}\`.`,
        context: {
          nodeId: input.nodeId,
          definitionId: targetNode.definitionId,
          nodeType: targetNode.nodeType,
          bindingType: "param",
          bindingKey: input.paramKey,
        },
      }),
    ]);
  }

  const paramSpec = nodeSpec.params.find((param) => param.key === input.paramKey);
  if (!paramSpec) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.set_node_param.param_missing",
        message: `Node \`${input.nodeId}\` does not expose param \`${input.paramKey}\` in the registry.`,
        context: {
          nodeId: input.nodeId,
          definitionId: targetNode.definitionId,
          nodeType: targetNode.nodeType,
          bindingType: "param",
          bindingKey: input.paramKey,
        },
      }),
    ]);
  }

  const paramsSchema = NodeParamSchemasByDefinitionId[targetNode.definitionId];
  const parsedParams = paramsSchema.safeParse({
    ...targetNode.params,
    [input.paramKey]: input.value,
  });

  if (!parsedParams.success) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.set_node_param.value_invalid",
        message:
          `Invalid value for param \`${input.paramKey}\` on node \`${input.nodeId}\`: ` +
          `${parsedParams.error.issues[0]?.message || "schema parse failed"}`,
        context: {
          nodeId: input.nodeId,
          definitionId: targetNode.definitionId,
          nodeType: targetNode.nodeType,
          bindingType: "param",
          bindingKey: input.paramKey,
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
    nodes: graph.nodes.map((node) =>
      node.nodeId === input.nodeId
        ? {
            ...node,
            params: parsedParams.data,
          }
        : node,
    ),
  });

  return finalizeToolMutation(graph, candidateGraph, registry, [], options);
}
