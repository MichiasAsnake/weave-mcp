import type { GraphIR } from "../graph/types.ts";

import type { NormalizedRegistrySnapshot, NodeSpec } from "../registry/types.ts";
import { GraphIRSchema } from "../graph/zod.ts";
import { validateGraphAppMode } from "./app-mode.ts";
import { validateGraphParams } from "./params.ts";
import { validateGraphPorts } from "./ports.ts";
import type { RegistryValidationIndex, ValidationIssue, ValidationResult } from "./types.ts";

export * from "./types.ts";
export * from "./params.ts";
export * from "./ports.ts";
export * from "./app-mode.ts";

export function validateGraph(
  graph: GraphIR,
  registry: NormalizedRegistrySnapshot,
): ValidationResult {
  const parsedGraph = GraphIRSchema.parse(graph);
  const registryIndex = buildRegistryValidationIndex(registry);

  const issues: ValidationIssue[] = [
    ...validateGraphNodes(parsedGraph, registryIndex),
    ...validateGraphParams(parsedGraph, registry),
    ...validateGraphPorts(parsedGraph, registry),
    ...validateGraphAppMode(parsedGraph, registry),
  ];

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  };
}

export function buildRegistryValidationIndex(
  registry: NormalizedRegistrySnapshot,
): RegistryValidationIndex {
  return {
    snapshot: registry,
    nodeSpecsByDefinitionId: new Map(
      registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
    ),
  };
}

function validateGraphNodes(
  graph: GraphIR,
  registryIndex: RegistryValidationIndex,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const node of graph.nodes) {
    const nodeSpec = registryIndex.nodeSpecsByDefinitionId.get(node.definitionId);
    if (!nodeSpec) {
      issues.push({
        severity: "error",
        code: "node.registry_definition_missing",
        message: `Node \`${node.nodeId}\` references unknown definitionId \`${node.definitionId}\`.`,
        context: {
          nodeId: node.nodeId,
          definitionId: node.definitionId,
          nodeType: node.nodeType,
        },
      });
      continue;
    }

    if (nodeSpec.nodeType !== node.nodeType) {
      issues.push({
        severity: "error",
        code: "node.registry_node_type_mismatch",
        message:
          `Node \`${node.nodeId}\` declares nodeType \`${node.nodeType}\` but registry definition ` +
          `\`${node.definitionId}\` is \`${nodeSpec.nodeType}\`.`,
        context: {
          nodeId: node.nodeId,
          definitionId: node.definitionId,
          nodeType: node.nodeType,
        },
      });
    }
  }

  return issues;
}
