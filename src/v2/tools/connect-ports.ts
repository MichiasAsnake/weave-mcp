import { z } from "zod";

import { addEdgeToGraph, createGraphEdgeIR } from "../graph/builders.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolResult } from "./types.ts";
import {
  ConnectPortsToolInputSchema,
  finalizeToolMutation,
  getGraphNodeById,
  getNodeSpecByDefinitionId,
  makeInvalidToolResult,
  makeToolIssue,
} from "./types.ts";

export type ConnectPortsToolInput = z.infer<typeof ConnectPortsToolInputSchema>;

export function connectPortsTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: ConnectPortsToolInput,
): ToolResult {
  const input = ConnectPortsToolInputSchema.parse(rawInput);
  const fromNode = getGraphNodeById(graph, input.fromNodeId);
  const toNode = getGraphNodeById(graph, input.toNodeId);

  if (!fromNode || !toNode) {
    const issues = [];
    if (!fromNode) {
      issues.push(
        makeToolIssue({
          code: "tool.connect_ports.source_node_missing",
          message: `Cannot connect from missing node \`${input.fromNodeId}\`.`,
          context: {
            nodeId: input.fromNodeId,
            portKey: input.fromPortKey,
          },
        }),
      );
    }
    if (!toNode) {
      issues.push(
        makeToolIssue({
          code: "tool.connect_ports.target_node_missing",
          message: `Cannot connect to missing node \`${input.toNodeId}\`.`,
          context: {
            nodeId: input.toNodeId,
            portKey: input.toPortKey,
          },
        }),
      );
    }
    return makeInvalidToolResult(graph, issues);
  }

  const fromSpec = getNodeSpecByDefinitionId(registry, fromNode.definitionId);
  const toSpec = getNodeSpecByDefinitionId(registry, toNode.definitionId);
  if (!fromSpec || !toSpec) {
    return makeInvalidToolResult(graph, [
      makeToolIssue({
        code: "tool.connect_ports.definition_missing",
        message: "Cannot connect ports because one or both node definitions are missing from the registry.",
        context: {
          edgeId: input.edgeId,
        },
      }),
    ]);
  }

  const fromPort = fromSpec.ports.find((port) => port.direction === "output" && port.key === input.fromPortKey);
  const toPort = toSpec.ports.find((port) => port.direction === "input" && port.key === input.toPortKey);

  if (!fromPort || !toPort) {
    const issues = [];
    if (!fromPort) {
      issues.push(
        makeToolIssue({
          code: "tool.connect_ports.source_port_missing",
          message: `Output port \`${input.fromPortKey}\` does not exist on node \`${input.fromNodeId}\`.`,
          context: {
            nodeId: input.fromNodeId,
            definitionId: fromNode.definitionId,
            nodeType: fromNode.nodeType,
            portKey: input.fromPortKey,
          },
        }),
      );
    }
    if (!toPort) {
      issues.push(
        makeToolIssue({
          code: "tool.connect_ports.target_port_missing",
          message: `Input port \`${input.toPortKey}\` does not exist on node \`${input.toNodeId}\`.`,
          context: {
            nodeId: input.toNodeId,
            definitionId: toNode.definitionId,
            nodeType: toNode.nodeType,
            portKey: input.toPortKey,
          },
        }),
      );
    }
    return makeInvalidToolResult(graph, issues);
  }

  const candidateGraph = addEdgeToGraph(
    graph,
    createGraphEdgeIR({
      edgeId: input.edgeId,
      from: {
        nodeId: input.fromNodeId,
        portKey: input.fromPortKey,
        valueKind: fromPort.kind,
      },
      to: {
        nodeId: input.toNodeId,
        portKey: input.toPortKey,
        valueKind: toPort.kind,
      },
    }),
  );

  return finalizeToolMutation(graph, candidateGraph, registry);
}
