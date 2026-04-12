import { z } from "zod";

import { AppFieldIRSchema, GraphIRSchema } from "../graph/zod.ts";
import { JsonValueSchema, NodeDefinitionIdSchema } from "../generated/node-schemas.ts";
import type { GraphIR } from "../graph/types.ts";
import type { NodeSpec, NormalizedRegistrySnapshot } from "../registry/types.ts";
import type { ValidationIssue } from "../validate/types.ts";
import { validateGraph } from "../validate/index.ts";

export type RegistrySnapshot = NormalizedRegistrySnapshot;

export interface ToolResult {
  applied: boolean;
  graph: GraphIR;
  issues: ValidationIssue[];
}

export const ToolNodeIdSchema = z.string().min(1);
export const ToolEdgeIdSchema = z.string().min(1);
export const ToolPortKeySchema = z.string().min(1);

export const CreateNodeToolInputSchema = z.object({
  definitionId: NodeDefinitionIdSchema,
  nodeId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  params: z.record(z.string(), JsonValueSchema).optional(),
});

export const SetNodeParamToolInputSchema = z.object({
  nodeId: ToolNodeIdSchema,
  paramKey: z.string().min(1),
  value: JsonValueSchema,
});

export const ConnectPortsToolInputSchema = z.object({
  edgeId: ToolEdgeIdSchema.optional(),
  fromNodeId: ToolNodeIdSchema,
  fromPortKey: ToolPortKeySchema,
  toNodeId: ToolNodeIdSchema,
  toPortKey: ToolPortKeySchema,
});

export const DisconnectEdgeToolInputSchema = z.object({
  edgeId: ToolEdgeIdSchema,
});

export const RemoveNodeToolInputSchema = z.object({
  nodeId: ToolNodeIdSchema,
});

export const SetOutputsToolInputSchema = z.object({
  nodeIds: z.array(ToolNodeIdSchema),
});

export const SetAppModeFieldToolInputSchema = z.object({
  field: AppFieldIRSchema,
});

export function makeRegistryNodeSpecIndex(registry: RegistrySnapshot): Map<string, NodeSpec> {
  return new Map(registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]));
}

export function getNodeSpecByDefinitionId(
  registry: RegistrySnapshot,
  definitionId: string,
): NodeSpec | undefined {
  return makeRegistryNodeSpecIndex(registry).get(definitionId);
}

export function getGraphNodeById(graph: GraphIR, nodeId: string): GraphIR["nodes"][number] | undefined {
  return graph.nodes.find((node) => node.nodeId === nodeId);
}

export function makeInvalidToolResult(graph: GraphIR, issues: ValidationIssue[]): ToolResult {
  return {
    applied: false,
    graph,
    issues,
  };
}

export function finalizeToolMutation(
  originalGraph: GraphIR,
  candidateGraph: GraphIR,
  registry: RegistrySnapshot,
  preIssues: ValidationIssue[] = [],
): ToolResult {
  const parsedCandidate = GraphIRSchema.parse(candidateGraph);
  const validationResult = validateGraph(parsedCandidate, registry);
  const issues = [...preIssues, ...validationResult.issues];

  if (issues.some((issue) => issue.severity === "error")) {
    return {
      applied: false,
      graph: originalGraph,
      issues,
    };
  }

  return {
    applied: true,
    graph: parsedCandidate,
    issues,
  };
}

export function makeToolIssue(args: {
  code: string;
  message: string;
  severity?: "error" | "warning";
  context?: ValidationIssue["context"];
}): ValidationIssue {
  return {
    severity: args.severity || "error",
    code: args.code,
    message: args.message,
    context: args.context || {},
  };
}
