import {
  addEdgeToGraph,
  addNodeToGraph,
  createEmptyGraphIR,
  createGraphEdgeIR,
  createGraphNodeIR,
  setGraphOutputs,
} from "../graph/builders.ts";
import { createDefaultAppModeIR, setAppModeEnabled, setAppModeFields } from "../graph/app-mode.ts";
import type { GraphAppModeIR, GraphNodeIR } from "../graph/types.ts";
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

interface OutputSource {
  stepId: string;
  nodeId: string;
  portKey: string;
  valueKind: ValueKind;
}

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

function chooseSourceForInputPort(port: PortSpec, sources: Map<ValueKind, OutputSource>, lastSource: OutputSource | null): OutputSource | null {
  const acceptedKinds = port.accepts || [port.kind];

  for (const acceptedKind of acceptedKinds) {
    if (acceptedKind === "any") {
      if (lastSource) return lastSource;
      continue;
    }
    const source = sources.get(acceptedKind);
    if (source) return source;
  }

  if (port.kind === "any" && lastSource) {
    return lastSource;
  }

  return null;
}

function inferOperationAppFields(
  operationKind: CompilerOperationKind,
  nodeSpec: NodeSpec,
  nodeId: string,
  connectedInputKeys: Set<string>,
): CompilerAppField[] {
  if (!["enhance-prompt", "edit-image", "generate-image", "generate-video"].includes(operationKind)) {
    return [];
  }

  const promptPort = nodeSpec.ports.find((port) =>
    port.direction === "input"
    && port.required
    && !connectedInputKeys.has(port.key)
    && ((port.accepts || [port.kind]).includes("text") || port.kind === "text")
    && /prompt|instruction|text/.test(port.key.toLowerCase()),
  ) || nodeSpec.ports.find((port) =>
    port.direction === "input"
    && port.required
    && !connectedInputKeys.has(port.key)
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
    helpText: operationKind === "edit-image"
      ? "Describe how the uploaded image should be edited."
      : operationKind === "enhance-prompt"
        ? "Describe what should be generated; the workflow will enhance this prompt before running the model."
        : "Describe what should be generated.",
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
    case "enhance-prompt":
      return ["text", "any"];
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
    case "enhance-prompt":
      return occurrence === 1 ? "enhance-prompt" : `enhance-prompt-${occurrence}`;
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
    case "enhance-prompt":
      return occurrence === 1 ? "enhancePromptNode" : `enhancePromptNode${occurrence}`;
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
    case "enhance-prompt":
      return "prompt enhancement";
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
  const latestSourceByKind = new Map<ValueKind, OutputSource>();

  let latestProducedSource: OutputSource | null = null;
  let latestNode: GraphNodeIR | null = null;
  let terminalNodeId: string | null = null;

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

    const connectedInputKeys = new Set<string>();
    for (const inputPort of nodeSpec.ports.filter((port) => port.direction === "input" && port.required)) {
      const source = chooseSourceForInputPort(inputPort, latestSourceByKind, latestProducedSource);
      if (!source) {
        continue;
      }
      connectedInputKeys.add(inputPort.key);
      graph = addEdgeToGraph(
        graph,
        createGraphEdgeIR({
          from: { nodeId: source.nodeId, portKey: source.portKey, valueKind: source.valueKind },
          to: { nodeId: node.nodeId, portKey: inputPort.key, valueKind: inputPort.kind },
        }),
      );
      compiledEdges.push({
        fromStepId: source.stepId,
        toStepId: stepId,
        fromPortKey: source.portKey,
        toPortKey: inputPort.key,
      });
    }

    appFields.push(...inferOperationAppFields(selection.operationKind, nodeSpec, node.nodeId, connectedInputKeys));

    latestNode = node;
    if (selection.operationKind !== "export" && selection.operationKind !== "output-result") {
      const outputPort = chooseOutputPort(nodeSpec, getPreferredOutputKindsForOperation(selection.operationKind));
      latestProducedSource = {
        stepId,
        nodeId: node.nodeId,
        portKey: outputPort.key,
        valueKind: outputPort.kind,
      };
      for (const producedKind of outputPort.produces || [outputPort.kind]) {
        latestSourceByKind.set(producedKind, latestProducedSource);
      }
    } else {
      terminalNodeId = node.nodeId;
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
  if (terminalNodeId) {
    graph = setGraphOutputs(graph, [terminalNodeId]);
  } else if (latestNode) {
    graph = setGraphOutputs(graph, [latestNode.nodeId]);
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
