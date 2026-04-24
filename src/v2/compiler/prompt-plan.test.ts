import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPromptDescriberCandidates,
  selectPromptEnhancerCandidates,
  selectPromptNodeCandidates,
} from "../registry/capability-selectors.ts";
import { readLatestNormalizedRegistrySnapshot } from "../registry/store.ts";

const registryPromise = readLatestNormalizedRegistrySnapshot();

test("registry selectors rank usable prompt-native planning nodes", async () => {
  const registry = await registryPromise;

  assert.deepEqual(selectPromptNodeCandidates(registry), ["jzXJ8QEfxQm2sZfvzu7q"]);
  assert.deepEqual(selectPromptEnhancerCandidates(registry), ["7gKmskdJQ28nMlxdB6aR"]);
  assert.deepEqual(selectPromptDescriberCandidates(registry, "image"), ["QmgEhPkxIT2o0R769yvK"]);
});

test("prompt describer selector excludes unusable video candidates", async () => {
  const registry = await registryPromise;

  const selectedVideoCandidates = selectPromptDescriberCandidates(registry, "video");
  const registryVideoDescriber = registry.nodeSpecs.find(
    (node) => node.source.definitionId === "0eadf99d-a5b8-404c-8d7d-508883d6bd22",
  );

  assert.ok(registryVideoDescriber);
  assert.ok(registryVideoDescriber.capabilities.planningHints.includes("prefer_for_asset_to_prompt"));
  assert.ok(registryVideoDescriber.capabilities.planningHints.includes("avoid_without_model_source"));
  assert.deepEqual(registryVideoDescriber.capabilities.hiddenDependencies, ["video_url"]);
  assert.deepEqual(selectedVideoCandidates, []);
});
