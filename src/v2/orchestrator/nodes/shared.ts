// @ts-nocheck
import { randomUUID } from "node:crypto";
import { generateObject, stepCountIs, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

import { createEmptyGraphIR } from "../../graph/builders.ts";
import type { GraphIR } from "../../graph/types.ts";
import {
  buildRegistryDefinitionCatalogForLLM as buildCapabilityDefinitionCatalogForLLM,
  getBridgeDefinitionIdsForKinds,
  getPreferredDefinitionIdsForStep as getCapabilityPreferredDefinitionIdsForStep,
  isCompatibleExportNodeForStep,
} from "../../registry/capabilities.ts";
import { readLatestNormalizedRegistrySnapshot } from "../../registry/store.ts";
import type { NormalizedRegistrySnapshot, NodeSpec, PortSpec, ValueKind } from "../../registry/types.ts";
import {
  ConnectPortsToolInputSchema,
  CreateNodeToolLLMInputSchema,
  DisconnectEdgeToolInputSchema,
  RemoveNodeToolInputSchema,
  SetAppModeFieldToolLLMInputSchema,
  SetNodeParamToolLLMInputSchema,
  SetOutputsToolInputSchema,
} from "../../tools/types.ts";
import {
  connectPortsTool,
  createNodeTool,
  disconnectEdgeTool,
  removeNodeTool,
  setAppModeFieldTool,
  setNodeParamTool,
  setOutputsTool,
} from "../../tools/index.ts";
import type { ToolResult } from "../../tools/types.ts";
import { validateGraph } from "../../validate/index.ts";
import type { ValidationResult } from "../../validate/types.ts";
import { appendGraphRevision, loadGraphRevisions, loadOrchestratorSession, upsertOrchestratorSession } from "../../db/repository.ts";
import {
  GraphBuildPlanSchema,
  InterpretedIntentSchema,
  OrchestratorCheckpointRecordSchema,
  OrchestratorMessageRecordSchema,
  OrchestratorReviewResultSchema,
  OrchestratorStateSchema,
  OrchestratorToolCallSchema,
  TemplateCandidateSchema,
  type AppliedToolCall,
  type ContextArtifact,
  type GraphHistoryEntry,
  type OrchestratorCheckpointRecord,
  type OrchestratorMessageRecord,
  type OrchestratorRuntime,
  type OrchestratorState,
  type OrchestratorToolCall,
  type TemplateCandidate,
} from "../types.ts";

export function getNow(runtime: OrchestratorRuntime): string {
  return runtime.now ? runtime.now() : new Date().toISOString();
}

export function appendMessage(
  state: OrchestratorState,
  message: Omit<OrchestratorMessageRecord, "createdAt">,
  runtime: OrchestratorRuntime,
): OrchestratorMessageRecord[] {
  return [
    ...state.messages,
    OrchestratorMessageRecordSchema.parse({
      ...message,
      createdAt: getNow(runtime),
    }),
  ];
}

export function appendCheckpoint(
  state: OrchestratorState,
  checkpoint: Omit<OrchestratorCheckpointRecord, "recordedAt" | "revisionCount"> & {
    note?: string;
  },
  runtime: OrchestratorRuntime,
): OrchestratorCheckpointRecord[] {
  return [
    ...state.checkpoints,
    OrchestratorCheckpointRecordSchema.parse({
      ...checkpoint,
      recordedAt: getNow(runtime),
      revisionCount: state.revisionCount,
    }),
  ];
}

export async function persistState(
  runtime: OrchestratorRuntime,
  state: OrchestratorState,
): Promise<void> {
  await upsertOrchestratorSession(runtime.pool, OrchestratorStateSchema.parse(state));
}

export async function loadPersistedState(
  runtime: OrchestratorRuntime,
  sessionId: string,
): Promise<OrchestratorState | null> {
  const session = await loadOrchestratorSession(runtime.pool, sessionId);
  if (!session) {
    return null;
  }

  const graphHistory = await loadGraphRevisions(runtime.pool, sessionId);
  return OrchestratorStateSchema.parse({
    ...session.state,
    graphHistory,
  });
}

export async function loadRegistrySnapshot(
  runtime: OrchestratorRuntime,
): Promise<NormalizedRegistrySnapshot> {
  const snapshot = runtime.loadRegistrySnapshot
    ? await runtime.loadRegistrySnapshot()
    : await readLatestNormalizedRegistrySnapshot();
  return snapshot;
}

export function summarizeRegistryForLLM(
  registry: NormalizedRegistrySnapshot,
  limit = 24,
): Record<string, unknown> {
  const sample = registry.nodeSpecs.slice(0, limit).map((nodeSpec) => ({
    definitionId: nodeSpec.source.definitionId,
    nodeType: nodeSpec.nodeType,
    displayName: nodeSpec.displayName,
    category: nodeSpec.category,
    subtype: nodeSpec.subtype,
    inputs: nodeSpec.ports
      .filter((port) => port.direction === "input")
      .map((port) => ({
        key: port.key,
        kind: port.kind,
        required: port.required,
      })),
    outputs: nodeSpec.ports
      .filter((port) => port.direction === "output")
      .map((port) => ({
        key: port.key,
        kind: port.kind,
      })),
    params: nodeSpec.params.map((param) => ({
      key: param.key,
      kind: param.kind,
      required: param.required,
    })),
  }));

  return {
    registryVersion: registry.registryVersion,
    nodeSpecCount: registry.nodeSpecs.length,
    warningCount: registry.warnings.length,
    sampleNodeSpecs: sample,
  };
}

export function buildRegistryDefinitionCatalogForLLM(
  registry: NormalizedRegistrySnapshot,
): string {
  return buildCapabilityDefinitionCatalogForLLM(registry);
}

function getRequiredInputPorts(nodeSpec: NodeSpec): PortSpec[] {
  return nodeSpec.ports.filter((port) => port.direction === "input" && port.required);
}

function getOutputPorts(nodeSpec: NodeSpec): PortSpec[] {
  return nodeSpec.ports.filter((port) => port.direction === "output");
}

function getRequiredInputKinds(nodeSpec: NodeSpec): ValueKind[] {
  return getRequiredInputPorts(nodeSpec).map((port) => port.kind);
}

function getOutputKinds(nodeSpec: NodeSpec): ValueKind[] {
  return getOutputPorts(nodeSpec).map((port) => port.kind);
}

function getStepIntentText(step: { summary: string; expectedOutputs: string[] }): string {
  return `${step.summary} ${step.expectedOutputs.join(" ")}`.toLowerCase();
}

function stepLooksLikeUpload(step: { summary: string; expectedOutputs: string[] }): boolean {
  const text = getStepIntentText(step);
  return /upload|import/.test(text) || (text.includes("file") && text.includes("image"));
}

function stepLooksLikeUpscale(step: { summary: string; expectedOutputs: string[] }): boolean {
  return /\bupscale\b|\bupscaling\b/.test(getStepIntentText(step));
}

function stepLooksLikeExport(step: { summary: string; expectedOutputs: string[] }): boolean {
  return /export|save|download/.test(getStepIntentText(step));
}

function isUploadSourceNodeSpec(nodeSpec: NodeSpec): boolean {
  const text = `${nodeSpec.displayName} ${nodeSpec.nodeType} ${nodeSpec.category || ""} ${nodeSpec.subtype || ""}`.toLowerCase();
  return getRequiredInputPorts(nodeSpec).length === 0
    && getOutputKinds(nodeSpec).includes("file")
    && /file|import|upload/.test(text);
}

function isImageOnlyUpscalerNodeSpec(nodeSpec: NodeSpec): boolean {
  const requiredKinds = getRequiredInputKinds(nodeSpec);
  return nodeSpec.displayName.toLowerCase().includes("upscale")
    && requiredKinds.length === 1
    && requiredKinds[0] === "image"
    && getOutputKinds(nodeSpec).includes("image");
}

function isFileToImageBridgeNodeSpec(nodeSpec: NodeSpec): boolean {
  const requiredKinds = getRequiredInputKinds(nodeSpec);
  return requiredKinds.length === 1
    && requiredKinds[0] === "file"
    && getOutputKinds(nodeSpec).includes("image")
    && !nodeSpec.params.some((param) => param.required);
}

function isImageToFileExporterNodeSpec(nodeSpec: NodeSpec): boolean {
  const requiredKinds = getRequiredInputKinds(nodeSpec);
  return requiredKinds.length === 1
    && requiredKinds[0] === "image"
    && getOutputKinds(nodeSpec).includes("file");
}

function isFileExportNodeSpec(nodeSpec: NodeSpec): boolean {
  const inputPorts = nodeSpec.ports.filter((port) => port.direction === "input");
  return `${nodeSpec.displayName} ${nodeSpec.nodeType}`.toLowerCase().includes("export")
    && inputPorts.some((port) => port.kind === "file");
}

function rankNodeSpecIds(
  registry: NormalizedRegistrySnapshot,
  predicate: (nodeSpec: NodeSpec) => boolean,
  score: (nodeSpec: NodeSpec) => number,
): string[] {
  return registry.nodeSpecs
    .filter(predicate)
    .sort((left, right) => score(right) - score(left))
    .map((nodeSpec) => nodeSpec.source.definitionId);
}

export function getPreferredDefinitionIdsForStep(
  step: { summary: string; expectedOutputs: string[] },
  registry: NormalizedRegistrySnapshot,
  options: { availableKinds?: Iterable<ValueKind>; requestText?: string } = {},
): string[] {
  return getCapabilityPreferredDefinitionIdsForStep(step, registry, options);
}

export function constrainPlanStepDefinitionIds(
  step: { summary: string; expectedOutputs: string[]; nodeDefinitionIds: string[] },
  registry: NormalizedRegistrySnapshot,
  options: { availableKinds?: Iterable<ValueKind>; requestText?: string } = {},
): { nodeDefinitionIds: string[]; replacementReason?: string } {
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );
  const currentNodeSpecs = step.nodeDefinitionIds
    .map((definitionId) => nodeSpecByDefinitionId.get(definitionId))
    .filter(Boolean) as NodeSpec[];

  if (currentNodeSpecs.some(isFileToImageBridgeNodeSpec)) {
    return { nodeDefinitionIds: step.nodeDefinitionIds };
  }

  if (stepLooksLikeUpscale(step)) {
    if (currentNodeSpecs.some(isImageOnlyUpscalerNodeSpec)) {
      return { nodeDefinitionIds: step.nodeDefinitionIds };
    }

    const preferred = getPreferredDefinitionIdsForStep(step, registry, options);
    if (preferred.length > 0) {
      return {
        nodeDefinitionIds: preferred,
        replacementReason: `preferred a dependency-light upscale node for \`${step.summary}\``,
      };
    }
  }

  if (stepLooksLikeExport(step)) {
    if (currentNodeSpecs.some((nodeSpec) => isCompatibleExportNodeForStep(nodeSpec, step, options))) {
      return { nodeDefinitionIds: step.nodeDefinitionIds };
    }

    const preferred = getPreferredDefinitionIdsForStep(step, registry, options);
    if (preferred.length > 0) {
      if (
        preferred.some((definitionId) => !step.nodeDefinitionIds.includes(definitionId))
      ) {
        return {
          nodeDefinitionIds: preferred,
          replacementReason: `preferred an export-capable image output node for \`${step.summary}\``,
        };
      }
    }

    if (currentNodeSpecs.length > 0) {
      return {
        nodeDefinitionIds: [],
        replacementReason: `removed incompatible export candidate(s) for \`${step.summary}\` because the registry has no exporter compatible with the requested format constraint`,
      };
    }
  }

  if (step.nodeDefinitionIds.length === 0) {
    const preferred = getPreferredDefinitionIdsForStep(step, registry, options);
    if (preferred.length > 0) {
      return {
        nodeDefinitionIds: preferred,
        replacementReason: `filled missing definitionId(s) for \`${step.summary}\` from constrained registry candidates`,
      };
    }
  }

  return { nodeDefinitionIds: step.nodeDefinitionIds };
}

function getGraphOutputKinds(
  graph: GraphIR | undefined,
  registry: NormalizedRegistrySnapshot,
): Set<ValueKind> {
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );
  const kinds = new Set<ValueKind>();

  for (const node of graph?.nodes || []) {
    const nodeSpec = nodeSpecByDefinitionId.get(node.definitionId);
    for (const port of nodeSpec?.ports || []) {
      if (port.direction === "output") {
        kinds.add(port.kind);
      }
    }
  }

  return kinds;
}

export function buildGraphNodeTableForLLM(
  graph: GraphIR | undefined,
  registry: NormalizedRegistrySnapshot,
): string {
  if (!graph || graph.nodes.length === 0) {
    return "- (no nodes yet)";
  }

  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );

  return graph.nodes.map((node) => {
    const nodeSpec = nodeSpecByDefinitionId.get(node.definitionId);
    const outputPorts = nodeSpec?.ports
      .filter((port) => port.direction === "output")
      .map((port) => `${port.key}:${port.kind}`)
      .join(", ") || "none";
    const inputPorts = nodeSpec?.ports
      .filter((port) => port.direction === "input")
      .map((port) => `${port.key}:${port.kind}${port.required ? "*" : ""}`)
      .join(", ") || "none";

    return `- ${node.nodeId} | ${node.definitionId} | ${node.displayName} | inputs=${inputPorts} | outputs=${outputPorts}`;
  }).join("\n");
}

interface RegistryCandidateCatalogEntry {
  definitionId: string;
  displayName: string;
  nodeType: string;
  reason: string;
}

function buildConstrainedRegistryCandidateEntriesForState(
  state: Pick<OrchestratorState, "plan" | "workingGraph" | "userRequest">,
  registry: NormalizedRegistrySnapshot,
): RegistryCandidateCatalogEntry[] {
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );
  const entries = new Map<string, RegistryCandidateCatalogEntry>();
  const pushEntry = (definitionId: string, reason: string) => {
    const nodeSpec = nodeSpecByDefinitionId.get(definitionId);
    if (!nodeSpec) {
      return;
    }

    const existing = entries.get(definitionId);
    if (existing) {
      if (!existing.reason.includes(reason)) {
        existing.reason = `${existing.reason}; ${reason}`;
      }
      return;
    }

    entries.set(definitionId, {
      definitionId,
      displayName: nodeSpec.displayName,
      nodeType: nodeSpec.nodeType,
      reason,
    });
  };

  const remainingSteps = getRemainingPlannedSteps(state);
  const availableKinds = getGraphOutputKinds(state.workingGraph, registry);

  for (const step of remainingSteps) {
    const constrainedStep = constrainPlanStepDefinitionIds(step, registry, {
      availableKinds,
      requestText: state.userRequest,
    });
    const candidateIds = constrainedStep.nodeDefinitionIds.length > 0
      ? constrainedStep.nodeDefinitionIds
      : getPreferredDefinitionIdsForStep(step, registry, {
          availableKinds,
          requestText: state.userRequest,
        });

    for (const definitionId of candidateIds) {
      pushEntry(definitionId, `planned step ${step.stepId}`);
    }
  }

  if (remainingSteps.some((step) => stepLooksLikeUpscale(step)) && availableKinds.has("file") && !availableKinds.has("image")) {
    for (const definitionId of getBridgeDefinitionIdsForKinds(registry, "file", "image", 2)) {
      pushEntry(definitionId, "bridge file -> image");
    }
  }

  return Array.from(entries.values());
}

export function buildConstrainedRegistryDefinitionCatalogForLLM(
  state: Pick<OrchestratorState, "plan" | "workingGraph" | "userRequest">,
  registry: NormalizedRegistrySnapshot,
): string {
  const entries = buildConstrainedRegistryCandidateEntriesForState(state, registry);
  if (entries.length === 0) {
    return "";
  }

  return buildCapabilityDefinitionCatalogForLLM(registry, {
    definitionIds: entries.map((entry) => entry.definitionId),
  })
    .split("\n")
    .map((line) => {
      const definitionId = line.split(" ")[1];
      const entry = entries.find((candidate) => candidate.definitionId === definitionId);
      return entry ? line + ` | reason=${entry.reason}` : line;
    })
    .join("\n");
}

function getAllowedCandidateDefinitionIdsForState(
  state: Pick<OrchestratorState, "plan" | "workingGraph" | "userRequest">,
  registry: NormalizedRegistrySnapshot,
): Set<string> {
  return new Set(
    buildConstrainedRegistryCandidateEntriesForState(state, registry).map((entry) => entry.definitionId),
  );
}

export function getRemainingPlannedSteps(
  state: Pick<OrchestratorState, "plan" | "workingGraph">,
): Array<{ stepId: string; summary: string; nodeDefinitionIds: string[]; expectedOutputs: string[] }> {
  if (!state.plan) {
    return [];
  }

  const graphDefinitionIds = new Set((state.workingGraph?.nodes || []).map((node) => node.definitionId));

  return state.plan.steps
    .filter((step) => step.nodeDefinitionIds.length > 0)
    .filter((step) => !step.nodeDefinitionIds.some((definitionId) => graphDefinitionIds.has(definitionId)))
    .map((step) => ({
      stepId: step.stepId,
      summary: step.summary,
      nodeDefinitionIds: step.nodeDefinitionIds,
      expectedOutputs: step.expectedOutputs,
    }));
}

export function hasUsablePlannedSteps(
  state: Pick<OrchestratorState, "plan">,
): boolean {
  return Boolean(state.plan?.steps.some((step) => step.nodeDefinitionIds.length > 0));
}

export function findUnsupportedPlannedExportStep(
  state: Pick<OrchestratorState, "plan" | "workingGraph" | "userRequest">,
  registry: NormalizedRegistrySnapshot,
): { stepId: string; summary: string; reason: string } | null {
  if (!state.plan) {
    return null;
  }

  const availableKinds = getGraphOutputKinds(state.workingGraph, registry);
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );

  for (const step of state.plan.steps) {
    if (!stepLooksLikeExport(step)) {
      continue;
    }

    const graphAlreadyHasCompatibleExporter = (state.workingGraph?.nodes || []).some((node) => {
      const nodeSpec = nodeSpecByDefinitionId.get(node.definitionId);
      return Boolean(nodeSpec && isCompatibleExportNodeForStep(nodeSpec, step, {
        availableKinds,
        requestText: state.userRequest,
      }));
    });

    if (graphAlreadyHasCompatibleExporter) {
      continue;
    }

    const compatibleDefinitionIds = getPreferredDefinitionIdsForStep(step, registry, {
      availableKinds,
      requestText: state.userRequest,
    });

    if (compatibleDefinitionIds.length === 0) {
      return {
        stepId: step.stepId,
        summary: step.summary,
        reason: "registry lacks an export node compatible with the requested output-format constraint",
      };
    }
  }

  return null;
}

export function summarizeGraphForLLM(
  graph: GraphIR | undefined,
  registry: NormalizedRegistrySnapshot | undefined,
): Record<string, unknown> | null {
  if (!graph) {
    return null;
  }

  const nodeSpecs = new Map(
    (registry?.nodeSpecs || []).map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );

  return {
    graphId: graph.metadata.graphId,
    name: graph.metadata.name,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    outputNodeIds: graph.outputs.nodeIds,
    appMode: {
      enabled: graph.appMode.enabled,
      exposureStrategy: graph.appMode.exposureStrategy,
      fields: graph.appMode.fields.map((field) => ({
        key: field.key,
        label: field.label,
        source: field.source,
        control: field.control,
      })),
    },
    nodes: graph.nodes.map((node) => {
      const nodeSpec = nodeSpecs.get(node.definitionId);
      return {
        nodeId: node.nodeId,
        definitionId: node.definitionId,
        nodeType: node.nodeType,
        displayName: node.displayName,
        paramKeys: Object.keys(node.params),
        scalarParams: Object.fromEntries(
          Object.entries(node.params).filter(([, value]) =>
            ["string", "number", "boolean"].includes(typeof value),
          ),
        ),
        inputs: summarizePorts(nodeSpec, "input"),
        outputs: summarizePorts(nodeSpec, "output"),
      };
    }),
    edges: graph.edges.map((edge) => ({
      edgeId: edge.edgeId,
      from: edge.from,
      to: edge.to,
    })),
  };
}

function summarizePorts(
  nodeSpec: NodeSpec | undefined,
  direction: PortSpec["direction"],
): Array<{ key: string; kind: string; required?: boolean }> {
  if (!nodeSpec) {
    return [];
  }

  return nodeSpec.ports
    .filter((port) => port.direction === direction)
    .map((port) => ({
      key: port.key,
      kind: port.kind,
      required: direction === "input" ? port.required : undefined,
    }));
}

export function summarizeValidationForLLM(
  validationResult: ValidationResult | undefined,
): Record<string, unknown> | null {
  if (!validationResult) {
    return null;
  }

  return {
    ok: validationResult.ok,
    errorCount: validationResult.errorCount,
    warningCount: validationResult.warningCount,
    issues: validationResult.issues.map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      context: issue.context,
    })),
  };
}

export async function generateStructuredOutput<T>(args: {
  runtime: OrchestratorRuntime;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  tools?: ReturnType<typeof buildPlanningTools>;
  maxSteps?: number;
}): Promise<T> {
  const result = await generateObject({
    model: args.runtime.model,
    system: args.system,
    prompt: args.prompt,
    tools: args.tools,
    stopWhen: stepCountIs(args.maxSteps ?? 2),
    schema: args.schema,
  });

  return args.schema.parse(result.object);
}

export function buildPlanningTools() {
  return {
    createNode: tool({
      description: "Create a new graph node from a registry definition.",
      inputSchema: CreateNodeToolLLMInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
    setNodeParam: tool({
      description: "Set or update a node parameter by key.",
      inputSchema: SetNodeParamToolLLMInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
    connectPorts: tool({
      description: "Connect one node output port to another node input port.",
      inputSchema: ConnectPortsToolInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
    disconnectEdge: tool({
      description: "Disconnect an existing edge by edgeId.",
      inputSchema: DisconnectEdgeToolInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
    removeNode: tool({
      description: "Remove a node and any connected edges.",
      inputSchema: RemoveNodeToolInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
    setOutputs: tool({
      description: "Mark one or more nodeIds as graph outputs.",
      inputSchema: SetOutputsToolInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
    setAppModeField: tool({
      description: "Create or update a field exposed through App Mode.",
      inputSchema: SetAppModeFieldToolLLMInputSchema,
      execute: async (input) => ({ acknowledged: true, input }),
    }),
  };
}

export function applyToolCall(
  graph: GraphIR,
  registry: NormalizedRegistrySnapshot,
  toolCall: OrchestratorToolCall,
  options: { skipGraphValidation?: boolean } = {},
): ToolResult {
  switch (toolCall.toolName) {
    case "create-node":
      return createNodeTool(graph, registry, toolCall.input, options);
    case "set-node-param":
      return setNodeParamTool(graph, registry, toolCall.input, options);
    case "connect-ports":
      return connectPortsTool(graph, registry, toolCall.input, options);
    case "disconnect-edge":
      return disconnectEdgeTool(graph, registry, toolCall.input, options);
    case "remove-node":
      return removeNodeTool(graph, registry, toolCall.input, options);
    case "set-outputs":
      return setOutputsTool(graph, registry, toolCall.input, options);
    case "set-app-mode-field":
      return setAppModeFieldTool(graph, registry, toolCall.input, options);
    default: {
      const exhaustive: never = toolCall;
      throw new Error(`Unhandled tool call: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function issuesToAppliedToolCall(
  toolCall: OrchestratorToolCall,
  result: ToolResult,
  runtime: OrchestratorRuntime,
): AppliedToolCall {
  return {
    toolCall: OrchestratorToolCallSchema.parse(toolCall),
    applied: result.applied,
    issueCodes: result.issues.map((issue) => issue.code),
    appliedAt: getNow(runtime),
  };
}

export function createGraphIfMissing(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): GraphIR {
  if (state.workingGraph) {
    return state.workingGraph;
  }

  if (!state.registryVersion) {
    throw new Error("Cannot create a working graph before registryVersion is loaded.");
  }

  return createEmptyGraphIR({
    registryVersion: state.registryVersion,
    name: state.interpretedIntent?.goalSummary || "Draft Workflow",
    description: state.userRequest,
    sourceTemplateId: state.selectedTemplateId,
  });
}

export function pushGraphHistoryEntry(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
  args: {
    graph: GraphIR;
    validationResult?: ValidationResult;
    reviewResult?: z.infer<typeof OrchestratorReviewResultSchema>;
    note?: string;
    incrementRevisionIndex?: boolean;
  },
): { graphHistory: GraphHistoryEntry[]; graphRevisionIndex: number; entry: GraphHistoryEntry } {
  const revisionIndex = args.incrementRevisionIndex === false
    ? state.graphRevisionIndex
    : state.graphRevisionIndex + 1;

  const entry: GraphHistoryEntry = {
    revisionIndex,
    graph: args.graph,
    validationResult: args.validationResult,
    reviewResult: args.reviewResult,
    note: args.note,
    createdAt: getNow(runtime),
  };

  return {
    graphHistory: [...state.graphHistory, entry],
    graphRevisionIndex: revisionIndex,
    entry,
  };
}

export async function persistGraphRevisionEntry(
  runtime: OrchestratorRuntime,
  state: OrchestratorState,
  entry: GraphHistoryEntry,
): Promise<void> {
  await appendGraphRevision(runtime.pool, state.sessionId, entry);
}

export function fingerprintValidation(validationResult: ValidationResult | undefined): string {
  if (!validationResult || validationResult.issues.length === 0) {
    return "";
  }

  return validationResult.issues
    .map((issue) => `${issue.severity}:${issue.code}:${JSON.stringify(issue.context)}`)
    .sort()
    .join("|");
}

export function hasNoProgressAfterTwoCycles(graphHistory: GraphHistoryEntry[]): boolean {
  const failedEntries = graphHistory.filter(
    (entry) => entry.validationResult && !entry.validationResult.ok,
  );

  if (failedEntries.length < 3) {
    return false;
  }

  const recent = failedEntries.slice(-3).map((entry) =>
    fingerprintValidation(entry.validationResult),
  );

  return recent[0] !== "" && recent.every((fingerprint) => fingerprint === recent[0]);
}

export function buildContextArtifacts(state: OrchestratorState): ContextArtifact[] {
  const artifacts: ContextArtifact[] = [];

  if (state.currentGraph) {
    artifacts.push({
      kind: "session",
      id: state.currentGraph.metadata.graphId,
      summary: `Existing session graph with ${state.currentGraph.nodes.length} node(s) and ${state.currentGraph.edges.length} edge(s).`,
    });
  }

  if (state.selectedTemplateId) {
    artifacts.push({
      kind: "template",
      id: state.selectedTemplateId,
      summary: `Selected template ${state.selectedTemplateId} as the starting point.`,
    });
  }

  return artifacts;
}

export async function getTemplateCandidates(
  runtime: OrchestratorRuntime,
  state: OrchestratorState,
): Promise<TemplateCandidate[]> {
  const candidates = runtime.retrieveTemplateCandidates
    ? await runtime.retrieveTemplateCandidates(state)
    : [];
  return candidates.map((candidate) => TemplateCandidateSchema.parse(candidate));
}

export function buildInterpretIntentPrompt(state: OrchestratorState): string {
  return [
    `User request: ${state.userRequest}`,
    "",
    "Interpret the request into a graph-authoring intent.",
    "Return request mode, output goals, constraints, whether App Mode is required, and whether to reuse/modify/scratch-build.",
  ].join("\n");
}

export function buildPlanPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  const registryCatalog = buildRegistryDefinitionCatalogForLLM(registry);

  return [
    `User request: ${state.userRequest}`,
    "",
    `Interpreted intent: ${JSON.stringify(state.interpretedIntent, null, 2)}`,
    "",
    `Context artifacts: ${JSON.stringify(state.contextArtifacts, null, 2)}`,
    "",
    `Registry overview: ${JSON.stringify({
      registryVersion: registry.registryVersion,
      nodeSpecCount: registry.nodeSpecs.length,
      warningCount: registry.warnings.length,
    }, null, 2)}`,
    "",
    "## Available Node Definitions (copy definitionId exactly)",
    "```text",
    registryCatalog,
    "```",
    "",
    "Create a stepwise plan for building or modifying the graph. Do not emit raw Weave payloads.",
    "Every entry in `steps[].nodeDefinitionIds` MUST be an exact `definitionId` copied from the available node definitions above.",
    "Do NOT emit display names, categories, or invented placeholders inside `nodeDefinitionIds`.",
    "If you cannot identify a valid definitionId for a step, return an empty array for that step's `nodeDefinitionIds` instead of guessing.",
    "If the request includes a specific output format or a user-chosen format constraint, preserve that constraint explicitly in the export step summary and expectedOutputs.",
    "Do not substitute a fixed-format exporter unless the catalog explicitly shows that its `fileExport=` metadata matches the requested format.",
  ].join("\n");
}

export function buildDraftPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  const registryCatalog = buildConstrainedRegistryDefinitionCatalogForLLM(state, registry);
  const graphNodeTable = buildGraphNodeTableForLLM(state.workingGraph, registry);

  return [
    `User request: ${state.userRequest}`,
    "",
    `Plan: ${JSON.stringify(state.plan, null, 2)}`,
    "",
    `Working graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    "## Graph Nodes Available For Wiring (use nodeId, not definitionId)",
    "```text",
    graphNodeTable,
    "```",
    "",
    "## Constrained Candidate Node Definitions (copy definitionId exactly)",
    "```text",
    registryCatalog,
    "```",
    "",
    "Draft the next atomic tool calls needed to move the graph toward completion.",
    "Only propose tool calls that can be executed by the atomic tool layer.",
    "",
    "IMPORTANT: You MUST emit at least one tool call in `proposedToolCalls`. Returning an empty array is treated as a failure. Work from `Plan.steps` and emit one or more `create-node` / `connect-ports` calls that implement the next unbuilt step(s).",
    "Use ONLY the constrained candidate definitionIds above for `create-node`. If a needed step is not represented there, emit bridge nodes from that candidate set before wiring the final step.",
    "Never use a display name, category name, or invented placeholder where a `definitionId` is required.",
    "Treat `fileExport=fixed(...)` nodes as format-specific. Do not use them for user-chosen or mismatched output-format requests.",
    "",
    "## create-node",
    "REQUIRED fields (all three MUST be non-null strings):",
    "- `definitionId`: MUST be one of the exact definitionId strings from the constrained candidate list above. Copy it exactly.",
    "- `displayName`: MUST be the exact displayName from the registry for that definitionId.",
    "- `params`: array of `{ key, value }` entries matching the node's paramSchema, or empty array `[]` if none.",
    "- If you will reference the new node later in the same batch, set `nodeId` explicitly on `create-node` and reuse that exact `nodeId` in later tool calls.",
    "",
    "## connect-ports",
    "REQUIRED fields: `fromNodeId`, `fromPortKey`, `toNodeId`, `toPortKey`.",
    "`fromNodeId` and `toNodeId` MUST be real graph `nodeId` values from the graph node table above or nodeIds created earlier in the same batch.",
    "Never use a `definitionId` where a `nodeId` is required.",
    "Never emit placeholder values like `<insert-node-id>`; use the real `nodeId` values from the graph node table or from earlier `create-node` calls in the same batch.",
    "If you need to create a node and then wire it, emit `create-node` first and `connect-ports` later in the same batch.",
    "",
    "## set-app-mode-field",
    "PURPOSE: Binds a UI input field to a node's param or input port, exposing it to the end user.",
    "PREREQUISITE: The target node MUST already exist in the working graph. Do NOT call this before creating nodes.",
    "",
    "REQUIRED fields (all MUST be non-null strings):",
    "- `fieldKey`: unique key for this UI field (e.g., \"input_text\", \"temperature\")",
    "- `fieldLabel`: user-facing label (e.g., \"Enter your text\", \"Temperature\")",
    "- `bindingNodeId`: nodeId of an EXISTING node in the working graph",
    "- `bindingKey`: the param key or input port key on that node to bind",
    "- `bindingType`: \"param\" for node params, \"unconnected-input-port\" for input ports",
    "",
    "IMPORTANT: Only use set-app-mode-field AFTER you have created the nodes with create-node.",
    "If no nodes exist yet, use create-node first.",
  ].join("\n");
}

export function buildRepairPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  return [
    `User request: ${state.userRequest}`,
    "",
    `Current graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    `Validation summary: ${JSON.stringify(summarizeValidationForLLM(state.validationResult), null, 2)}`,
    "",
    "Decide whether to repair locally, replan, or fail.",
    "If repairing locally, emit only atomic tool calls.",
  ].join("\n");
}

export function buildReviewPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  const remainingSteps = getRemainingPlannedSteps(state);

  return [
    `User request: ${state.userRequest}`,
    "",
    `Plan: ${JSON.stringify(state.plan, null, 2)}`,
    "",
    `Graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    `Remaining planned steps: ${JSON.stringify(remainingSteps, null, 2)}`,
    "",
    "Review whether the graph semantically satisfies the user request.",
    "If the graph is partially built and the remaining planned steps can still be implemented with local node/edge changes, prefer `revise` over `replan`.",
    "Use `replan` only when the plan has no usable definitionIds left or the graph contradicts the plan in a way local changes cannot fix.",
  ].join("\n");
}

export function buildFinalizeRevisionPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  const registryCatalog = buildConstrainedRegistryDefinitionCatalogForLLM(state, registry);
  const remainingSteps = getRemainingPlannedSteps(state);
  const graphNodeTable = buildGraphNodeTableForLLM(state.workingGraph, registry);

  return [
    `User request: ${state.userRequest}`,
    "",
    `Plan: ${JSON.stringify(state.plan, null, 2)}`,
    "",
    `Review result: ${JSON.stringify(state.reviewResult, null, 2)}`,
    "",
    `Graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    `Remaining planned steps: ${JSON.stringify(remainingSteps, null, 2)}`,
    "",
    "## Graph Nodes Available For Wiring (use nodeId, not definitionId)",
    "```text",
    graphNodeTable,
    "```",
    "",
    "## Constrained Candidate Node Definitions (copy definitionId exactly)",
    "```text",
    registryCatalog,
    "```",
    "",
    "Treat `fileExport=fixed(...)` nodes as format-specific. Do not use them for user-chosen or mismatched output-format requests.",
    "",
    "## create-node",
    "REQUIRED fields (all MUST be non-null strings):",
    "- `definitionId`: MUST be one of the exact definitionId strings from the constrained candidate list above. Copy exactly.",
    "- `displayName`: MUST be the exact displayName from the registry for that definitionId.",
    "- `params`: array of `{ key, value }` or empty array `[]`.",
    "- If you will reference the new node later in the same batch, set `nodeId` explicitly on `create-node` and reuse that exact `nodeId` in later tool calls.",
    "",
    "## connect-ports",
    "REQUIRED fields: `fromNodeId`, `fromPortKey`, `toNodeId`, `toPortKey`.",
    "`fromNodeId` and `toNodeId` MUST be real graph `nodeId` values from the graph node table above or nodeIds created earlier in the same batch.",
    "Never use a `definitionId` where a `nodeId` is required.",
    "Never emit placeholder values like `<insert-node-id>`; use the real `nodeId` values from the graph node table or from earlier `create-node` calls in the same batch.",
    "If a missing step has no node yet, create it first and then wire it later in the same batch.",
    "",
    "## set-app-mode-field",
    "PREREQUISITE: Target node MUST already exist in the working graph.",
    "REQUIRED fields: `fieldKey`, `fieldLabel`, `bindingNodeId`, `bindingKey`, `bindingType`.",
    "",
    "Propose only the atomic tool calls needed to address the semantic gaps.",
    "Focus on adding nodes and edges for the remaining planned steps above. Do not redesign the workflow or restart from scratch.",
    "If a remaining step needs a missing value kind, first add a bridge node from the constrained candidate list before wiring the final step.",
    "IMPORTANT: Use ONLY definitionIds from the constrained candidate list above. Never invent IDs.",
    "You MUST emit at least one tool call in `proposedToolCalls`.",
  ].join("\n");
}

export const LLMToolNameSchema = z.enum([
  "create-node",
  "set-node-param",
  "connect-ports",
  "disconnect-edge",
  "remove-node",
  "set-outputs",
  "set-app-mode-field",
]);

const LLMToolValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);

export const LLMToolCallSchema = z.object({
  toolName: LLMToolNameSchema,
  input: z.object({
    nodeId: z.string().nullable(),
    definitionId: z.string().nullable(),
    displayName: z.string().nullable(),
    params: z.array(z.object({ key: z.string(), value: LLMToolValueSchema })).nullable(),
    paramKey: z.string().nullable(),
    paramValue: LLMToolValueSchema.nullable(),
    fromNodeId: z.string().nullable(),
    fromPortKey: z.string().nullable(),
    toNodeId: z.string().nullable(),
    toPortKey: z.string().nullable(),
    edgeId: z.string().nullable(),
    nodeIds: z.array(z.string()).nullable(),
    fieldKey: z.string().nullable(),
    fieldLabel: z.string().nullable(),
    bindingNodeId: z.string().nullable(),
    bindingKey: z.string().nullable(),
    bindingType: z.enum(["param", "unconnected-input-port"]).nullable(),
  }),
});

export const DraftToolCallsSchema = z.object({
  proposedToolCalls: z.array(LLMToolCallSchema),
});

export const RepairDecisionSchema = z.object({
  action: z.enum(["repair", "replan", "fail"]),
  rationale: z.string().min(1),
  proposedToolCalls: z.array(LLMToolCallSchema),
});

export function normalizeLLMToolCall(toolCall: z.infer<typeof LLMToolCallSchema>): OrchestratorToolCall {
  const requireString = (
    value: string | null,
    fieldName: string,
    toolName: string,
    rawInput: unknown,
  ): string => {
    if (value && value.length > 0) {
      return value;
    }

    throw new Error(
      `LLM emitted ${toolName} without required string field ${fieldName}. Raw input: ${JSON.stringify(rawInput)}`,
    );
  };

  switch (toolCall.toolName) {
    case "create-node":
      return OrchestratorToolCallSchema.parse({
        toolName: "create-node",
        input: CreateNodeToolLLMInputSchema.parse({
          definitionId: requireString(toolCall.input.definitionId, "definitionId", toolCall.toolName, toolCall.input),
          nodeId: toolCall.input.nodeId ?? `node-${randomUUID()}`,
          displayName: requireString(toolCall.input.displayName, "displayName", toolCall.toolName, toolCall.input),
          params: toolCall.input.params ?? [],
        }),
      });
    case "set-node-param":
      return OrchestratorToolCallSchema.parse({
        toolName: "set-node-param",
        input: SetNodeParamToolLLMInputSchema.parse({
          nodeId: requireString(toolCall.input.nodeId, "nodeId", toolCall.toolName, toolCall.input),
          paramKey: requireString(toolCall.input.paramKey, "paramKey", toolCall.toolName, toolCall.input),
          value: toolCall.input.paramValue,
        }),
      });
    case "connect-ports":
      return OrchestratorToolCallSchema.parse({
        toolName: "connect-ports",
        input: ConnectPortsToolInputSchema.parse({
          edgeId: toolCall.input.edgeId ?? `edge-${randomUUID()}`,
          fromNodeId: requireString(toolCall.input.fromNodeId, "fromNodeId", toolCall.toolName, toolCall.input),
          fromPortKey: requireString(toolCall.input.fromPortKey, "fromPortKey", toolCall.toolName, toolCall.input),
          toNodeId: requireString(toolCall.input.toNodeId, "toNodeId", toolCall.toolName, toolCall.input),
          toPortKey: requireString(toolCall.input.toPortKey, "toPortKey", toolCall.toolName, toolCall.input),
        }),
      });
    case "disconnect-edge":
      return OrchestratorToolCallSchema.parse({
        toolName: "disconnect-edge",
        input: DisconnectEdgeToolInputSchema.parse({
          edgeId: requireString(toolCall.input.edgeId, "edgeId", toolCall.toolName, toolCall.input),
        }),
      });
    case "remove-node":
      return OrchestratorToolCallSchema.parse({
        toolName: "remove-node",
        input: RemoveNodeToolInputSchema.parse({
          nodeId: requireString(toolCall.input.nodeId, "nodeId", toolCall.toolName, toolCall.input),
        }),
      });
    case "set-outputs":
      return OrchestratorToolCallSchema.parse({
        toolName: "set-outputs",
        input: SetOutputsToolInputSchema.parse({
          nodeIds: toolCall.input.nodeIds ?? [],
        }),
      });
    case "set-app-mode-field":
      return OrchestratorToolCallSchema.parse({
        toolName: "set-app-mode-field",
        input: SetAppModeFieldToolLLMInputSchema.parse({
          field: {
            key: requireString(toolCall.input.fieldKey, "fieldKey", toolCall.toolName, toolCall.input),
            source: {
              nodeId: requireString(toolCall.input.bindingNodeId, "bindingNodeId", toolCall.toolName, toolCall.input),
              bindingKey: requireString(toolCall.input.bindingKey, "bindingKey", toolCall.toolName, toolCall.input),
              bindingType: toolCall.input.bindingType ?? "param",
            },
            label: requireString(toolCall.input.fieldLabel, "fieldLabel", toolCall.toolName, toolCall.input),
            control: "text",
            required: false,
            locked: false,
            visible: true,
            defaultValue: null,
            helpText: null,
          },
        }),
      });
    default: {
      const exhaustive: never = toolCall.toolName;
      throw new Error(`Unhandled LLM tool call: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface NormalizedToolCallBatch {
  normalized: OrchestratorToolCall[];
  skipped: Array<{ toolName: string; reason: string; rawInput: unknown }>;
}

export function normalizeLLMToolCalls(
  toolCalls: Array<z.infer<typeof LLMToolCallSchema>>,
): NormalizedToolCallBatch {
  const normalized: OrchestratorToolCall[] = [];
  const skipped: NormalizedToolCallBatch["skipped"] = [];

  for (const toolCall of toolCalls) {
    console.log(`[debug] ${toolCall.toolName} raw input:`, JSON.stringify(toolCall.input));
    try {
      normalized.push(normalizeLLMToolCall(toolCall));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({
        toolName: toolCall.toolName,
        reason,
        rawInput: toolCall.input,
      });
      console.log(`[debug] skipped ${toolCall.toolName}: ${reason}`);
    }
  }

  return { normalized, skipped };
}

function filterToolCallsForCurrentState(
  state: Pick<OrchestratorState, "plan" | "workingGraph" | "userRequest">,
  registry: NormalizedRegistrySnapshot,
  batch: NormalizedToolCallBatch,
): NormalizedToolCallBatch {
  const allowedDefinitionIds = getAllowedCandidateDefinitionIdsForState(state, registry);
  const knownDefinitionIds = new Set(
    registry.nodeSpecs.map((nodeSpec) => nodeSpec.source.definitionId),
  );
  const nodeSpecByDefinitionId = new Map(
    registry.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );
  const availableNodeIds = new Set((state.workingGraph?.nodes || []).map((node) => node.nodeId));
  const nodeDefinitionIdByNodeId = new Map(
    (state.workingGraph?.nodes || []).map((node) => [node.nodeId, node.definitionId]),
  );
  const normalized: OrchestratorToolCall[] = [];
  const skipped = [...batch.skipped];

  for (const toolCall of batch.normalized) {
    if (toolCall.toolName === "create-node") {
      if (!allowedDefinitionIds.has(toolCall.input.definitionId)) {
        skipped.push({
          toolName: toolCall.toolName,
          reason: `DefinitionId \`${toolCall.input.definitionId}\` is outside the constrained candidate set for the current plan state.`,
          rawInput: toolCall.input,
        });
        continue;
      }

      if (toolCall.input.nodeId) {
        availableNodeIds.add(toolCall.input.nodeId);
        nodeDefinitionIdByNodeId.set(toolCall.input.nodeId, toolCall.input.definitionId);
      }
      normalized.push(toolCall);
      continue;
    }

    if (toolCall.toolName === "connect-ports") {
      const missingNodeIds = [toolCall.input.fromNodeId, toolCall.input.toNodeId].filter((nodeId) =>
        !availableNodeIds.has(nodeId)
      );
      if (missingNodeIds.length > 0) {
        const reason = missingNodeIds
          .map((nodeId) => knownDefinitionIds.has(nodeId)
            ? `\`${nodeId}\` is a definitionId, not a graph nodeId`
            : `\`${nodeId}\` is not an existing graph nodeId in this batch`
          )
          .join("; ");
        skipped.push({
          toolName: toolCall.toolName,
          reason: `connect-ports must use real nodeIds. ${reason}.`,
          rawInput: toolCall.input,
        });
        continue;
      }

      let fromPortKey = toolCall.input.fromPortKey;
      let toPortKey = toolCall.input.toPortKey;
      const fromDefinitionId = nodeDefinitionIdByNodeId.get(toolCall.input.fromNodeId);
      const toDefinitionId = nodeDefinitionIdByNodeId.get(toolCall.input.toNodeId);
      const fromSpec = fromDefinitionId ? nodeSpecByDefinitionId.get(fromDefinitionId) : undefined;
      const toSpec = toDefinitionId ? nodeSpecByDefinitionId.get(toDefinitionId) : undefined;
      const fromOutputPorts = fromSpec?.ports.filter((port) => port.direction === "output") || [];
      const toInputPorts = toSpec?.ports.filter((port) => port.direction === "input") || [];

      if (!fromOutputPorts.some((port) => port.key === fromPortKey) && fromOutputPorts.length === 1) {
        fromPortKey = fromOutputPorts[0].key;
      }

      if (!toInputPorts.some((port) => port.key === toPortKey) && toInputPorts.length === 1) {
        toPortKey = toInputPorts[0].key;
      }

      normalized.push({
        ...toolCall,
        input: {
          ...toolCall.input,
          fromPortKey,
          toPortKey,
        },
      });
      continue;
    }

    if (toolCall.toolName === "set-app-mode-field") {
      const nodeId = toolCall.input.field.source.nodeId;
      if (!availableNodeIds.has(nodeId)) {
        skipped.push({
          toolName: toolCall.toolName,
          reason: `set-app-mode-field references missing graph nodeId \`${nodeId}\`.`,
          rawInput: toolCall.input,
        });
        continue;
      }
    }

    normalized.push(toolCall);
  }

  return { normalized, skipped };
}

export async function runIntentModel(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof InterpretedIntentSchema>> {
  return generateStructuredOutput({
    runtime,
    schema: InterpretedIntentSchema,
    system:
      "You are a workflow intent parser. Convert natural language requests into structured workflow-building intent. Never emit raw API payloads.",
    prompt: buildInterpretIntentPrompt(state),
    maxSteps: 2,
  });
}

export async function runPlanModel(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof GraphBuildPlanSchema>> {
  return generateStructuredOutput({
    runtime,
    schema: GraphBuildPlanSchema,
    system:
      "You are a graph planning model. Plan against the registry and App Mode constraints. Do not emit raw Weave payloads.",
    prompt: buildPlanPrompt(state, registry),
    maxSteps: 2,
  });
}

export async function runDraftModel(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof DraftToolCallsSchema>> {
  const result = await generateStructuredOutput({
    runtime: {
      ...runtime,
      model: openai("gpt-4o-mini"),
    },
    schema: DraftToolCallsSchema,
    system:
      "You are a graph drafting model. Emit only valid atomic tool calls for the graph tool layer. Never mutate the graph directly.",
    prompt: buildDraftPrompt(state, registry),
    tools: buildPlanningTools(),
    maxSteps: 4,
  });
  const batch = filterToolCallsForCurrentState(
    state,
    registry,
    normalizeLLMToolCalls(result.proposedToolCalls),
  );
  return {
    proposedToolCalls: batch.normalized,
    skippedToolCalls: batch.skipped,
  };
}

export async function runRepairModel(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof RepairDecisionSchema>> {
  const result = await generateStructuredOutput({
    runtime,
    schema: RepairDecisionSchema,
    system:
      "You are a repair router. Decide whether validation issues should be fixed with local tool calls, require replanning, or should fail.",
    prompt: buildRepairPrompt(state, registry),
    tools: buildPlanningTools(),
    maxSteps: 4,
  });
  const batch = normalizeLLMToolCalls(result.proposedToolCalls);
  return {
    ...result,
    proposedToolCalls: batch.normalized,
    skippedToolCalls: batch.skipped,
  };
}

export async function runReviewModel(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof OrchestratorReviewResultSchema>> {
  return generateStructuredOutput({
    runtime,
    schema: OrchestratorReviewResultSchema,
    system:
      "You are a semantic graph reviewer. Judge whether the current graph satisfies the user request. Do not discuss API payloads.",
    prompt: buildReviewPrompt(state, registry),
    maxSteps: 2,
  });
}

export async function runFinalizeRevisionModel(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof DraftToolCallsSchema>> {
  const result = await generateStructuredOutput({
    runtime,
    schema: DraftToolCallsSchema,
    system:
      "You are a semantic revision planner. Emit only atomic tool calls that close the identified semantic gaps.",
    prompt: buildFinalizeRevisionPrompt(state, registry),
    tools: buildPlanningTools(),
    maxSteps: 4,
  });
  const batch = filterToolCallsForCurrentState(
    state,
    registry,
    normalizeLLMToolCalls(result.proposedToolCalls),
  );
  return {
    proposedToolCalls: batch.normalized,
    skippedToolCalls: batch.skipped,
  };
}

export function validateCurrentGraph(
  state: OrchestratorState,
): ValidationResult {
  if (!state.workingGraph || !state.registrySnapshot) {
    return {
      ok: false,
      errorCount: 1,
      warningCount: 0,
      issues: [
        {
          severity: "error",
          code: "orchestrator.validation.missing_graph_or_registry",
          message: "Cannot validate without both a working graph and a loaded registry snapshot.",
          context: {},
        },
      ],
    };
  }

  return validateGraph(state.workingGraph, state.registrySnapshot);
}
