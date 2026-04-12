import { readJsonFile } from "../src/v2/shared/json.ts";
import { normalizeRegistrySnapshot } from "../src/v2/registry/normalize.ts";
import {
  connectPortsTool,
  createNodeTool,
  setNodeParamTool,
  setOutputsTool,
} from "../src/v2/tools/index.ts";
import { createEmptyGraphIR } from "../src/v2/graph/builders.ts";

import type { RawRegistrySnapshot } from "../src/v2/registry/types.ts";

async function main(): Promise<void> {
  const rawRegistry = await readJsonFile<RawRegistrySnapshot>(
    "data/registry/raw/2026-04-12T15-18-10-043Z.json",
  );
  const registry = normalizeRegistrySnapshot(rawRegistry, {
    registryVersion: "0.1.0",
  });

  let graph = createEmptyGraphIR({
    registryVersion: registry.registryVersion,
    name: "Tool Layer Sample",
    description: "Sequential atomic tool layer demo",
  });

  const steps = [
    {
      label: "1. create import node",
      run: () =>
        createNodeTool(graph, registry, {
          definitionId: "wkKkBSd0yrZGwbStnU6r",
          nodeId: "node-import",
        }),
    },
    {
      label: "2. create export node",
      run: () =>
        createNodeTool(graph, registry, {
          definitionId: "JyaWOYxm1VCFqfdn6tFi",
          nodeId: "node-export",
        }),
    },
    {
      label: "3. create muxv2 node",
      run: () =>
        createNodeTool(graph, registry, {
          definitionId: "K4Bi14QsmaOKQMHpZsto",
          nodeId: "node-list",
        }),
    },
    {
      label: "4. set muxv2 options param",
      run: () =>
        setNodeParamTool(graph, registry, {
          nodeId: "node-list",
          paramKey: "options",
          value: ["alpha", "beta", "gamma"],
        }),
    },
    {
      label: "5. connect import.file -> export.file",
      run: () =>
        connectPortsTool(graph, registry, {
          edgeId: "edge-import-to-export",
          fromNodeId: "node-import",
          fromPortKey: "file",
          toNodeId: "node-export",
          toPortKey: "file",
        }),
    },
    {
      label: "6. set graph outputs",
      run: () =>
        setOutputsTool(graph, registry, {
          nodeIds: ["node-export"],
        }),
    },
  ];

  for (const step of steps) {
    const result = step.run();
    graph = result.graph;

    console.log(`\n${step.label}`);
    console.log(
      JSON.stringify(
        {
          applied: result.applied,
          issues: result.issues,
          graph,
        },
        null,
        2,
      ),
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
