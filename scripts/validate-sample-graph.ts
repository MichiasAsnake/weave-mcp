import { readJsonFile } from "../src/v2/shared/json.ts";
import { createGraphEdgeIR, createGraphNodeIR, createEmptyGraphIR, addEdgeToGraph, addNodeToGraph } from "../src/v2/graph/builders.ts";
import { setAppModeFields } from "../src/v2/graph/app-mode.ts";
import { validateGraph } from "../src/v2/validate/index.ts";
import { normalizeRegistrySnapshot } from "../src/v2/registry/normalize.ts";

import type { NormalizedRegistrySnapshot, RawRegistrySnapshot } from "../src/v2/registry/types.ts";

async function main(): Promise<void> {
  const rawRegistry = await readJsonFile<RawRegistrySnapshot>(
    "data/registry/raw/2026-04-12T15-18-10-043Z.json",
  );
  const registry: NormalizedRegistrySnapshot = normalizeRegistrySnapshot(rawRegistry, {
    registryVersion: "0.1.0",
  });

  let graph = createEmptyGraphIR({
    registryVersion: registry.registryVersion,
    name: "Broken Sample Graph",
    description: "Deliberately broken graph for validator smoke test",
  });

  const integerNode = createGraphNodeIR({
    nodeId: "node-number",
    definitionId: "JbQzwNX9qVhHP59o5yS1",
    nodeType: "integer",
    displayName: "Number",
    params: {},
  });

  const promptNode = createGraphNodeIR({
    nodeId: "node-prompt-target",
    definitionId: "81eef25f-a729-4bdb-a5f7-9f37d5e1c867",
    nodeType: "custommodelV2",
    displayName: "Seedream V5 Edit",
    params: {},
  });

  const videoUtilitiesNode = createGraphNodeIR({
    nodeId: "node-video-utils",
    definitionId: "0cbc194f-8360-4044-8532-aa36bcac1f17",
    nodeType: "custommodelV2",
    displayName: "Video Utilities",
    params: {},
  });

  graph = addNodeToGraph(graph, integerNode);
  graph = addNodeToGraph(graph, promptNode);
  graph = addNodeToGraph(graph, videoUtilitiesNode);

  graph = addEdgeToGraph(
    graph,
    createGraphEdgeIR({
      edgeId: "edge-invalid-number-to-prompt",
      from: {
        nodeId: "node-number",
        portKey: "number",
      },
      to: {
        nodeId: "node-prompt-target",
        portKey: "prompt",
      },
    }),
  );

  graph = setAppModeFields(graph, [
    {
      key: "missing-node-field",
      source: {
        nodeId: "node-does-not-exist",
        bindingType: "param",
        bindingKey: "prompt",
      },
      label: "Missing Node",
      control: "text",
      required: false,
      locked: false,
      visible: true,
    },
    {
      key: "bad-port-field",
      source: {
        nodeId: "node-prompt-target",
        bindingType: "unconnected-input-port",
        bindingKey: "not_a_real_port",
      },
      label: "Bad Port",
      control: "image-upload",
      required: false,
      locked: false,
      visible: true,
    },
  ]);

  const result = validateGraph(graph, registry);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
