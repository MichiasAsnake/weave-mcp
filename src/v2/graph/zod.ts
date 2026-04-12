import { z } from "zod";

import {
  JsonValueSchema,
  NodeDefinitionIdSchema,
  NodeTypeSchema,
  PortKindSchema,
} from "../generated/node-schemas.ts";

export const GraphIRVersionSchema = z.literal("1");

export const GraphMetadataIRSchema = z.object({
  graphId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  sourceTemplateId: z.string().min(1).optional(),
});

export const GraphNodeIRSchema = z.object({
  nodeId: z.string().min(1),
  definitionId: NodeDefinitionIdSchema,
  nodeType: NodeTypeSchema,
  displayName: z.string().optional(),
  params: z.record(z.string(), JsonValueSchema),
});

export const GraphPortRefIRSchema = z.object({
  nodeId: z.string().min(1),
  portKey: z.string().min(1),
  valueKind: PortKindSchema.optional(),
});

export const GraphEdgeIRSchema = z.object({
  edgeId: z.string().min(1),
  from: GraphPortRefIRSchema,
  to: GraphPortRefIRSchema,
});

export const GraphOutputsIRSchema = z.object({
  nodeIds: z.array(z.string().min(1)),
});

export const AppFieldBindingTypeSchema = z.enum(["param", "unconnected-input-port"]);

export const AppFieldBindingIRSchema = z.object({
  nodeId: z.string().min(1),
  bindingType: AppFieldBindingTypeSchema,
  bindingKey: z.string().min(1),
});

export const AppFieldControlSchema = z.enum([
  "text",
  "textarea",
  "number",
  "toggle",
  "select",
  "image-upload",
  "video-upload",
  "audio-upload",
]);

export const AppFieldIRSchema = z.object({
  key: z.string().min(1),
  source: AppFieldBindingIRSchema,
  label: z.string().min(1),
  control: AppFieldControlSchema,
  required: z.boolean(),
  locked: z.boolean(),
  visible: z.boolean(),
  defaultValue: JsonValueSchema.optional(),
  helpText: z.string().optional(),
});

export const AppModeSectionIRSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  fieldKeys: z.array(z.string().min(1)),
});

export const GraphAppModeIRSchema = z.object({
  enabled: z.boolean(),
  versionLabel: z.string().min(1).optional(),
  publishState: z.enum(["draft", "published"]),
  exposureStrategy: z.enum(["auto", "manual"]),
  fields: z.array(AppFieldIRSchema),
  layout: z.object({
    sections: z.array(AppModeSectionIRSchema),
  }),
});

export const GraphIRSchema = z.object({
  irVersion: GraphIRVersionSchema,
  registryVersion: z.string().min(1),
  metadata: GraphMetadataIRSchema,
  nodes: z.array(GraphNodeIRSchema),
  edges: z.array(GraphEdgeIRSchema),
  outputs: GraphOutputsIRSchema,
  appMode: GraphAppModeIRSchema,
});
