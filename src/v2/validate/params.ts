import type { GraphIR } from "../graph/types.ts";

import type { NodeSpec, NormalizedRegistrySnapshot } from "../registry/types.ts";
import type { ValidationIssue } from "./types.ts";

export function validateGraphParams(
  graph: GraphIR,
  registry: NormalizedRegistrySnapshot,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );

  for (const node of graph.nodes) {
    const nodeSpec = nodeSpecByDefinitionId.get(node.definitionId);
    if (!nodeSpec) {
      continue;
    }

    issues.push(...validateRequiredParamsForNode(node.nodeId, node.definitionId, node.nodeType, node.params, nodeSpec));
  }

  return issues;
}

function validateRequiredParamsForNode(
  nodeId: string,
  definitionId: string,
  nodeType: string,
  params: Record<string, unknown>,
  nodeSpec: NodeSpec,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const paramSpec of nodeSpec.params) {
    if (!paramSpec.required) {
      continue;
    }

    const value = params[paramSpec.key];
    if (isPopulatedValue(value)) {
      continue;
    }

    issues.push({
      severity: "error",
      code: "param.required_missing",
      message: `Required param \`${paramSpec.key}\` is missing on node \`${nodeId}\`.`,
      context: {
        nodeId,
        definitionId,
        nodeType,
        bindingType: "param",
        bindingKey: paramSpec.key,
      },
    });
  }

  return issues;
}

function isPopulatedValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}
