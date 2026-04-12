// @ts-nocheck
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool } from "pg";
import type { generateText } from "ai";

import { GraphIRSchema } from "../graph/zod.ts";
import type { GraphIR } from "../graph/types.ts";
import type { PostgresCheckpointSaver } from "../db/postgres-saver.ts";
import type { NormalizedRegistrySnapshot } from "../registry/types.ts";
import {
  ConnectPortsToolInputSchema,
  CreateNodeToolLLMInputSchema,
  DisconnectEdgeToolInputSchema,
  RemoveNodeToolInputSchema,
  SetAppModeFieldToolLLMInputSchema,
  SetNodeParamToolLLMInputSchema,
  SetOutputsToolInputSchema,
} from "../tools/types.ts";

export const OrchestratorNodeNameSchema = z.enum([
  "receive_request",
  "load_session",
  "load_registry",
  "interpret_request",
  "retrieve_context",
  "plan_graph",
  "draft_graph",
  "validate_graph",
  "decide_repair",
  "apply_tool_step",
  "revalidate_graph",
  "review_graph",
  "decide_finalize",
  "finalize_result",
  "complete",
  "fail",
]);

export type OrchestratorNodeName = z.infer<typeof OrchestratorNodeNameSchema>;

export const OrchestratorRequestModeSchema = z.enum(["create", "modify", "extend", "repair"]);
export type OrchestratorRequestMode = z.infer<typeof OrchestratorRequestModeSchema>;

export const OrchestratorStatusSchema = z.enum([
  "receive_request",
  "load_session",
  "load_registry",
  "interpret_request",
  "retrieve_context",
  "plan_graph",
  "draft_graph",
  "validate_graph",
  "decide_repair",
  "apply_tool_step",
  "revalidate_graph",
  "review_graph",
  "decide_finalize",
  "finalize_result",
  "complete",
  "fail",
  "repair_local",
  "repair_replan",
  "replan",
  "revise",
  "finalize",
  "failed",
]);

export type OrchestratorStatus = z.infer<typeof OrchestratorStatusSchema>;

export const OrchestratorMessageRecordSchema = z.object({
  nodeName: OrchestratorNodeNameSchema,
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().min(1),
  createdAt: z.string().min(1),
});

export type OrchestratorMessageRecord = z.infer<typeof OrchestratorMessageRecordSchema>;

export const OrchestratorCheckpointRecordSchema = z.object({
  nodeName: OrchestratorNodeNameSchema,
  recordedAt: z.string().min(1),
  revisionCount: z.number().int().nonnegative(),
  checkpointId: z.string().min(1).optional(),
  note: z.string().optional(),
});

export type OrchestratorCheckpointRecord = z.infer<typeof OrchestratorCheckpointRecordSchema>;

export const TemplateCandidateSchema = z.object({
  templateId: z.string().min(1),
  title: z.string().min(1),
  score: z.number().min(0).max(1),
  reason: z.string().min(1),
  source: z.enum(["session", "catalog", "manual"]),
});

export type TemplateCandidate = z.infer<typeof TemplateCandidateSchema>;

export const ContextArtifactSchema = z.object({
  kind: z.enum(["template", "session", "registry-capability"]),
  id: z.string().min(1),
  summary: z.string().min(1),
});

export type ContextArtifact = z.infer<typeof ContextArtifactSchema>;

export const InterpretedIntentSchema = z.object({
  requestMode: OrchestratorRequestModeSchema,
  goalSummary: z.string().min(1),
  requestedOutputs: z.array(z.string().min(1)),
  constraints: z.array(z.string().min(1)),
  appModeIntent: z.object({
    required: z.boolean(),
    reason: z.string().nullable(),
    fields: z.array(z.string().min(1)),
  }),
  templateStrategy: z.enum(["reuse", "modify", "scratch"]),
  targetTemplateId: z.string().min(1).nullable(),
});

export type InterpretedIntent = z.infer<typeof InterpretedIntentSchema>;

export const GraphPlanStepSchema = z.object({
  stepId: z.string().min(1),
  summary: z.string().min(1),
  nodeDefinitionIds: z.array(z.string().min(1)),
  expectedOutputs: z.array(z.string().min(1)),
});

export type GraphPlanStep = z.infer<typeof GraphPlanStepSchema>;

export const GraphBuildPlanSchema = z.object({
  summary: z.string().min(1),
  startingPoint: z.enum(["empty", "existing-graph", "selected-template"]),
  steps: z.array(GraphPlanStepSchema),
  successCriteria: z.array(z.string().min(1)),
  appModePlan: z.object({
    exposureStrategy: z.enum(["auto", "manual"]),
    requiredFields: z.array(z.string().min(1)),
  }),
});

export type GraphBuildPlan = z.infer<typeof GraphBuildPlanSchema>;

export const CreateNodeToolCallSchema = z.object({
  toolName: z.literal("create-node"),
  input: CreateNodeToolLLMInputSchema,
});

export const SetNodeParamToolCallSchema = z.object({
  toolName: z.literal("set-node-param"),
  input: SetNodeParamToolLLMInputSchema,
});

export const ConnectPortsToolCallSchema = z.object({
  toolName: z.literal("connect-ports"),
  input: ConnectPortsToolInputSchema,
});

export const DisconnectEdgeToolCallSchema = z.object({
  toolName: z.literal("disconnect-edge"),
  input: DisconnectEdgeToolInputSchema,
});

export const RemoveNodeToolCallSchema = z.object({
  toolName: z.literal("remove-node"),
  input: RemoveNodeToolInputSchema,
});

export const SetOutputsToolCallSchema = z.object({
  toolName: z.literal("set-outputs"),
  input: SetOutputsToolInputSchema,
});

export const SetAppModeFieldToolCallSchema = z.object({
  toolName: z.literal("set-app-mode-field"),
  input: SetAppModeFieldToolLLMInputSchema,
});

export const OrchestratorToolCallSchema = z.discriminatedUnion("toolName", [
  CreateNodeToolCallSchema,
  SetNodeParamToolCallSchema,
  ConnectPortsToolCallSchema,
  DisconnectEdgeToolCallSchema,
  RemoveNodeToolCallSchema,
  SetOutputsToolCallSchema,
  SetAppModeFieldToolCallSchema,
]);

export type OrchestratorToolCall = z.infer<typeof OrchestratorToolCallSchema>;

export const AppliedToolCallSchema = z.object({
  toolCall: OrchestratorToolCallSchema,
  applied: z.boolean(),
  issueCodes: z.array(z.string().min(1)),
  appliedAt: z.string().min(1),
});

export type AppliedToolCall = z.infer<typeof AppliedToolCallSchema>;

export const ValidationContextSchema = z.object({
  definitionId: z.string().optional(),
  nodeType: z.string().optional(),
  nodeId: z.string().optional(),
  edgeId: z.string().optional(),
  fieldKey: z.string().optional(),
  bindingType: z.enum(["param", "unconnected-input-port"]).optional(),
  bindingKey: z.string().optional(),
  portKey: z.string().optional(),
});

export const ValidationIssueSchema = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string().min(1),
  message: z.string().min(1),
  context: ValidationContextSchema,
});

export const ValidationResultSchema = z.object({
  ok: z.boolean(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  issues: z.array(ValidationIssueSchema),
});

export const OrchestratorReviewResultSchema = z.object({
  satisfiesRequest: z.boolean(),
  semanticGaps: z.array(z.string().min(1)),
  recommendedAction: z.enum(["finalize", "revise", "replan"]),
  rationale: z.string().min(1),
});

export type OrchestratorReviewResult = z.infer<typeof OrchestratorReviewResultSchema>;

export const OrchestratorFailureReasonSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  nodeName: OrchestratorNodeNameSchema,
});

export type OrchestratorFailureReason = z.infer<typeof OrchestratorFailureReasonSchema>;

export const GraphHistoryEntrySchema = z.object({
  revisionIndex: z.number().int().nonnegative(),
  graph: GraphIRSchema,
  validationResult: ValidationResultSchema.optional(),
  reviewResult: OrchestratorReviewResultSchema.optional(),
  note: z.string().optional(),
  createdAt: z.string().min(1),
});

export type GraphHistoryEntry = z.infer<typeof GraphHistoryEntrySchema>;

export const OrchestratorStateSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  turnId: z.string().min(1),
  userRequest: z.string().min(1),
  requestMode: OrchestratorRequestModeSchema.optional(),
  registryVersion: z.string().min(1).optional(),
  registrySnapshot: z.custom<NormalizedRegistrySnapshot>().optional(),
  currentGraph: GraphIRSchema.optional(),
  baseGraph: GraphIRSchema.optional(),
  workingGraph: GraphIRSchema.optional(),
  graphRevisionIndex: z.number().int().nonnegative(),
  graphHistory: z.array(GraphHistoryEntrySchema),
  selectedTemplateId: z.string().min(1).optional(),
  templateCandidates: z.array(TemplateCandidateSchema),
  contextArtifacts: z.array(ContextArtifactSchema),
  interpretedIntent: InterpretedIntentSchema.optional(),
  plan: GraphBuildPlanSchema.optional(),
  proposedToolCalls: z.array(OrchestratorToolCallSchema),
  appliedToolCalls: z.array(AppliedToolCallSchema),
  validationResult: ValidationResultSchema.optional(),
  reviewResult: OrchestratorReviewResultSchema.optional(),
  revisionCount: z.number().int().nonnegative(),
  maxRevisionCount: z.number().int().positive(),
  status: OrchestratorStatusSchema,
  failureReason: OrchestratorFailureReasonSchema.optional(),
  messages: z.array(OrchestratorMessageRecordSchema),
  checkpoints: z.array(OrchestratorCheckpointRecordSchema),
});

export type OrchestratorState = z.infer<typeof OrchestratorStateSchema>;

export const OrchestratorInputSchema = z.object({
  sessionId: z.string().min(1).optional(),
  requestId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  userRequest: z.string().min(1),
  maxRevisionCount: z.number().int().positive().optional(),
  currentGraph: GraphIRSchema.optional(),
  baseGraph: GraphIRSchema.optional(),
});

export type OrchestratorInput = z.infer<typeof OrchestratorInputSchema>;

export type OrchestratorModel = Parameters<typeof generateText>[0]["model"];

export interface OrchestratorRuntime {
  model: OrchestratorModel;
  pool: Pool;
  checkpointSaver: PostgresCheckpointSaver;
  now?: () => string;
  loadRegistrySnapshot?: () => Promise<NormalizedRegistrySnapshot>;
  retrieveTemplateCandidates?: (
    state: OrchestratorState,
  ) => Promise<TemplateCandidate[]>;
}

export interface OrchestratorGraphBundle {
  graph: unknown;
  checkpointSaver: PostgresCheckpointSaver;
}

export function createEmptyOrchestratorState(input: OrchestratorInput): OrchestratorState {
  const now = new Date().toISOString();

  return OrchestratorStateSchema.parse({
    sessionId: input.sessionId || randomUUID(),
    requestId: input.requestId || randomUUID(),
    turnId: input.turnId || randomUUID(),
    userRequest: input.userRequest,
    requestMode: undefined,
    registryVersion: undefined,
    registrySnapshot: undefined,
    currentGraph: input.currentGraph,
    baseGraph: input.baseGraph,
    workingGraph: input.baseGraph || input.currentGraph,
    graphRevisionIndex: 0,
    graphHistory: [],
    selectedTemplateId: undefined,
    templateCandidates: [],
    contextArtifacts: [],
    interpretedIntent: undefined,
    plan: undefined,
    proposedToolCalls: [],
    appliedToolCalls: [],
    validationResult: undefined,
    reviewResult: undefined,
    revisionCount: 0,
    maxRevisionCount: input.maxRevisionCount ?? 3,
    status: "receive_request",
    failureReason: undefined,
    messages: [
      {
        nodeName: "receive_request",
        role: "user",
        content: input.userRequest,
        createdAt: now,
      },
    ],
    checkpoints: [],
  });
}

export function cloneGraph(graph: GraphIR | undefined): GraphIR | undefined {
  if (!graph) {
    return undefined;
  }
  return GraphIRSchema.parse(structuredClone(graph));
}
