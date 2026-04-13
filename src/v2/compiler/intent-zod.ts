import { z } from "zod";

import { GraphIRSchema } from "../graph/zod.ts";
import { ValueKindSchema } from "../registry/zod.ts";

export const CompilerOperationSchema = z.object({
  kind: z.enum(["upload", "file-to-image", "enhance-prompt", "upscale-image", "edit-image", "generate-image", "generate-video", "export", "output-result", "unknown"]),
  summary: z.string().min(1),
  inputKind: ValueKindSchema.nullable(),
  outputKind: ValueKindSchema.nullable(),
  requestedFormat: z.string().nullable().optional(),
  requiresUserInput: z.boolean().default(false),
});

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
      control: z.enum(["text", "textarea", "number", "toggle", "select", "image-upload", "video-upload", "audio-upload"]),
      required: z.boolean(),
      source: z.object({
        nodeId: z.string().min(1),
        bindingType: z.enum(["param", "unconnected-input-port"]),
        bindingKey: z.string().min(1),
      }),
    }),
  ),
});

export const CompilerResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    intent: CompilerIntentSchema,
    plan: CompiledWorkflowPlanSchema,
    graph: GraphIRSchema,
    trace: z.array(CompilerTraceEntrySchema),
  }),
  z.object({
    ok: z.literal(false),
    intent: CompilerIntentSchema,
    error: CompilerErrorSchema,
    trace: z.array(CompilerTraceEntrySchema),
  }),
]);
