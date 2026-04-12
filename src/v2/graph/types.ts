import type { ValueKind } from "../registry/types.ts";

export type GraphIRVersion = "1";

export interface GraphMetadataIR {
  graphId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  sourceTemplateId?: string;
}

export interface GraphNodeIR {
  nodeId: string;
  definitionId: string;
  nodeType: string;
  displayName?: string;
  params: Record<string, unknown>;
}

export interface GraphPortRefIR {
  nodeId: string;
  portKey: string;
  valueKind?: ValueKind;
}

export interface GraphEdgeIR {
  edgeId: string;
  from: GraphPortRefIR;
  to: GraphPortRefIR;
}

export interface GraphOutputsIR {
  nodeIds: string[];
}

export type AppFieldBindingType = "param" | "unconnected-input-port";

export interface AppFieldBindingIR {
  nodeId: string;
  bindingType: AppFieldBindingType;
  bindingKey: string;
}

export type AppFieldControl =
  | "text"
  | "textarea"
  | "number"
  | "toggle"
  | "select"
  | "image-upload"
  | "video-upload"
  | "audio-upload";

export interface AppFieldIR {
  key: string;
  source: AppFieldBindingIR;
  label: string;
  control: AppFieldControl;
  required: boolean;
  locked: boolean;
  visible: boolean;
  defaultValue?: unknown;
  helpText?: string;
}

export interface AppModeSectionIR {
  key: string;
  label: string;
  fieldKeys: string[];
}

export interface GraphAppModeIR {
  enabled: boolean;
  versionLabel?: string;
  publishState: "draft" | "published";
  exposureStrategy: "auto" | "manual";
  fields: AppFieldIR[];
  layout: {
    sections: AppModeSectionIR[];
  };
}

export interface GraphIR {
  irVersion: GraphIRVersion;
  registryVersion: string;
  metadata: GraphMetadataIR;
  nodes: GraphNodeIR[];
  edges: GraphEdgeIR[];
  outputs: GraphOutputsIR;
  appMode: GraphAppModeIR;
}
