import { z } from "zod";

import { setAppModeFields } from "../graph/app-mode.ts";
import type { GraphIR } from "../graph/types.ts";
import type { RegistrySnapshot, ToolResult } from "./types.ts";
import {
  SetAppModeFieldToolInputSchema,
  finalizeToolMutation,
} from "./types.ts";

export type SetAppModeFieldToolInput = z.infer<typeof SetAppModeFieldToolInputSchema>;

export function setAppModeFieldTool(
  graph: GraphIR,
  registry: RegistrySnapshot,
  rawInput: SetAppModeFieldToolInput,
): ToolResult {
  const input = SetAppModeFieldToolInputSchema.parse(rawInput);
  const existingIndex = graph.appMode.fields.findIndex((field) => field.key === input.field.key);

  const nextFields =
    existingIndex >= 0
      ? graph.appMode.fields.map((field, index) => (index === existingIndex ? input.field : field))
      : [...graph.appMode.fields, input.field];

  const candidateGraph = setAppModeFields(graph, nextFields);
  return finalizeToolMutation(graph, candidateGraph, registry);
}
