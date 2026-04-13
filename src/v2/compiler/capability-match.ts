import type { NodeSpec, NormalizedRegistrySnapshot, ValueKind } from "../registry/types.ts";
import {
  selectBridgeCandidates,
  selectExportCandidates,
  selectImageEditCandidates,
  selectImportCandidates,
  selectUpscaleCandidates,
} from "../registry/capability-selectors.ts";
import { makeCompilerError } from "./errors.ts";
import type { CandidateSelection, CompilerIntent, CompilerOperation, CompilerTraceEntry } from "./types.ts";

function makeNodeIndex(registry: NormalizedRegistrySnapshot): Map<string, NodeSpec> {
  return new Map(registry.nodeSpecs.map((node) => [node.source.definitionId, node]));
}

function getProducedKinds(definitionIds: string[], index: Map<string, NodeSpec>): Set<ValueKind> {
  return new Set(
    definitionIds.flatMap((definitionId) => index.get(definitionId)?.capabilities.ioProfile.outputKinds || []),
  );
}

function selectOperationCandidates(
  operation: CompilerOperation,
  registry: NormalizedRegistrySnapshot,
  requestText: string,
  availableKinds: Set<ValueKind>,
): string[] {
  switch (operation.kind) {
    case "upscale-image":
      return selectUpscaleCandidates(registry, requestText, availableKinds);
    case "edit-image":
      return selectImageEditCandidates(registry, requestText, availableKinds);
    default:
      return [];
  }
}

export function matchImageWorkflowCapabilities(
  intent: CompilerIntent,
  registry: NormalizedRegistrySnapshot,
  trace: CompilerTraceEntry[],
): { ok: true; selections: CandidateSelection[] } | { ok: false; error: ReturnType<typeof makeCompilerError> } {
  const index = makeNodeIndex(registry);
  const selections: CandidateSelection[] = [];

  const importIds = selectImportCandidates(registry, intent.originalRequest);
  if (importIds.length === 0) {
    return { ok: false, error: makeCompilerError("missing_import_capability", "No import node matches the requested image-upload workflow.") };
  }
  selections.push({ operationKind: "upload", definitionIds: importIds, reason: "selected import candidates" });
  trace.push({ stage: "match", detail: `import candidates=${importIds.join(',')}` });

  let availableKinds = getProducedKinds(importIds, index);
  const transformOperations = intent.operations.filter((operation) => operation.kind !== "upload" && operation.kind !== "export");

  for (const operation of transformOperations) {
    if (operation.inputKind === "image" && !availableKinds.has("image")) {
      const bridgeIds = selectBridgeCandidates(registry, "file", "image");
      if (bridgeIds.length === 0) {
        return {
          ok: false,
          error: makeCompilerError("missing_bridge", "No bridge node can convert uploaded files into image data.", {
            fromKind: "file",
            toKind: "image",
            operation: operation.kind,
          }),
        };
      }
      selections.push({ operationKind: "file-to-image", definitionIds: bridgeIds, reason: "inserted file -> image bridge" });
      availableKinds = getProducedKinds(bridgeIds, index);
      trace.push({ stage: "match", detail: `bridge candidates=${bridgeIds.join(',')}` });
    }

    const operationIds = selectOperationCandidates(operation, registry, intent.originalRequest, availableKinds);
    if (operationIds.length === 0) {
      return {
        ok: false,
        error: makeCompilerError("missing_operation_capability", `No ${operation.kind} node matches the current capability constraints.`, {
          operation: operation.kind,
        }),
      };
    }
    selections.push({ operationKind: operation.kind, definitionIds: operationIds, reason: `selected ${operation.kind} candidates` });
    availableKinds = getProducedKinds(operationIds, index);
    trace.push({ stage: "match", detail: `${operation.kind} candidates=${operationIds.join(',')}` });
  }

  const exportOperation = intent.operations.find((operation) => operation.kind === "export");
  if (exportOperation) {
    const exportIds = selectExportCandidates(registry, intent.originalRequest, availableKinds, intent.output.format);
    if (exportIds.length === 0) {
      return { ok: false, error: makeCompilerError("missing_export_capability", "No export node can satisfy the requested output capability.", { requestedFormat: intent.output.format || null }) };
    }
    selections.push({ operationKind: "export", definitionIds: exportIds, reason: "selected export candidates" });
    trace.push({ stage: "match", detail: `export candidates=${exportIds.join(',')}` });
  }

  return { ok: true, selections };
}
