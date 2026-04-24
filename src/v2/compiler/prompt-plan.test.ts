import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPromptDescriberCandidates,
  selectPromptEnhancerCandidates,
  selectPromptNodeCandidates,
} from "../registry/capability-selectors.ts";
import { readLatestNormalizedRegistrySnapshot } from "../registry/store.ts";

const registryPromise = readLatestNormalizedRegistrySnapshot();

test("registry selectors expose prompt-native planning nodes", async () => {
  const registry = await registryPromise;

  assert.ok(selectPromptNodeCandidates(registry).length > 0);
  assert.ok(selectPromptEnhancerCandidates(registry).length > 0);
  assert.ok(selectPromptDescriberCandidates(registry, "image").length > 0);
});
