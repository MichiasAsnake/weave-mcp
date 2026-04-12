import { randomUUID } from "node:crypto";

import type { GraphEdgeIR, GraphIR, GraphMetadataIR, GraphNodeIR } from "./types.ts";

import { createDefaultAppModeIR } from "./app-mode.ts";
import { GraphEdgeIRSchema, GraphIRSchema, GraphMetadataIRSchema, GraphNodeIRSchema } from "./zod.ts";

export function createGraphMetadataIR(args: {
  graphId?: string;
  name: string;
  description?: string;
  sourceTemplateId?: string;
  createdAt?: string;
  updatedAt?: string;
}): GraphMetadataIR {
  const now = new Date().toISOString();

  return GraphMetadataIRSchema.parse({
    graphId: args.graphId || randomUUID(),
    name: args.name,
    description: args.description,
    sourceTemplateId: args.sourceTemplateId,
    createdAt: args.createdAt || now,
    updatedAt: args.updatedAt || now,
  });
}

export function createGraphNodeIR(args: {
  nodeId?: string;
  definitionId: string;
  nodeType: string;
  displayName?: string;
  params?: Record<string, unknown>;
}): GraphNodeIR {
  return GraphNodeIRSchema.parse({
    nodeId: args.nodeId || randomUUID(),
    definitionId: args.definitionId,
    nodeType: args.nodeType,
    displayName: args.displayName,
    params: args.params || {},
  });
}

export function createGraphEdgeIR(args: {
  edgeId?: string;
  from: GraphEdgeIR["from"];
  to: GraphEdgeIR["to"];
}): GraphEdgeIR {
  return GraphEdgeIRSchema.parse({
    edgeId: args.edgeId || randomUUID(),
    from: args.from,
    to: args.to,
  });
}

export function createEmptyGraphIR(args: {
  registryVersion: string;
  name: string;
  description?: string;
  sourceTemplateId?: string;
  graphId?: string;
}): GraphIR {
  const metadata = createGraphMetadataIR({
    graphId: args.graphId,
    name: args.name,
    description: args.description,
    sourceTemplateId: args.sourceTemplateId,
  });

  return GraphIRSchema.parse({
    irVersion: "1",
    registryVersion: args.registryVersion,
    metadata,
    nodes: [],
    edges: [],
    outputs: {
      nodeIds: [],
    },
    appMode: createDefaultAppModeIR(),
  });
}

export function createGraphIR(graph: GraphIR): GraphIR {
  return GraphIRSchema.parse(graph);
}

export function addNodeToGraph(graph: GraphIR, node: GraphNodeIR): GraphIR {
  const parsedNode = GraphNodeIRSchema.parse(node);
  return GraphIRSchema.parse({
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    nodes: [...graph.nodes, parsedNode],
  });
}

export function addEdgeToGraph(graph: GraphIR, edge: GraphEdgeIR): GraphIR {
  const parsedEdge = GraphEdgeIRSchema.parse(edge);
  return GraphIRSchema.parse({
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    edges: [...graph.edges, parsedEdge],
  });
}

export function setGraphOutputs(graph: GraphIR, nodeIds: string[]): GraphIR {
  return GraphIRSchema.parse({
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    outputs: {
      nodeIds,
    },
  });
}
