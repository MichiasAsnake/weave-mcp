import { z } from "zod";

import {
  AppFieldBindingTypeSchema,
  AppFieldControlSchema,
  GraphIRSchema,
} from "../graph/zod.ts";
import { ValueKindSchema } from "../registry/zod.ts";

export const CompilerOperationKindSchema = z.enum([
  "upload",
  "array-input",
  "image-collection",
  "reference-set",
  "tagged-input-set",
  "fanout",
  "fanin",
  "foreach",
  "map",
  "reduce",
  "prompt-variable",
  "prompt-source",
  "prompt-compose",
  "file-to-image",
  "enhance-prompt",
  "upscale-image",
  "edit-image",
  "reference-image-edit",
  "multi-image-compose",
  "style-transfer-edit",
  "mask-from-text",
  "inpaint-image",
  "generate-image",
  "compare-generate-image",
  "generate-video",
  "compare-generate-video",
  "image-to-video",
  "video-concat",
  "voiceover-video",
  "generate-audio",
  "text-to-speech",
  "speech-to-text",
  "audio-concat",
  "audio-mix",
  "merge-audio-video",
  "timeline-assemble",
  "trim-video",
  "timeline-overlay",
  "timeline-transition",
  "caption-extract",
  "transcript-extract",
  "scene-detect",
  "export",
  "output-result",
  "unknown",
]);

export const CompilerOperationSchema = z.object({
  kind: CompilerOperationKindSchema,
  summary: z.string().min(1),
  inputKind: ValueKindSchema.nullable(),
  outputKind: ValueKindSchema.nullable(),
  requestedFormat: z.string().nullable().optional(),
  requiresUserInput: z.boolean().default(false),
  branchCount: z.number().int().positive().optional(),
  manualInputKinds: z.array(ValueKindSchema).optional(),
  modelHints: z.array(z.string().min(1)).optional(),
  promptKey: z.string().min(1).optional(),
  promptLabel: z.string().min(1).optional(),
  promptInputs: z.array(z.string().min(1)).optional(),
  collectionItemKind: ValueKindSchema.optional(),
  itemInputKind: ValueKindSchema.optional(),
  itemOutputKind: ValueKindSchema.optional(),
  countMode: z.enum(["explicit", "open-ended"]).optional(),
  mergeStrategy: z.string().min(1).optional(),
  fieldLabels: z.record(z.string(), z.string().min(1)).optional(),
  fieldHelpText: z.record(z.string(), z.string().min(1)).optional(),
});

export const CompilerPromptPrimitiveSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("prompt-variable"),
    key: z.string().min(1),
    label: z.string().min(1),
  }),
  z.object({
    kind: z.literal("prompt-source"),
    key: z.string().min(1),
    label: z.string().min(1),
  }),
  z.object({
    kind: z.literal("prompt-compose"),
    key: z.string().min(1),
    inputs: z.array(z.string().min(1)).min(2),
  }),
]);

export const CompilerIntentSchema = z.object({
  domain: z.enum(["image", "video", "audio", "text", "unknown"]),
  originalRequest: z.string().min(1),
  input: z.object({
    source: z.enum(["user_upload", "existing_asset", "prompt", "unknown"]),
    kind: ValueKindSchema,
  }),
  operations: z.array(CompilerOperationSchema),
  output: z.object({
    kind: ValueKindSchema,
    format: z.string().nullable(),
    delivery: z.enum(["download", "preview", "app_output", "unknown"]),
  }),
  appMode: z.object({
    enabled: z.boolean(),
    requiredFields: z.array(z.string()),
  }),
  promptPlan: z.object({
    primitives: z.array(CompilerPromptPrimitiveSchema),
    finalPromptKey: z.string().min(1).nullable(),
  }),
  ambiguities: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })),
});

export const CompilerErrorSchema = z.object({
  code: z.enum([
    "unsupported_domain",
    "unsupported_operation",
    "unsupported_output_format",
    "missing_import_capability",
    "missing_bridge",
    "missing_operation_capability",
    "missing_export_capability",
    "graph_validation_failed",
  ]),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const CompilerTraceEntrySchema = z.object({
  stage: z.string().min(1),
  detail: z.string().min(1),
});

export const CompiledGraphNodeSchema = z.object({
  stepId: z.string().min(1),
  definitionId: z.string().min(1),
  nodeId: z.string().min(1),
  displayName: z.string().min(1),
  purpose: z.string().min(1),
});

export const CompilerPrimitiveCoverageSchema = z.object({
  operationKind: CompilerOperationKindSchema,
  summary: z.string().min(1),
  definitionIds: z.array(z.string().min(1)),
  registryGap: z.boolean(),
  reason: z.string().min(1),
});

export const CompilerPlanGapSchema = z.object({
  operationKind: CompilerOperationKindSchema,
  summary: z.string().min(1),
  registryGap: z.literal(true),
  reason: z.string().min(1),
  blockedOutputKind: ValueKindSchema.nullable().optional(),
});

export const CompiledWorkflowPlanSchema = z.object({
  summary: z.string().min(1),
  nodes: z.array(CompiledGraphNodeSchema),
  edges: z.array(
    z.object({
      fromStepId: z.string().min(1),
      toStepId: z.string().min(1),
      fromPortKey: z.string().min(1),
      toPortKey: z.string().min(1),
    }),
  ),
  appModeFields: z.array(
    z.object({
      key: z.string().min(1),
      label: z.string().min(1),
      control: AppFieldControlSchema,
      required: z.boolean(),
      source: z.object({
        nodeId: z.string().min(1),
        bindingType: AppFieldBindingTypeSchema,
        bindingKey: z.string().min(1),
      }),
    }),
  ),
  primitiveCoverage: z.array(CompilerPrimitiveCoverageSchema).default([]),
  gaps: z.array(CompilerPlanGapSchema).default([]),
});

export const CompilerClarifyingQuestionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  reason: z.string().min(1),
  options: z.array(z.string().min(1)).max(4).default([]),
});

export const CompilerPromptFieldSchema = z.object({
  nodeRole: z.string().min(1),
  promptKey: z.string().min(1),
  purpose: z.string().min(1),
  text: z.string().min(1),
  editable: z.boolean(),
});

export const CompilerExplanationSchema = z.object({
  summary: z.string().min(1),
  assumptions: z.array(z.string().min(1)).default([]),
  promptNotes: z.array(z.string().min(1)).default([]),
  suggestedTweaks: z.array(z.string().min(1)).default([]),
});

const CompilerFailureStatusSchema = z.enum(["unsupported", "failed"]);

const UNSUPPORTED_COMPILER_ERROR_CODES = new Set([
  "unsupported_domain",
  "unsupported_operation",
  "unsupported_output_format",
  "missing_import_capability",
  "missing_bridge",
  "missing_operation_capability",
  "missing_export_capability",
]);

function inferCompilerFailureStatus(errorCode: z.infer<typeof CompilerErrorSchema>["code"]) {
  return UNSUPPORTED_COMPILER_ERROR_CODES.has(errorCode) ? "unsupported" : "failed";
}

const CompilerSuccessResultBaseSchema = z.object({
  ok: z.literal(true),
  intent: CompilerIntentSchema,
  questions: z.array(CompilerClarifyingQuestionSchema).max(2).default([]),
  promptDraft: z.array(CompilerPromptFieldSchema).default([]),
  trace: z.array(CompilerTraceEntrySchema),
});

export const CompilerQuestionRequiredResultSchema = CompilerSuccessResultBaseSchema.extend({
  status: z.literal("question-required"),
  questions: z.array(CompilerClarifyingQuestionSchema).min(1).max(2),
  plan: z.null().default(null),
  graph: z.null().default(null),
  explanation: CompilerExplanationSchema.nullable().default(null),
});

export const CompilerCompleteResultSchema = CompilerSuccessResultBaseSchema.extend({
  status: z.literal("complete").default("complete"),
  plan: CompiledWorkflowPlanSchema,
  graph: GraphIRSchema,
  explanation: CompilerExplanationSchema.nullable().default(null),
});

const CompilerFailureResultBaseSchema = z.object({
  ok: z.literal(false),
  status: CompilerFailureStatusSchema,
  intent: CompilerIntentSchema,
  error: CompilerErrorSchema,
  questions: z.array(CompilerClarifyingQuestionSchema).max(2).default([]),
  promptDraft: z.array(CompilerPromptFieldSchema).default([]),
  trace: z.array(CompilerTraceEntrySchema),
}).superRefine((value, ctx) => {
  const inferredStatus = inferCompilerFailureStatus(value.error.code);
  if (value.status !== inferredStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: `Status ${value.status} does not match error code ${value.error.code}.`,
    });
  }
});

export const CompilerFailureResultSchema = z.preprocess((input) => {
  if (
    typeof input !== "object" ||
    input === null ||
    !("ok" in input) ||
    (input as { ok?: unknown }).ok !== false ||
    "status" in input
  ) {
    return input;
  }

  const candidate = input as {
    error?: {
      code?: z.infer<typeof CompilerErrorSchema>["code"];
    };
  };

  if (candidate.error?.code === undefined) {
    return input;
  }

  return { ...input, status: inferCompilerFailureStatus(candidate.error.code) };
}, CompilerFailureResultBaseSchema);

export const CompilerResultSchema = z.union([
  CompilerQuestionRequiredResultSchema,
  CompilerCompleteResultSchema,
  CompilerFailureResultSchema,
]);
