import { z } from "zod";

import { setAppModeFields } from "../graph/app-mode.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolResult } from "./types.ts";
import {
  SetAppModeFieldToolLLMInputSchema,
  SetAppModeFieldToolInputSchema,
  finalizeToolMutation,
} from "./types.ts";

export type SetAppModeFieldToolInput = z.infer<typeof SetAppModeFieldToolInputSchema>;
export type SetAppModeFieldToolLLMInput = z.infer<typeof SetAppModeFieldToolLLMInputSchema>;

const SetAppModeFieldToolAnyInputSchema = z.union([
  SetAppModeFieldToolInputSchema,
  SetAppModeFieldToolLLMInputSchema,
]);

export function setAppModeFieldTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: SetAppModeFieldToolInput | SetAppModeFieldToolLLMInput,
): ToolResult {
  const input = SetAppModeFieldToolAnyInputSchema.parse(rawInput);
  const normalizedField = SetAppModeFieldToolInputSchema.shape.field.parse({
    ...input.field,
    defaultValue: input.field.defaultValue ?? undefined,
    helpText: input.field.helpText ?? undefined,
  });
  const existingIndex = graph.appMode.fields.findIndex((field) => field.key === normalizedField.key);

  const nextFields =
    existingIndex >= 0
      ? graph.appMode.fields.map((field, index) => (index === existingIndex ? normalizedField : field))
      : [...graph.appMode.fields, normalizedField];

  const candidateGraph = setAppModeFields(graph, nextFields);
  return finalizeToolMutation(graph, candidateGraph, registry);
}
