import { z } from "zod";

export const RegistrySourceKindSchema = z.enum(["public", "user"]);

export const ValueKindSchema = z.enum([
  "text",
  "number",
  "boolean",
  "enum",
  "image",
  "video",
  "audio",
  "mask",
  "3d",
  "array",
  "object",
  "any",
  "file",
  "json",
  "unknown",
]);

export const ParamUiSpecSchema = z.object({
  control: z
    .enum(["textbox", "textarea", "slider", "toggle", "select", "file"])
    .optional(),
  label: z.string().optional(),
  group: z.string().optional(),
  order: z.number().int().optional(),
  hidden: z.boolean().optional(),
});

export const ParamAppModeSpecSchema = z.object({
  exposable: z.boolean(),
  defaultExposed: z.boolean(),
  lockable: z.boolean(),
});

export const PortSpecSchema = z.object({
  key: z.string(),
  direction: z.enum(["input", "output"]),
  kind: ValueKindSchema,
  required: z.boolean(),
  multi: z.boolean(),
  accepts: z.array(ValueKindSchema).optional(),
  produces: z.array(ValueKindSchema).optional(),
  raw: z.unknown().optional(),
});

export const ParamSpecSchema = z.object({
  key: z.string(),
  kind: ValueKindSchema,
  required: z.boolean(),
  defaultValue: z.unknown().optional(),
  enumValues: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  ui: ParamUiSpecSchema.optional(),
  appMode: ParamAppModeSpecSchema.optional(),
  raw: z.unknown().optional(),
});

export const NodeModelSpecSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
  pricingKey: z.string().optional(),
  matchedPriceCredits: z.number().nullable().optional(),
});

export const NodeCompatibilitySpecSchema = z.object({
  acceptsKinds: z.array(ValueKindSchema),
  producesKinds: z.array(ValueKindSchema),
  requiresAllMandatoryInputs: z.boolean(),
});

export const NodeAppModeSpecSchema = z.object({
  supportsOutputNode: z.boolean(),
  exposableParams: z.array(z.string()),
  exposablePorts: z.array(z.string()),
});

export const NodeSpecSourceSchema = z.object({
  definitionId: z.string(),
  fetchedAt: z.string(),
  sourceKind: RegistrySourceKindSchema,
  rawHash: z.string(),
});

export const NodeSpecSchema = z.object({
  registryVersion: z.string(),
  syncId: z.string(),
  source: NodeSpecSourceSchema,
  nodeType: z.string(),
  displayName: z.string(),
  category: z.string().optional(),
  subtype: z.string().optional(),
  isGenerative: z.boolean(),
  spendBehavior: z.enum(["credits", "free", "unknown"]),
  model: NodeModelSpecSchema.optional(),
  ports: z.array(PortSpecSchema),
  params: z.array(ParamSpecSchema),
  compatibility: NodeCompatibilitySpecSchema,
  appMode: NodeAppModeSpecSchema,
  raw: z.unknown().optional(),
});

export const RegistryNormalizationWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  sourceKind: RegistrySourceKindSchema.optional(),
  definitionId: z.string().optional(),
  nodeType: z.string().optional(),
});

export const RegistrySourceSummarySchema = z.object({
  sourceKind: RegistrySourceKindSchema,
  fetchedCount: z.number().int().nonnegative(),
  normalizedCount: z.number().int().nonnegative(),
});

export const RawRegistrySnapshotSchema = z.object({
  syncId: z.string(),
  fetchedAt: z.string(),
  apiBaseUrl: z.string(),
  authSource: z.string(),
  sources: z.object({
    public: z.unknown(),
    user: z.unknown(),
    modelPrices: z.unknown(),
  }),
});

export const NormalizedRegistrySnapshotSchema = z.object({
  syncId: z.string(),
  fetchedAt: z.string(),
  registryVersion: z.string(),
  apiBaseUrl: z.string(),
  authSource: z.string(),
  sourceSummaries: z.array(RegistrySourceSummarySchema),
  nodeSpecs: z.array(NodeSpecSchema),
  warnings: z.array(RegistryNormalizationWarningSchema),
});

export const LatestRegistryPointerSchema = z.object({
  syncId: z.string(),
  fetchedAt: z.string(),
  registryVersion: z.string(),
  apiBaseUrl: z.string(),
  authSource: z.string(),
  rawSnapshotPath: z.string(),
  normalizedSnapshotPath: z.string(),
  nodeSpecCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
});
