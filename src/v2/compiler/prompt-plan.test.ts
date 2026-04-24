import assert from "node:assert/strict";
import test from "node:test";

import {
  selectPromptDescriberCandidates,
  selectPromptEnhancerCandidates,
  selectPromptNodeCandidates,
} from "../registry/capability-selectors.ts";
import { refreshRegistryCapabilities } from "../registry/capabilities.ts";
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

test("prompt source and enhancer survive definition id drift against noisy exact-shape competitors", async () => {
  const registry = await registryPromise;
  const promptNode = registry.nodeSpecs.find((node) => node.source.definitionId === "jzXJ8QEfxQm2sZfvzu7q");
  const promptEnhancer = registry.nodeSpecs.find((node) => node.source.definitionId === "7gKmskdJQ28nMlxdB6aR");
  const legacyPromptNode = registry.nodeSpecs.find((node) => node.source.definitionId === "OBtdfjfMoqp3PAzVUBHd");

  assert.ok(promptNode);
  assert.ok(promptEnhancer);
  assert.ok(legacyPromptNode);

  const driftedPromptNode = cloneWithOverrides(promptNode, {
    source: { definitionId: "drifted-prompt-source" },
  });
  const driftedPromptEnhancer = cloneWithOverrides(promptEnhancer, {
    source: { definitionId: "drifted-prompt-enhancer" },
  });

  const refreshedRegistry = refreshRegistryCapabilities({
    ...registry,
    nodeSpecs: [driftedPromptNode, driftedPromptEnhancer],
  });
  const refreshedPromptNode = refreshedRegistry.nodeSpecs[0];
  const refreshedPromptEnhancer = refreshedRegistry.nodeSpecs[1];

  assert.ok(refreshedPromptNode);
  assert.ok(refreshedPromptEnhancer);

  const noisyPromptNode = cloneWithOverrides(promptNode, {
    displayName: "Noisy Prompt Source",
    nodeType: "custom_prompt_source",
    source: { definitionId: "noisy-prompt-source" },
    capabilities: {
      planningHints: ["prefer_for_prompt_source"],
      taskTags: ["prompt-source", "prompt-input"],
    },
  });
  const noisyPromptEnhancer = cloneWithOverrides(promptEnhancer, {
    displayName: "Noisy Prompt Enhancer",
    nodeType: "custom_prompt_enhancer",
    source: { definitionId: "noisy-prompt-enhancer" },
    model: { name: "custom_llm" },
    capabilities: {
      planningHints: ["prefer_for_prompt_enhancement"],
      taskTags: ["prompt-enhance"],
    },
  });

  const promptRegistry = {
    ...registry,
    nodeSpecs: [refreshedPromptNode, noisyPromptNode, legacyPromptNode],
  };
  const enhancerRegistry = {
    ...registry,
    nodeSpecs: [refreshedPromptEnhancer, noisyPromptEnhancer],
  };

  assert.ok(refreshedPromptEnhancer.capabilities.planningHints.includes("prefer_for_prompt_refinement"));
  assert.deepEqual(selectPromptNodeCandidates(promptRegistry), ["drifted-prompt-source"]);
  assert.deepEqual(selectPromptEnhancerCandidates(enhancerRegistry), ["drifted-prompt-enhancer"]);
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

test("prompt enhancer selector ignores multi-input text combiner candidates", async () => {
  const registry = await registryPromise;
  const promptEnhancer = registry.nodeSpecs.find((node) => node.source.definitionId === "7gKmskdJQ28nMlxdB6aR");

  assert.ok(promptEnhancer);

  const multiInputTextCombiner = cloneWithOverrides(promptEnhancer, {
    displayName: "AAA Text Combiner",
    source: { definitionId: "aaa-text-combiner" },
    capabilities: {
      ioProfile: {
        summary: "text+text -> text",
        requiredInputKinds: ["text", "text"],
        acceptedInputKinds: ["text"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
    },
    ports: [
      {
        key: "subject",
        direction: "input",
        kind: "text",
        required: true,
        multi: false,
        accepts: ["text"],
      },
      {
        key: "style",
        direction: "input",
        kind: "text",
        required: true,
        multi: false,
        accepts: ["text"],
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
    nodeSpecs: [multiInputTextCombiner],
  };

  assert.deepEqual(selectPromptEnhancerCandidates(noisyRegistry), []);
});

test("prompt enhancer selector ignores variadic single-port candidates", async () => {
  const registry = await registryPromise;
  const promptEnhancer = registry.nodeSpecs.find((node) => node.source.definitionId === "7gKmskdJQ28nMlxdB6aR");

  assert.ok(promptEnhancer);

  const variadicPromptEnhancer = cloneWithOverrides(promptEnhancer, {
    displayName: "AAA Variadic Prompt Enhancer",
    source: { definitionId: "aaa-variadic-prompt-enhancer" },
    ports: [
      {
        key: "text",
        direction: "input",
        kind: "text",
        required: true,
        multi: true,
        accepts: ["text"],
      },
      {
        key: "text_out",
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
    nodeSpecs: [variadicPromptEnhancer],
  };

  assert.deepEqual(selectPromptEnhancerCandidates(noisyRegistry), []);
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

test("prompt describer selector survives definition id drift via display-name overrides", async () => {
  const registry = await registryPromise;
  const imageDescriber = registry.nodeSpecs.find((node) => node.source.definitionId === "QmgEhPkxIT2o0R769yvK");

  assert.ok(imageDescriber);

  const driftedImageDescriber = cloneWithOverrides(imageDescriber, {
    source: { definitionId: "drifted-image-describer" },
  });

  const refreshedRegistry = refreshRegistryCapabilities({
    ...registry,
    nodeSpecs: [driftedImageDescriber],
  });

  assert.ok(
    refreshedRegistry.nodeSpecs[0]?.capabilities.planningHints.includes("prefer_for_asset_to_prompt"),
  );
  assert.deepEqual(selectPromptDescriberCandidates(refreshedRegistry, "image"), ["drifted-image-describer"]);
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

test("prompt describer selector ignores candidates with extra required inputs", async () => {
  const registry = await registryPromise;
  const imageDescriber = registry.nodeSpecs.find((node) => node.source.definitionId === "QmgEhPkxIT2o0R769yvK");

  assert.ok(imageDescriber);

  const extraRequiredInputDescriber = cloneWithOverrides(imageDescriber, {
    displayName: "AAA Extra Input Describer",
    source: { definitionId: "aaa-extra-input-describer" },
    capabilities: {
      ioProfile: {
        summary: "image+text -> text",
        requiredInputKinds: ["image", "text"],
        acceptedInputKinds: ["image", "text"],
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
        key: "instruction",
        direction: "input",
        kind: "text",
        required: true,
        multi: false,
        accepts: ["text"],
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
    nodeSpecs: [extraRequiredInputDescriber],
  };

  assert.deepEqual(selectPromptDescriberCandidates(noisyRegistry, "image"), []);
});

test("prompt describer selector ignores candidates with multiple required asset inputs", async () => {
  const registry = await registryPromise;
  const imageDescriber = registry.nodeSpecs.find((node) => node.source.definitionId === "QmgEhPkxIT2o0R769yvK");

  assert.ok(imageDescriber);

  const multiAssetDescriber = cloneWithOverrides(imageDescriber, {
    displayName: "AAA Multi Asset Describer",
    source: { definitionId: "aaa-multi-asset-describer" },
    capabilities: {
      ioProfile: {
        summary: "image+image -> text",
        requiredInputKinds: ["image", "image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
    },
    ports: [
      {
        key: "image_primary",
        direction: "input",
        kind: "image",
        required: true,
        multi: false,
        accepts: ["image"],
      },
      {
        key: "image_reference",
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
    nodeSpecs: [multiAssetDescriber],
  };

  assert.deepEqual(selectPromptDescriberCandidates(noisyRegistry, "image"), []);
});

test("prompt describer selector ignores candidates with permissive non-asset inputs", async () => {
  const registry = await registryPromise;
  const imageDescriber = registry.nodeSpecs.find((node) => node.source.definitionId === "QmgEhPkxIT2o0R769yvK");

  assert.ok(imageDescriber);

  const permissiveInputDescriber = cloneWithOverrides(imageDescriber, {
    displayName: "AAA Permissive Describer",
    source: { definitionId: "aaa-permissive-describer" },
    capabilities: {
      ioProfile: {
        summary: "image -> text",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image", "text"],
        optionalInputKinds: ["text"],
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
        key: "instruction",
        direction: "input",
        kind: "text",
        required: false,
        multi: false,
        accepts: ["text"],
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
    nodeSpecs: [permissiveInputDescriber],
  };

  assert.deepEqual(selectPromptDescriberCandidates(noisyRegistry, "image"), []);
});

test("prompt describer selector ignores variadic single-port candidates", async () => {
  const registry = await registryPromise;
  const imageDescriber = registry.nodeSpecs.find((node) => node.source.definitionId === "QmgEhPkxIT2o0R769yvK");

  assert.ok(imageDescriber);

  const variadicDescriber = cloneWithOverrides(imageDescriber, {
    displayName: "AAA Variadic Describer",
    source: { definitionId: "aaa-variadic-describer" },
    ports: [
      {
        key: "image",
        direction: "input",
        kind: "image",
        required: true,
        multi: true,
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
    nodeSpecs: [variadicDescriber],
  };

  assert.deepEqual(selectPromptDescriberCandidates(noisyRegistry, "image"), []);
});
