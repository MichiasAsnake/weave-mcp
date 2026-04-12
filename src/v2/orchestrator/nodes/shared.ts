// @ts-nocheck
import { generateObject, stepCountIs, tool } from "ai";
import { z } from "zod";

import { createEmptyGraphIR } from "../../graph/builders.ts";
import type { GraphIR } from "../../graph/types.ts";
import { readLatestNormalizedRegistrySnapshot } from "../../registry/store.ts";
import type { NormalizedRegistrySnapshot, NodeSpec, PortSpec } from "../../registry/types.ts";
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
}): Promise<T> {
  const result = await generateObject({
    model: args.runtime.model,
    system: args.system,
    prompt: args.prompt,
    tools: args.tools,
    stopWhen: stepCountIs(6),
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
): ToolResult {
  switch (toolCall.toolName) {
    case "create-node":
      return createNodeTool(graph, registry, toolCall.input);
    case "set-node-param":
      return setNodeParamTool(graph, registry, toolCall.input);
    case "connect-ports":
      return connectPortsTool(graph, registry, toolCall.input);
    case "disconnect-edge":
      return disconnectEdgeTool(graph, registry, toolCall.input);
    case "remove-node":
      return removeNodeTool(graph, registry, toolCall.input);
    case "set-outputs":
      return setOutputsTool(graph, registry, toolCall.input);
    case "set-app-mode-field":
      return setAppModeFieldTool(graph, registry, toolCall.input);
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
  return [
    `User request: ${state.userRequest}`,
    "",
    `Interpreted intent: ${JSON.stringify(state.interpretedIntent, null, 2)}`,
    "",
    `Context artifacts: ${JSON.stringify(state.contextArtifacts, null, 2)}`,
    "",
    `Registry summary: ${JSON.stringify(summarizeRegistryForLLM(registry), null, 2)}`,
    "",
    "Create a stepwise plan for building or modifying the graph. Do not emit raw Weave payloads.",
  ].join("\n");
}

export function buildDraftPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  return [
    `User request: ${state.userRequest}`,
    "",
    `Plan: ${JSON.stringify(state.plan, null, 2)}`,
    "",
    `Working graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    "Draft the next atomic tool calls needed to move the graph toward completion.",
    "Only propose tool calls that can be executed by the atomic tool layer.",
    "For `create-node`, always include:",
    "- `nodeId`: a new UUID-like string for the graph node",
    "- `definitionId`: one of the definitionIds shown in the registry summary",
    "- `displayName`: the node display name from the registry summary",
    "- `params`: an array of `{ key, value }` entries, or an empty array if the node has no params",
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
  return [
    `User request: ${state.userRequest}`,
    "",
    `Plan: ${JSON.stringify(state.plan, null, 2)}`,
    "",
    `Graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    "Review whether the graph semantically satisfies the user request.",
  ].join("\n");
}

export function buildFinalizeRevisionPrompt(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
): string {
  return [
    `User request: ${state.userRequest}`,
    "",
    `Review result: ${JSON.stringify(state.reviewResult, null, 2)}`,
    "",
    `Graph summary: ${JSON.stringify(summarizeGraphForLLM(state.workingGraph, registry), null, 2)}`,
    "",
    "Propose only the atomic tool calls needed to address the semantic gaps.",
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
  const requireString = (value: string | null, fieldName: string, toolName: string): string => {
    if (value && value.length > 0) {
      return value;
    }

    throw new Error(`LLM emitted ${toolName} without required string field ${fieldName}.`);
  };

  switch (toolCall.toolName) {
    case "create-node":
      return OrchestratorToolCallSchema.parse({
        toolName: "create-node",
        input: CreateNodeToolLLMInputSchema.parse({
          definitionId: requireString(toolCall.input.definitionId, "definitionId", toolCall.toolName),
          nodeId: requireString(toolCall.input.nodeId, "nodeId", toolCall.toolName),
          displayName: requireString(toolCall.input.displayName, "displayName", toolCall.toolName),
          params: toolCall.input.params ?? [],
        }),
      });
    case "set-node-param":
      return OrchestratorToolCallSchema.parse({
        toolName: "set-node-param",
        input: SetNodeParamToolLLMInputSchema.parse({
          nodeId: requireString(toolCall.input.nodeId, "nodeId", toolCall.toolName),
          paramKey: requireString(toolCall.input.paramKey, "paramKey", toolCall.toolName),
          value: toolCall.input.paramValue,
        }),
      });
    case "connect-ports":
      return OrchestratorToolCallSchema.parse({
        toolName: "connect-ports",
        input: ConnectPortsToolInputSchema.parse({
          edgeId: requireString(toolCall.input.edgeId, "edgeId", toolCall.toolName),
          fromNodeId: requireString(toolCall.input.fromNodeId, "fromNodeId", toolCall.toolName),
          fromPortKey: requireString(toolCall.input.fromPortKey, "fromPortKey", toolCall.toolName),
          toNodeId: requireString(toolCall.input.toNodeId, "toNodeId", toolCall.toolName),
          toPortKey: requireString(toolCall.input.toPortKey, "toPortKey", toolCall.toolName),
        }),
      });
    case "disconnect-edge":
      return OrchestratorToolCallSchema.parse({
        toolName: "disconnect-edge",
        input: DisconnectEdgeToolInputSchema.parse({
          edgeId: requireString(toolCall.input.edgeId, "edgeId", toolCall.toolName),
        }),
      });
    case "remove-node":
      return OrchestratorToolCallSchema.parse({
        toolName: "remove-node",
        input: RemoveNodeToolInputSchema.parse({
          nodeId: requireString(toolCall.input.nodeId, "nodeId", toolCall.toolName),
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
            key: requireString(toolCall.input.fieldKey, "fieldKey", toolCall.toolName),
            source: {
              nodeId: requireString(toolCall.input.bindingNodeId, "bindingNodeId", toolCall.toolName),
              bindingKey: requireString(toolCall.input.bindingKey, "bindingKey", toolCall.toolName),
              bindingType: toolCall.input.bindingType ?? "param",
            },
            label: requireString(toolCall.input.fieldLabel, "fieldLabel", toolCall.toolName),
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

export function normalizeLLMToolCalls(
  toolCalls: Array<z.infer<typeof LLMToolCallSchema>>,
): OrchestratorToolCall[] {
  return toolCalls.map((toolCall) => normalizeLLMToolCall(toolCall));
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
  });
}

export async function runDraftModel(
  state: OrchestratorState,
  registry: NormalizedRegistrySnapshot,
  runtime: OrchestratorRuntime,
): Promise<z.infer<typeof DraftToolCallsSchema>> {
  const result = await generateStructuredOutput({
    runtime,
    schema: DraftToolCallsSchema,
    system:
      "You are a graph drafting model. Emit only valid atomic tool calls for the graph tool layer. Never mutate the graph directly.",
    prompt: buildDraftPrompt(state, registry),
    tools: buildPlanningTools(),
  });
  return {
    proposedToolCalls: normalizeLLMToolCalls(result.proposedToolCalls),
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
  });
  return {
    ...result,
    proposedToolCalls: normalizeLLMToolCalls(result.proposedToolCalls),
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
  });
  return {
    proposedToolCalls: normalizeLLMToolCalls(result.proposedToolCalls),
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
