import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraphIR,
  createGraphEdgeIR,
  createGraphNodeIR,
  setGraphOutputs,
} from "../graph/builders.ts";
import { createDefaultAppModeIR, setAppModeEnabled, setAppModeFields } from "../graph/app-mode.ts";
import type { GraphAppModeIR } from "../graph/types.ts";
import type { NodeSpec, PortSpec, ValueKind } from "../registry/types.ts";
import { validateGraph } from "../validate/index.ts";
import { makeCompilerError } from "./errors.ts";
import { parseCompilerIntent } from "./intent.ts";
import { CompilerResultSchema } from "./intent-zod.ts";
import { matchCompilerCapabilities } from "./capability-match.ts";
import type {
  CandidateSelection,
  CompiledWorkflowPlan,
  CompilerAppField,
  CompilerOperationKind,
  CompilerResult,
  CompilerRuntime,
  CompilerTraceEntry,
} from "./types.ts";

function getNodeSpec(registry: CompilerRuntime["registry"], definitionId: string): NodeSpec {
  const nodeSpec = registry.nodeSpecs.find((node) => node.source.definitionId === definitionId);
  if (!nodeSpec) {
    throw new Error(`Missing node spec for ${definitionId}`);
  }
  return nodeSpec;
}

function chooseOutputPort(nodeSpec: NodeSpec, preferredKinds: ValueKind[]): PortSpec {
  const outputPorts = nodeSpec.ports.filter((port) => port.direction === "output");
  for (const preferredKind of preferredKinds) {
    const match = outputPorts.find((port) => (port.produces || [port.kind]).includes(preferredKind) || port.kind === preferredKind || port.kind === "any");
    if (match) return match;
  }
  if (outputPorts.length === 1) return outputPorts[0];
  const anyPort = outputPorts.find((port) => port.kind === "any");
  if (anyPort) return anyPort;
  throw new Error(`No output port matches ${preferredKinds.join(',')} on ${nodeSpec.displayName}`);
}

function chooseInputPort(nodeSpec: NodeSpec, fromKind: ValueKind): PortSpec {
  const inputPorts = nodeSpec.ports.filter((port) => port.direction === "input");
  const direct = inputPorts.find((port) => (port.accepts || [port.kind]).includes(fromKind));
  if (direct) return direct;
  const anyPort = inputPorts.find((port) => (port.accepts || [port.kind]).includes("any") || port.kind === "any");
  if (anyPort) return anyPort;
  if (inputPorts.length === 1) return inputPorts[0];
  throw new Error(`No input port accepts ${fromKind} on ${nodeSpec.displayName}`);
}

function inferOperationAppFields(
  operationKind: CompilerOperationKind,
  nodeSpec: NodeSpec,
  nodeId: string,
): CompilerAppField[] {
  if (!["edit-image", "generate-image", "generate-video"].includes(operationKind)) {
    return [];
  }

  const promptPort = nodeSpec.ports.find((port) =>
    port.direction === "input"
    && port.required
    && ((port.accepts || [port.kind]).includes("text") || port.kind === "text")
    && /prompt|instruction|text/.test(port.key.toLowerCase()),
  ) || nodeSpec.ports.find((port) =>
    port.direction === "input"
    && port.required
    && ((port.accepts || [port.kind]).includes("text") || port.kind === "text"),
  );

  if (!promptPort) {
    return [];
  }

  return [{
    key: `${nodeId}_prompt`,
    label: operationKind === "edit-image" ? "Edit prompt" : "Prompt",
    control: "textarea",
    required: true,
    locked: false,
    visible: true,
    helpText: operationKind === "edit-image" ? "Describe how the uploaded image should be edited." : "Describe what should be generated.",
    source: {
      nodeId,
      bindingType: "unconnected-input-port",
      bindingKey: promptPort.key,
    },
  }];
}

function getPreferredOutputKindsForOperation(operationKind: CompilerOperationKind): ValueKind[] {
  switch (operationKind) {
    case "upload":
      return ["file", "image", "any"];
    case "file-to-image":
    case "upscale-image":
    case "edit-image":
    case "generate-image":
      return ["image", "file", "any"];
    case "generate-video":
      return ["video", "any"];
    case "export":
      return ["file", "any"];
    case "output-result":
      return ["any"];
    default:
      return ["any"];
  }
}

function getStepId(operationKind: CompilerOperationKind, occurrence: number): string {
  switch (operationKind) {
    case "upload":
      return "upload";
    case "file-to-image":
      return "bridge";
    case "upscale-image":
      return occurrence === 1 ? "upscale" : `upscale-${occurrence}`;
    case "edit-image":
      return occurrence === 1 ? "edit" : `edit-${occurrence}`;
    case "generate-image":
      return occurrence === 1 ? "generate-image" : `generate-image-${occurrence}`;
    case "generate-video":
      return occurrence === 1 ? "generate-video" : `generate-video-${occurrence}`;
    case "export":
      return "export";
    case "output-result":
      return "output";
    default:
      return `step-${occurrence}`;
  }
}

function getNodeId(operationKind: CompilerOperationKind, occurrence: number): string {
  switch (operationKind) {
    case "upload":
      return "uploadImageNode";
    case "file-to-image":
      return "fileToImageBridgeNode";
    case "upscale-image":
      return occurrence === 1 ? "upscaleImageNode" : `upscaleImageNode${occurrence}`;
    case "edit-image":
      return occurrence === 1 ? "editImageNode" : `editImageNode${occurrence}`;
    case "generate-image":
      return occurrence === 1 ? "generateImageNode" : `generateImageNode${occurrence}`;
    case "generate-video":
      return occurrence === 1 ? "generateVideoNode" : `generateVideoNode${occurrence}`;
    case "export":
      return occurrence === 1 ? "exportResultNode" : `exportResultNode${occurrence}`;
    case "output-result":
      return occurrence === 1 ? "outputResultNode" : `outputResultNode${occurrence}`;
    default:
      return `compiledNode${occurrence}`;
  }
}

function getPurpose(operationKind: CompilerOperationKind): string {
  switch (operationKind) {
    case "upload":
      return "user upload";
    case "file-to-image":
      return "file to image bridge";
    case "upscale-image":
      return "image upscale";
    case "edit-image":
      return "prompt-guided image edit";
    case "generate-image":
      return "text-to-image generation";
    case "generate-video":
      return "text-to-video generation";
    case "export":
      return "export result";
    case "output-result":
      return "app output";
    default:
      return "workflow step";
  }
}

function buildCompiledWorkflowPlan(args: {
  registry: CompilerRuntime["registry"];
  selections: CandidateSelection[];
  graphId?: string;
  request: string;
}): { plan: CompiledWorkflowPlan; graph: import('../graph/types.ts').GraphIR } {
  let graph = createEmptyGraphIR({
    registryVersion: args.registry.registryVersion,
    name: "Compiled workflow",
    description: args.request,
    graphId: args.graphId,
  });

  const compiledNodes: CompiledWorkflowPlan["nodes"] = [];
  const compiledEdges: CompiledWorkflowPlan["edges"] = [];
  const appFields: CompilerAppField[] = [];
  const occurrenceByKind = new Map<CompilerOperationKind, number>();

  let previousNode: import('../graph/types.ts').GraphNodeIR | null = null;
  let previousSpec: NodeSpec | null = null;
  let previousOutputPort: PortSpec | null = null;
  let exportNodeId: string | null = null;

  for (const selection of args.selections) {
    const occurrence = (occurrenceByKind.get(selection.operationKind) || 0) + 1;
    occurrenceByKind.set(selection.operationKind, occurrence);

    const definitionId = selection.definitionIds[0];
    const nodeSpec = getNodeSpec(args.registry, definitionId);
    const nodeId = getNodeId(selection.operationKind, occurrence);
    const node = createGraphNodeIR({
      nodeId,
      definitionId: nodeSpec.source.definitionId,
      nodeType: nodeSpec.nodeType,
      displayName: nodeSpec.displayName,
      params: {},
    });
    graph = addNodeToGraph(graph, node);

    const stepId = getStepId(selection.operationKind, occurrence);
    compiledNodes.push({
      stepId,
      definitionId: nodeSpec.source.definitionId,
      nodeId: node.nodeId,
      displayName: nodeSpec.displayName,
      purpose: getPurpose(selection.operationKind),
    });

    if (previousNode && previousSpec && previousOutputPort) {
      const inputPort = chooseInputPort(nodeSpec, previousOutputPort.kind);
      graph = addEdgeToGraph(
        graph,
        createGraphEdgeIR({
          from: { nodeId: previousNode.nodeId, portKey: previousOutputPort.key, valueKind: previousOutputPort.kind },
          to: { nodeId: node.nodeId, portKey: inputPort.key, valueKind: inputPort.kind },
        }),
      );
      compiledEdges.push({
        fromStepId: compiledNodes[compiledNodes.length - 2].stepId,
        toStepId: stepId,
        fromPortKey: previousOutputPort.key,
        toPortKey: inputPort.key,
      });
    }

    appFields.push(...inferOperationAppFields(selection.operationKind, nodeSpec, node.nodeId));

    previousNode = node;
    previousSpec = nodeSpec;
    if (selection.operationKind !== "export" && selection.operationKind !== "output-result") {
      previousOutputPort = chooseOutputPort(nodeSpec, getPreferredOutputKindsForOperation(selection.operationKind));
    } else {
      previousOutputPort = null;
      exportNodeId = node.nodeId;
    }
  }

  graph = {
    ...graph,
    appMode: createDefaultAppModeIR({
      enabled: appFields.length > 0,
      exposureStrategy: appFields.length > 0 ? "manual" : "auto",
      fields: [],
      sections: [],
    }),
  };
  if (appFields.length > 0) {
    graph = setAppModeEnabled(graph, true);
    graph = setAppModeFields(graph, appFields, { exposureStrategy: "manual" as GraphAppModeIR["exposureStrategy"] });
  }
  if (exportNodeId) {
    graph = setGraphOutputs(graph, [exportNodeId]);
  } else if (previousNode) {
    graph = setGraphOutputs(graph, [previousNode.nodeId]);
  }

  return {
    plan: {
      summary: args.request,
      nodes: compiledNodes,
      edges: compiledEdges,
      appModeFields: appFields,
    },
    graph,
  };
}

export function compileWorkflowFromRequest(
  userRequest: string,
  runtime: CompilerRuntime,
): CompilerResult {
  const trace: CompilerTraceEntry[] = [];
  const intent = parseCompilerIntent(userRequest);
  trace.push({ stage: "intent", detail: `domain=${intent.domain} operations=${intent.operations.map((op) => op.kind).join(',')}` });

  if (intent.domain !== "image" && intent.domain !== "video") {
    return CompilerResultSchema.parse({
      ok: false,
      intent,
      error: makeCompilerError("unsupported_domain", "The compiler vertical slice currently supports image and video workflows only."),
      trace,
    });
  }

  const matched = matchCompilerCapabilities(intent, runtime.registry, trace);
  if (matched.ok === false) {
    return CompilerResultSchema.parse({ ok: false, intent, error: matched.error, trace });
  }

  const { plan, graph } = buildCompiledWorkflowPlan({
    registry: runtime.registry,
    selections: matched.selections,
    request: userRequest,
  });
  trace.push({ stage: "compile", detail: `nodes=${plan.nodes.map((node) => node.definitionId).join(',')}` });

  const validation = validateGraph(graph, runtime.registry);
  if (!validation.ok) {
    return CompilerResultSchema.parse({
      ok: false,
      intent,
      error: makeCompilerError("graph_validation_failed", "Compiled graph failed validation.", {
        issues: validation.issues,
      }),
      trace,
    });
  }

  trace.push({ stage: "validate", detail: `graph ok with ${graph.nodes.length} nodes` });
  return CompilerResultSchema.parse({ ok: true, intent, plan, graph, trace });
}
