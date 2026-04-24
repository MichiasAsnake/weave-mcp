import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPromptDescriberCandidates,
  selectPromptEnhancerCandidates,
  selectPromptNodeCandidates,
} from "../registry/capability-selectors.ts";
import { readLatestNormalizedRegistrySnapshot } from "../registry/store.ts";

const registryPromise = readLatestNormalizedRegistrySnapshot();

function cloneWithOverrides(value, overrides) {
  const clone = structuredClone(value);

  if (overrides.source) {
    clone.source = { ...clone.source, ...overrides.source };
  }

  if (overrides.capabilities) {
    clone.capabilities = {
      ...clone.capabilities,
      ...overrides.capabilities,
      ioProfile: {
        ...clone.capabilities.ioProfile,
        ...overrides.capabilities.ioProfile,
      },
    };
  }

  if (overrides.ports) {
    clone.ports = overrides.ports;
  }

  for (const [key, valueOverride] of Object.entries(overrides)) {
    if (key === "source" || key === "capabilities" || key === "ports") continue;
    clone[key] = valueOverride;
  }

  return clone;
}

test("registry selectors rank usable prompt-native planning nodes", async () => {
  const registry = await registryPromise;

  assert.deepEqual(selectPromptNodeCandidates(registry), ["jzXJ8QEfxQm2sZfvzu7q"]);
  assert.deepEqual(selectPromptEnhancerCandidates(registry), ["7gKmskdJQ28nMlxdB6aR"]);
  assert.deepEqual(selectPromptDescriberCandidates(registry, "image"), ["QmgEhPkxIT2o0R769yvK"]);
});

test("prompt node and enhancer selectors ignore noisy mis-tagged candidates", async () => {
  const registry = await registryPromise;
  const promptNode = registry.nodeSpecs.find((node) => node.source.definitionId === "jzXJ8QEfxQm2sZfvzu7q");
  const promptEnhancer = registry.nodeSpecs.find((node) => node.source.definitionId === "7gKmskdJQ28nMlxdB6aR");

  assert.ok(promptNode);
  assert.ok(promptEnhancer);

  const blockedPromptNode = cloneWithOverrides(promptNode, {
    displayName: "AAA Blocked Prompt",
    source: { definitionId: "aaa-blocked-prompt" },
    capabilities: {
      hiddenDependencies: ["secret_prompt_provider"],
      planningHints: [...promptNode.capabilities.planningHints, "avoid_without_model_source"],
    },
  });
  const wrongShapePromptNode = cloneWithOverrides(promptNode, {
    displayName: "AAB Wrong Shape Prompt",
    source: { definitionId: "aab-wrong-shape-prompt" },
    capabilities: {
      ioProfile: {
        summary: "none -> text",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
    },
    ports: [
      {
        key: "image",
        direction: "input",
        kind: "image",
        required: true,
        multi: false,
        accepts: ["image"],
      },
      {
        key: "text",
        direction: "output",
        kind: "text",
        required: false,
        multi: false,
        produces: ["text"],
      },
    ],
  });
  const blockedPromptEnhancer = cloneWithOverrides(promptEnhancer, {
    displayName: "AAA Blocked Prompt Enhancer",
    source: { definitionId: "aaa-blocked-prompt-enhancer" },
    capabilities: {
      hiddenDependencies: ["prompt_refinement_model"],
      planningHints: [...promptEnhancer.capabilities.planningHints, "avoid_without_model_source"],
    },
  });
  const wrongShapePromptEnhancer = cloneWithOverrides(promptEnhancer, {
    displayName: "AAB Wrong Shape Prompt Enhancer",
    source: { definitionId: "aab-wrong-shape-prompt-enhancer" },
    capabilities: {
      ioProfile: {
        summary: "text -> text",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
    },
    ports: [
      {
        key: "image",
        direction: "input",
        kind: "image",
        required: true,
        multi: false,
        accepts: ["image"],
      },
      {
        key: "text",
        direction: "output",
        kind: "text",
        required: false,
        multi: false,
        produces: ["text"],
      },
    ],
  });

  const noisyRegistry = {
    ...registry,
    nodeSpecs: [
      blockedPromptNode,
      wrongShapePromptNode,
      blockedPromptEnhancer,
      wrongShapePromptEnhancer,
      ...registry.nodeSpecs,
    ],
  };

  assert.deepEqual(selectPromptNodeCandidates(noisyRegistry), ["jzXJ8QEfxQm2sZfvzu7q"]);
  assert.deepEqual(selectPromptEnhancerCandidates(noisyRegistry), ["7gKmskdJQ28nMlxdB6aR"]);
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

test("prompt describer selector ignores wrong-output-shape candidates", async () => {
  const registry = await registryPromise;
  const imageDescriber = registry.nodeSpecs.find((node) => node.source.definitionId === "QmgEhPkxIT2o0R769yvK");

  assert.ok(imageDescriber);

  const wrongOutputShapeDescriber = cloneWithOverrides(imageDescriber, {
    displayName: "AAA Wrong Output Describer",
    source: { definitionId: "aaa-wrong-output-describer" },
    capabilities: {
      ioProfile: {
        summary: "image -> image",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["image"],
      },
    },
    ports: [
      {
        key: "image",
        direction: "input",
        kind: "image",
        required: true,
        multi: false,
        accepts: ["image"],
      },
      {
        key: "image_out",
        direction: "output",
        kind: "image",
        required: false,
        multi: false,
        produces: ["image"],
      },
    ],
  });

  const noisyRegistry = {
    ...registry,
    nodeSpecs: [wrongOutputShapeDescriber],
  };

  assert.deepEqual(selectPromptDescriberCandidates(noisyRegistry, "image"), []);
});
