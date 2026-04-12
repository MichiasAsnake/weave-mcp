export type RegistrySourceKind = "public" | "user";

export type ValueKind =
  | "text"
  | "number"
  | "boolean"
  | "enum"
  | "image"
  | "video"
  | "audio"
  | "mask"
  | "3d"
  | "array"
  | "object"
  | "any"
  | "file"
  | "json"
  | "unknown";

export interface ParamUiSpec {
  control?: "textbox" | "textarea" | "slider" | "toggle" | "select" | "file";
  label?: string;
  group?: string;
  order?: number;
  hidden?: boolean;
}

export interface ParamAppModeSpec {
  exposable: boolean;
  defaultExposed: boolean;
  lockable: boolean;
}

export interface PortSpec {
  key: string;
  direction: "input" | "output";
  kind: ValueKind;
  required: boolean;
  multi: boolean;
  accepts?: ValueKind[];
  produces?: ValueKind[];
  raw?: unknown;
}

export interface ParamSpec {
  key: string;
  kind: ValueKind;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
  min?: number;
  max?: number;
  step?: number;
  ui?: ParamUiSpec;
  appMode?: ParamAppModeSpec;
  raw?: unknown;
}

export interface NodeModelSpec {
  provider?: string;
  name?: string;
  pricingKey?: string;
  matchedPriceCredits?: number | null;
}

export interface NodeCompatibilitySpec {
  acceptsKinds: ValueKind[];
  producesKinds: ValueKind[];
  requiresAllMandatoryInputs: boolean;
}

export interface NodeAppModeSpec {
  supportsOutputNode: boolean;
  exposableParams: string[];
  exposablePorts: string[];
}

export interface NodeSpecSource {
  definitionId: string;
  fetchedAt: string;
  sourceKind: RegistrySourceKind;
  rawHash: string;
}

export interface NodeSpec {
  registryVersion: string;
  syncId: string;
  source: NodeSpecSource;
  nodeType: string;
  displayName: string;
  category?: string;
  subtype?: string;
  isGenerative: boolean;
  spendBehavior: "credits" | "free" | "unknown";
  model?: NodeModelSpec;
  ports: PortSpec[];
  params: ParamSpec[];
  compatibility: NodeCompatibilitySpec;
  appMode: NodeAppModeSpec;
  raw?: unknown;
}

export interface RegistryNormalizationWarning {
  code: string;
  message: string;
  sourceKind?: RegistrySourceKind;
  definitionId?: string;
  nodeType?: string;
}

export interface RegistrySourceSummary {
  sourceKind: RegistrySourceKind;
  fetchedCount: number;
  normalizedCount: number;
}

export interface RawRegistrySnapshot {
  syncId: string;
  fetchedAt: string;
  apiBaseUrl: string;
  authSource: string;
  sources: {
    public: unknown;
    user: unknown;
    modelPrices: unknown;
  };
}

export interface NormalizedRegistrySnapshot {
  syncId: string;
  fetchedAt: string;
  registryVersion: string;
  apiBaseUrl: string;
  authSource: string;
  sourceSummaries: RegistrySourceSummary[];
  nodeSpecs: NodeSpec[];
  warnings: RegistryNormalizationWarning[];
}

export interface LatestRegistryPointer {
  syncId: string;
  fetchedAt: string;
  registryVersion: string;
  apiBaseUrl: string;
  authSource: string;
  rawSnapshotPath: string;
  normalizedSnapshotPath: string;
  nodeSpecCount: number;
  warningCount: number;
}

export interface RegistryFileWriteResult {
  rawSnapshotPath: string;
  normalizedSnapshotPath: string;
  latestPointerPath: string;
}

export interface SyncWeaveRegistryResult extends RegistryFileWriteResult {
  snapshot: NormalizedRegistrySnapshot;
}
