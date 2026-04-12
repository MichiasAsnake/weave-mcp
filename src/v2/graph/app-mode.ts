import type { AppFieldIR, AppModeSectionIR, GraphAppModeIR, GraphIR } from "./types.ts";

import { AppFieldIRSchema, GraphAppModeIRSchema } from "./zod.ts";

export function createAppFieldIR(field: AppFieldIR): AppFieldIR {
  return AppFieldIRSchema.parse(field);
}

export function createDefaultAppModeIR(args?: {
  enabled?: boolean;
  versionLabel?: string;
  publishState?: GraphAppModeIR["publishState"];
  exposureStrategy?: GraphAppModeIR["exposureStrategy"];
  fields?: AppFieldIR[];
  sections?: AppModeSectionIR[];
}): GraphAppModeIR {
  const fields = (args?.fields || []).map((field) => createAppFieldIR(field));
  const sections = args?.sections || buildAutoAppModeSections(fields);

  return GraphAppModeIRSchema.parse({
    enabled: args?.enabled ?? false,
    versionLabel: args?.versionLabel,
    publishState: args?.publishState ?? "draft",
    exposureStrategy: args?.exposureStrategy ?? "auto",
    fields,
    layout: {
      sections,
    },
  });
}

export function buildAutoAppModeSections(fields: AppFieldIR[]): AppModeSectionIR[] {
  const visibleFieldKeys = fields.filter((field) => field.visible).map((field) => field.key);
  if (visibleFieldKeys.length === 0) {
    return [];
  }

  return [
    {
      key: "inputs",
      label: "Inputs",
      fieldKeys: visibleFieldKeys,
    },
  ];
}

export function setAppModeFields(
  graph: GraphIR,
  fields: AppFieldIR[],
  options?: {
    exposureStrategy?: GraphAppModeIR["exposureStrategy"];
    publishState?: GraphAppModeIR["publishState"];
    versionLabel?: string;
    sections?: AppModeSectionIR[];
  },
): GraphIR {
  const parsedFields = fields.map((field) => createAppFieldIR(field));
  const sections = options?.sections || buildAutoAppModeSections(parsedFields);

  return {
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    appMode: createDefaultAppModeIR({
      enabled: graph.appMode.enabled,
      versionLabel: options?.versionLabel ?? graph.appMode.versionLabel,
      publishState: options?.publishState ?? graph.appMode.publishState,
      exposureStrategy: options?.exposureStrategy ?? graph.appMode.exposureStrategy,
      fields: parsedFields,
      sections,
    }),
  };
}

export function setAppModeEnabled(graph: GraphIR, enabled: boolean): GraphIR {
  return {
    ...graph,
    metadata: {
      ...graph.metadata,
      updatedAt: new Date().toISOString(),
    },
    appMode: createDefaultAppModeIR({
      enabled,
      versionLabel: graph.appMode.versionLabel,
      publishState: graph.appMode.publishState,
      exposureStrategy: graph.appMode.exposureStrategy,
      fields: graph.appMode.fields,
      sections: graph.appMode.layout.sections,
    }),
  };
}
