// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import { appendCheckpoint, appendMessage, loadRegistrySnapshot, persistState } from "./shared.ts";

export async function loadRegistryNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "load_registry");
  const registrySnapshot = await loadRegistrySnapshot(runtime);

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    registrySnapshot,
    registryVersion: registrySnapshot.registryVersion,
    status: "interpret_request",
    messages: appendMessage(
      state,
      {
        nodeName: "load_registry",
        role: "system",
        content: `Loaded registry snapshot ${registrySnapshot.syncId} at version ${registrySnapshot.registryVersion}.`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "load_registry",
        note: `Registry ${registrySnapshot.registryVersion} loaded for orchestration.`,
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}
