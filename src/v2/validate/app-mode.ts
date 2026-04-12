import type { GraphIR } from "../graph/types.ts";

import type { NodeSpec, NormalizedRegistrySnapshot } from "../registry/types.ts";
import type { ValidationIssue } from "./types.ts";

export function validateGraphAppMode(
  graph: GraphIR,
  registry: NormalizedRegistrySnapshot,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const graphNodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );

  for (const field of graph.appMode.fields) {
    const node = graphNodesById.get(field.source.nodeId);
    if (!node) {
      issues.push({
        severity: "error",
        code: "app_mode.field_node_missing",
        message: `App Mode field \`${field.key}\` references missing node \`${field.source.nodeId}\`.`,
        context: {
          fieldKey: field.key,
          nodeId: field.source.nodeId,
          bindingType: field.source.bindingType,
          bindingKey: field.source.bindingKey,
        },
      });
      continue;
    }

    const nodeSpec = nodeSpecByDefinitionId.get(node.definitionId);
    if (!nodeSpec) {
      continue;
    }

    if (field.source.bindingType === "param") {
      const paramExists = nodeSpec.params.some((param) => param.key === field.source.bindingKey);
      if (!paramExists) {
        issues.push({
          severity: "error",
          code: "app_mode.param_binding_missing",
          message:
            `App Mode field \`${field.key}\` references missing param \`${field.source.bindingKey}\` ` +
            `on node \`${node.nodeId}\`.`,
          context: {
            fieldKey: field.key,
            nodeId: node.nodeId,
            definitionId: node.definitionId,
            nodeType: node.nodeType,
            bindingType: field.source.bindingType,
            bindingKey: field.source.bindingKey,
          },
        });
      }
      continue;
    }

    const inputPortExists = nodeSpec.ports.some(
      (port) => port.direction === "input" && port.key === field.source.bindingKey,
    );

    if (!inputPortExists) {
      issues.push({
        severity: "error",
        code: "app_mode.input_port_binding_missing",
        message:
          `App Mode field \`${field.key}\` references missing input port \`${field.source.bindingKey}\` ` +
          `on node \`${node.nodeId}\`.`,
        context: {
          fieldKey: field.key,
          nodeId: node.nodeId,
          definitionId: node.definitionId,
          nodeType: node.nodeType,
          bindingType: field.source.bindingType,
          bindingKey: field.source.bindingKey,
          portKey: field.source.bindingKey,
        },
      });
    }
  }

  return issues;
}
