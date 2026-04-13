import type { NodeSpec, NormalizedRegistrySnapshot, ValueKind } from "../registry/types.ts";
import {
  selectBridgeCandidates,
  selectExportCandidates,
  selectImportCandidates,
  selectUpscaleCandidates,
} from "../registry/capability-selectors.ts";
import { makeCompilerError } from "./errors.ts";
import type { CandidateSelection, CompilerIntent, CompilerTraceEntry } from "./types.ts";

function makeNodeIndex(registry: NormalizedRegistrySnapshot): Map<string, NodeSpec> {
  return new Map(registry.nodeSpecs.map((node) => [node.source.definitionId, node]));
}

function getProducedKinds(definitionIds: string[], index: Map<string, NodeSpec>): Set<ValueKind> {
  return new Set(
    definitionIds.flatMap((definitionId) => index.get(definitionId)?.capabilities.ioProfile.outputKinds || []),
  );
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
  selections.push({ definitionIds: importIds, reason: "selected import candidates" });
  trace.push({ stage: "match", detail: `import candidates=${importIds.join(',')}` });

  let availableKinds = getProducedKinds(importIds, index);
  const needsImageBridge = intent.operations.some((op) => op.kind === "upscale-image") && !availableKinds.has("image");
  if (needsImageBridge) {
    const bridgeIds = selectBridgeCandidates(registry, "file", "image");
    if (bridgeIds.length === 0) {
      return { ok: false, error: makeCompilerError("missing_bridge", "No bridge node can convert uploaded files into image data.", { fromKind: "file", toKind: "image" }) };
    }
    selections.push({ definitionIds: bridgeIds, reason: "inserted file -> image bridge" });
    availableKinds = getProducedKinds(bridgeIds, index);
    trace.push({ stage: "match", detail: `bridge candidates=${bridgeIds.join(',')}` });
  }

  const upscaleIds = selectUpscaleCandidates(registry, intent.originalRequest, availableKinds);
  if (upscaleIds.length === 0) {
    return { ok: false, error: makeCompilerError("missing_operation_capability", "No image-upscale node matches the current capability constraints.", { operation: "upscale-image" }) };
  }
  selections.push({ definitionIds: upscaleIds, reason: "selected upscale candidates" });
  availableKinds = getProducedKinds(upscaleIds, index);
  trace.push({ stage: "match", detail: `upscale candidates=${upscaleIds.join(',')}` });

  const exportIds = selectExportCandidates(registry, intent.originalRequest, availableKinds, intent.output.format);
  if (exportIds.length === 0) {
    return { ok: false, error: makeCompilerError("missing_export_capability", "No export node can satisfy the requested output capability.", { requestedFormat: intent.output.format || null }) };
  }
  selections.push({ definitionIds: exportIds, reason: "selected export candidates" });
  trace.push({ stage: "match", detail: `export candidates=${exportIds.join(',')}` });

  return { ok: true, selections };
}
