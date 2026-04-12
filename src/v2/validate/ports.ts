import type { GraphEdgeIR, GraphIR } from "../graph/types.ts";

import type { NodeSpec, NormalizedRegistrySnapshot, PortSpec, ValueKind } from "../registry/types.ts";
import type { ValidationIssue } from "./types.ts";

export function validateGraphPorts(
  graph: GraphIR,
  registry: NormalizedRegistrySnapshot,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );
  const graphNodesById = new Map(graph.nodes.map((node) => [node.nodeId, node]));

  for (const edge of graph.edges) {
    issues.push(...validateGraphEdge(edge, graphNodesById, nodeSpecByDefinitionId));
  }

  issues.push(...validateUnconnectedRequiredInputPorts(graph, graphNodesById, nodeSpecByDefinitionId));

  return issues;
}

function validateGraphEdge(
  edge: GraphEdgeIR,
  graphNodesById: Map<string, GraphIR["nodes"][number]>,
  nodeSpecByDefinitionId: Map<string, NodeSpec>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fromNode = graphNodesById.get(edge.from.nodeId);
  const toNode = graphNodesById.get(edge.to.nodeId);

  if (!fromNode) {
    issues.push({
      severity: "error",
      code: "edge.source_node_missing",
      message: `Edge \`${edge.edgeId}\` references missing source node \`${edge.from.nodeId}\`.`,
      context: {
        edgeId: edge.edgeId,
        nodeId: edge.from.nodeId,
        portKey: edge.from.portKey,
      },
    });
    return issues;
  }

  if (!toNode) {
    issues.push({
      severity: "error",
      code: "edge.target_node_missing",
      message: `Edge \`${edge.edgeId}\` references missing target node \`${edge.to.nodeId}\`.`,
      context: {
        edgeId: edge.edgeId,
        nodeId: edge.to.nodeId,
        portKey: edge.to.portKey,
      },
    });
    return issues;
  }

  const fromSpec = nodeSpecByDefinitionId.get(fromNode.definitionId);
  const toSpec = nodeSpecByDefinitionId.get(toNode.definitionId);
  if (!fromSpec || !toSpec) {
    return issues;
  }

  const fromPort = findPortSpec(fromSpec, "output", edge.from.portKey);
  const toPort = findPortSpec(toSpec, "input", edge.to.portKey);

  if (!fromPort) {
    issues.push({
      severity: "error",
      code: "edge.source_port_missing",
      message: `Edge \`${edge.edgeId}\` references missing output port \`${edge.from.portKey}\` on node \`${fromNode.nodeId}\`.`,
      context: {
        edgeId: edge.edgeId,
        nodeId: fromNode.nodeId,
        definitionId: fromNode.definitionId,
        nodeType: fromNode.nodeType,
        portKey: edge.from.portKey,
      },
    });
    return issues;
  }

  if (!toPort) {
    issues.push({
      severity: "error",
      code: "edge.target_port_missing",
      message: `Edge \`${edge.edgeId}\` references missing input port \`${edge.to.portKey}\` on node \`${toNode.nodeId}\`.`,
      context: {
        edgeId: edge.edgeId,
        nodeId: toNode.nodeId,
        definitionId: toNode.definitionId,
        nodeType: toNode.nodeType,
        portKey: edge.to.portKey,
      },
    });
    return issues;
  }

  if (!arePortsCompatible(fromPort, toPort)) {
    issues.push({
      severity: "error",
      code: "edge.incompatible_port_kinds",
      message:
        `Edge \`${edge.edgeId}\` connects incompatible kinds: ` +
        `\`${fromNode.nodeId}.${fromPort.key}\` (${fromPort.kind}) -> ` +
        `\`${toNode.nodeId}.${toPort.key}\` (${toPort.kind}).`,
      context: {
        edgeId: edge.edgeId,
        nodeId: toNode.nodeId,
        definitionId: toNode.definitionId,
        nodeType: toNode.nodeType,
        portKey: toPort.key,
      },
    });
  }

  return issues;
}

function validateUnconnectedRequiredInputPorts(
  graph: GraphIR,
  graphNodesById: Map<string, GraphIR["nodes"][number]>,
  nodeSpecByDefinitionId: Map<string, NodeSpec>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const incomingPortKeysByNodeId = new Map<string, Set<string>>();

  for (const edge of graph.edges) {
    const existing = incomingPortKeysByNodeId.get(edge.to.nodeId) || new Set<string>();
    existing.add(edge.to.portKey);
    incomingPortKeysByNodeId.set(edge.to.nodeId, existing);
  }

  for (const node of graph.nodes) {
    const nodeSpec = nodeSpecByDefinitionId.get(node.definitionId);
    if (!nodeSpec) {
      continue;
    }

    const connectedInputPortKeys = incomingPortKeysByNodeId.get(node.nodeId) || new Set<string>();
    for (const port of nodeSpec.ports) {
      if (port.direction !== "input" || !port.required) {
        continue;
      }

      if (connectedInputPortKeys.has(port.key)) {
        continue;
      }

      issues.push({
        severity: "error",
        code: "port.required_input_unconnected",
        message: `Required input port \`${port.key}\` is unconnected on node \`${node.nodeId}\`.`,
        context: {
          nodeId: node.nodeId,
          definitionId: node.definitionId,
          nodeType: node.nodeType,
          portKey: port.key,
        },
      });
    }
  }

  return issues;
}

function findPortSpec(
  nodeSpec: NodeSpec,
  direction: "input" | "output",
  portKey: string,
): PortSpec | undefined {
  return nodeSpec.ports.find((port) => port.direction === direction && port.key === portKey);
}

function arePortsCompatible(fromPort: PortSpec, toPort: PortSpec): boolean {
  if (fromPort.kind === "unknown" || toPort.kind === "unknown") {
    return false;
  }

  const producedKinds = normalizeKindsForCompatibility(fromPort.produces, fromPort.kind);
  const acceptedKinds = normalizeKindsForCompatibility(toPort.accepts, toPort.kind);

  if (acceptedKinds.has("any")) {
    return true;
  }

  for (const producedKind of producedKinds) {
    if (producedKind === "any") {
      return true;
    }
    if (acceptedKinds.has(producedKind)) {
      return true;
    }
  }

  return false;
}

function normalizeKindsForCompatibility(
  explicitKinds: ValueKind[] | undefined,
  fallbackKind: ValueKind,
): Set<ValueKind> {
  const kinds = explicitKinds && explicitKinds.length > 0 ? explicitKinds : [fallbackKind];
  return new Set(kinds);
}
