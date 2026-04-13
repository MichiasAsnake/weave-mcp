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
import { matchImageWorkflowCapabilities } from "./capability-match.ts";
import type { CompiledWorkflowPlan, CompilerAppField, CompilerResult, CompilerRuntime, CompilerTraceEntry } from "./types.ts";

function now(runtime: CompilerRuntime): string {
  return runtime.now ? runtime.now() : new Date().toISOString();
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

function chooseInputPort(nodeSpec: NodeSpec, fromKind: ValueKind): PortSpec {
  const inputPorts = nodeSpec.ports.filter((port) => port.direction === "input");
  const direct = inputPorts.find((port) => (port.accepts || [port.kind]).includes(fromKind));
  if (direct) return direct;
  const anyPort = inputPorts.find((port) => (port.accepts || [port.kind]).includes("any") || port.kind === "any");
  if (anyPort) return anyPort;
  if (inputPorts.length === 1) return inputPorts[0];
  throw new Error(`No input port accepts ${fromKind} on ${nodeSpec.displayName}`);
}

function inferUploadField(_nodeId: string): CompilerAppField | null {
  return null;
}

function buildCompiledWorkflowPlan(args: {
  registry: CompilerRuntime["registry"];
  importDefinitionId: string;
  bridgeDefinitionId: string | null;
  upscaleDefinitionId: string;
  exportDefinitionId: string;
  graphId?: string;
  request: string;
}): { plan: CompiledWorkflowPlan; graph: import('../graph/types.ts').GraphIR } {
  let graph = createEmptyGraphIR({
    registryVersion: args.registry.registryVersion,
    name: "Compiled workflow",
    description: args.request,
    graphId: args.graphId,
  });

  const importSpec = getNodeSpec(args.registry, args.importDefinitionId);
  const importNode = createGraphNodeIR({ nodeId: "uploadImageNode", definitionId: importSpec.source.definitionId, nodeType: importSpec.nodeType, displayName: importSpec.displayName, params: {} });
  graph = addNodeToGraph(graph, importNode);

  const compiledNodes = [{ stepId: "upload", definitionId: importSpec.source.definitionId, nodeId: importNode.nodeId, displayName: importSpec.displayName, purpose: "user upload" }];
  const compiledEdges: CompiledWorkflowPlan["edges"] = [];
  const appFields: CompilerAppField[] = [];
  const uploadField = inferUploadField(importNode.nodeId);
  if (uploadField) appFields.push(uploadField);

  let previousNode = importNode;
  let previousSpec = importSpec;
  let previousOutputPort = chooseOutputPort(importSpec, ["file", "image", "any"]);

  if (args.bridgeDefinitionId) {
    const bridgeSpec = getNodeSpec(args.registry, args.bridgeDefinitionId);
    const bridgeNode = createGraphNodeIR({ nodeId: "fileToImageBridgeNode", definitionId: bridgeSpec.source.definitionId, nodeType: bridgeSpec.nodeType, displayName: bridgeSpec.displayName, params: {} });
    graph = addNodeToGraph(graph, bridgeNode);
    const bridgeInput = chooseInputPort(bridgeSpec, previousOutputPort.kind);
    const bridgeOutput = chooseOutputPort(bridgeSpec, ["image", "any"]);
    graph = addEdgeToGraph(graph, createGraphEdgeIR({ from: { nodeId: previousNode.nodeId, portKey: previousOutputPort.key, valueKind: previousOutputPort.kind }, to: { nodeId: bridgeNode.nodeId, portKey: bridgeInput.key, valueKind: bridgeInput.kind } }));
    compiledNodes.push({ stepId: "bridge", definitionId: bridgeSpec.source.definitionId, nodeId: bridgeNode.nodeId, displayName: bridgeSpec.displayName, purpose: "file to image bridge" });
    compiledEdges.push({ fromStepId: "upload", toStepId: "bridge", fromPortKey: previousOutputPort.key, toPortKey: bridgeInput.key });
    previousNode = bridgeNode;
    previousSpec = bridgeSpec;
    previousOutputPort = bridgeOutput;
  }

  const upscaleSpec = getNodeSpec(args.registry, args.upscaleDefinitionId);
  const upscaleNode = createGraphNodeIR({ nodeId: "upscaleImageNode", definitionId: upscaleSpec.source.definitionId, nodeType: upscaleSpec.nodeType, displayName: upscaleSpec.displayName, params: {} });
  graph = addNodeToGraph(graph, upscaleNode);
  const upscaleInput = chooseInputPort(upscaleSpec, previousOutputPort.kind);
  const upscaleOutput = chooseOutputPort(upscaleSpec, ["image", "file", "any"]);
  graph = addEdgeToGraph(graph, createGraphEdgeIR({ from: { nodeId: previousNode.nodeId, portKey: previousOutputPort.key, valueKind: previousOutputPort.kind }, to: { nodeId: upscaleNode.nodeId, portKey: upscaleInput.key, valueKind: upscaleInput.kind } }));
  compiledNodes.push({ stepId: "upscale", definitionId: upscaleSpec.source.definitionId, nodeId: upscaleNode.nodeId, displayName: upscaleSpec.displayName, purpose: "image upscale" });
  compiledEdges.push({ fromStepId: args.bridgeDefinitionId ? "bridge" : "upload", toStepId: "upscale", fromPortKey: previousOutputPort.key, toPortKey: upscaleInput.key });

  const exportSpec = getNodeSpec(args.registry, args.exportDefinitionId);
  const exportNode = createGraphNodeIR({ nodeId: "exportResultNode", definitionId: exportSpec.source.definitionId, nodeType: exportSpec.nodeType, displayName: exportSpec.displayName, params: {} });
  graph = addNodeToGraph(graph, exportNode);
  const exportInput = chooseInputPort(exportSpec, upscaleOutput.kind);
  graph = addEdgeToGraph(graph, createGraphEdgeIR({ from: { nodeId: upscaleNode.nodeId, portKey: upscaleOutput.key, valueKind: upscaleOutput.kind }, to: { nodeId: exportNode.nodeId, portKey: exportInput.key, valueKind: exportInput.kind } }));
  compiledNodes.push({ stepId: "export", definitionId: exportSpec.source.definitionId, nodeId: exportNode.nodeId, displayName: exportSpec.displayName, purpose: "export result" });
  compiledEdges.push({ fromStepId: "upscale", toStepId: "export", fromPortKey: upscaleOutput.key, toPortKey: exportInput.key });

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
  graph = setGraphOutputs(graph, [exportNode.nodeId]);

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

  if (intent.domain !== "image") {
    return CompilerResultSchema.parse({
      ok: false,
      intent,
      error: makeCompilerError("unsupported_domain", "The compiler vertical slice currently supports image workflows only."),
      trace,
    });
  }

  const matched = matchImageWorkflowCapabilities(intent, runtime.registry, trace);
  if (matched.ok === false) {
    const error = matched.error;
    return CompilerResultSchema.parse({ ok: false, intent, error, trace });
  }

  const [importSelection, maybeBridgeSelection, upscaleSelection, exportSelection] = matched.selections;
  const hasBridge = matched.selections.length === 4;
  const bridgeSelection = hasBridge ? maybeBridgeSelection : null;
  const realUpscaleSelection = hasBridge ? upscaleSelection : maybeBridgeSelection;
  const realExportSelection = hasBridge ? exportSelection : upscaleSelection;

  const { plan, graph } = buildCompiledWorkflowPlan({
    registry: runtime.registry,
    importDefinitionId: importSelection.definitionIds[0],
    bridgeDefinitionId: bridgeSelection?.definitionIds[0] || null,
    upscaleDefinitionId: realUpscaleSelection.definitionIds[0],
    exportDefinitionId: realExportSelection.definitionIds[0],
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
