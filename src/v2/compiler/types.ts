import { z } from "zod";

import type { GraphIR } from "../graph/types.ts";
import type { NormalizedRegistrySnapshot, ValueKind } from "../registry/types.ts";
import type {
  AppFieldBindingType,
  AppFieldControl,
} from "../graph/types.ts";
import type {
  CompilerErrorSchema,
  CompiledGraphNodeSchema,
  CompiledWorkflowPlanSchema,
  CompilerIntentSchema,
  CompilerOperationSchema,
  CompilerResultSchema,
  CompilerTraceEntrySchema,
} from "./intent-zod.ts";

export type CompilerDomain = "image" | "video" | "audio" | "text" | "unknown";
export type CompilerOperationKind =
  | "upload"
  | "file-to-image"
  | "enhance-prompt"
  | "upscale-image"
  | "edit-image"
  | "generate-image"
  | "generate-video"
  | "export"
  | "output-result"
  | "unknown";

export type CompilerOperation = z.infer<typeof CompilerOperationSchema>;
export type CompilerIntent = z.infer<typeof CompilerIntentSchema>;
export type CompilerError = z.infer<typeof CompilerErrorSchema>;
export type CompilerTraceEntry = z.infer<typeof CompilerTraceEntrySchema>;
export type CompiledGraphNode = z.infer<typeof CompiledGraphNodeSchema>;
export type CompiledWorkflowPlan = z.infer<typeof CompiledWorkflowPlanSchema>;
export type CompilerResult = z.infer<typeof CompilerResultSchema>;

export interface CompilerRuntime {
  registry: NormalizedRegistrySnapshot;
  requestId?: string;
  now?: () => string;
}

export interface CandidateSelection {
  operationKind: CompilerOperationKind;
  definitionIds: string[];
  reason: string;
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
