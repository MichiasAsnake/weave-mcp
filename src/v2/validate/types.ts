import type { GraphIR } from "../graph/types.ts";
import type { NodeSpec, NormalizedRegistrySnapshot } from "../registry/types.ts";

export type ValidationSeverity = "error" | "warning";

export interface ValidationContext {
  definitionId?: string;
  nodeType?: string;
  nodeId?: string;
  edgeId?: string;
  fieldKey?: string;
  bindingType?: "param" | "unconnected-input-port";
  bindingKey?: string;
  portKey?: string;
}

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  context: ValidationContext;
}

export interface ValidationResult {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: ValidationIssue[];
}

export interface RegistryValidationIndex {
  snapshot: NormalizedRegistrySnapshot;
  nodeSpecsByDefinitionId: Map<string, NodeSpec>;
}

export interface ValidationContextState {
  graph: GraphIR;
  registry: NormalizedRegistrySnapshot;
  registryIndex: RegistryValidationIndex;
}
