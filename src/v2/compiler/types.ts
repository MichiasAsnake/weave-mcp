import { z } from "zod";

import type { GraphIR } from "../graph/types.ts";
import type { NormalizedRegistrySnapshot, ValueKind } from "../registry/types.ts";
import type {
  AppFieldBindingType,
  AppFieldControl,
} from "../graph/types.ts";
import type {
  CompilerClarifyingQuestionSchema,
  CompilerCompleteResultSchema,
  CompilerExplanationSchema,
  CompilerErrorSchema,
  CompilerFailureResultSchema,
  CompilerOperationKindSchema,
  CompilerPlanGapSchema,
  CompilerPromptFieldSchema,
  CompilerPrimitiveCoverageSchema,
  CompilerQuestionRequiredResultSchema,
  CompiledGraphNodeSchema,
  CompilerPromptPrimitiveSchema,
  CompiledWorkflowPlanSchema,
  CompilerIntentSchema,
  CompilerOperationSchema,
  CompilerResultSchema,
  CompilerTraceEntrySchema,
} from "./intent-zod.ts";

export type CompilerOperationKind = z.infer<typeof CompilerOperationKindSchema>;

export type CompilerOperation = z.infer<typeof CompilerOperationSchema>;
export type CompilerPromptPrimitive = z.infer<typeof CompilerPromptPrimitiveSchema>;
export type CompilerIntent = z.infer<typeof CompilerIntentSchema>;
export type CompilerDomain = z.infer<typeof CompilerIntentSchema>["domain"];
export type CompilerClarifyingQuestion = z.infer<typeof CompilerClarifyingQuestionSchema>;
export type CompilerPromptField = z.infer<typeof CompilerPromptFieldSchema>;
export type CompilerExplanation = z.infer<typeof CompilerExplanationSchema>;
export type CompilerQuestionRequiredResult = z.infer<typeof CompilerQuestionRequiredResultSchema>;
export type CompilerCompleteResult = z.infer<typeof CompilerCompleteResultSchema>;
export type CompilerFailureResult = z.infer<typeof CompilerFailureResultSchema>;
export type CompilerError = z.infer<typeof CompilerErrorSchema>;
export type CompilerTraceEntry = z.infer<typeof CompilerTraceEntrySchema>;
export type CompiledGraphNode = z.infer<typeof CompiledGraphNodeSchema>;
export type CompilerPrimitiveCoverage = z.infer<typeof CompilerPrimitiveCoverageSchema>;
export type CompilerPlanGap = z.infer<typeof CompilerPlanGapSchema>;
export type CompiledWorkflowPlan = z.infer<typeof CompiledWorkflowPlanSchema>;
export type CompilerResult = z.infer<typeof CompilerResultSchema>;

export interface CompilerRuntime {
  registry: NormalizedRegistrySnapshot;
  requestId?: string;
  now?: () => string;
}

export interface CandidateSelection {
  operationKind: CompilerOperationKind;
  operation: CompilerOperation;
  definitionIds: string[];
  reason: string;
  registryGap?: boolean;
  blockedOutputKind?: ValueKind | null;
}

export interface GraphPortSelection {
  fromPortKey: string;
  toPortKey: string;
}

export interface CompilerAppField {
  key: string;
  label: string;
  control: AppFieldControl;
  required: boolean;
  locked: boolean;
  visible: boolean;
  defaultValue?: unknown;
  helpText?: string;
  source: {
    nodeId: string;
    bindingType: AppFieldBindingType;
    bindingKey: string;
  };
}
