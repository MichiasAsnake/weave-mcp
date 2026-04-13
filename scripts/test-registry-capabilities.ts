import { readJsonFile } from "../src/v2/shared/json.ts";
import { normalizeRegistrySnapshot } from "../src/v2/registry/normalize.ts";

import type { NodeSpec, RawRegistrySnapshot } from "../src/v2/registry/types.ts";

async function main(): Promise<void> {
  const rawSnapshot = await readJsonFile<RawRegistrySnapshot>(
    "data/registry/raw/2026-04-12T15-18-10-043Z.json",
  );
  const registry = normalizeRegistrySnapshot(rawSnapshot, {
    registryVersion: "0.1.0",
  });

  assertNode(registry.nodeSpecs, "wkKkBSd0yrZGwbStnU6r", {
    functionalRole: "import",
    ioProfile: "none -> file",
    planningHint: "prefer_for_file_import",
  });
  assertNode(registry.nodeSpecs, "SeV3xgeqgpZYmyHgQ205", {
    functionalRole: "transform",
    ioProfile: "image -> image",
    planningHint: "prefer_for_simple_image_upscale",
  });
  assertNode(registry.nodeSpecs, "1qYW4dNMRDIjEu5Yi5Rk", {
    dependencyComplexity: "heavy",
    hiddenDependency: "custom_sd_model",
  });
  assertNode(registry.nodeSpecs, "3w4OpEQntPBVwfbTkFnB", {
    functionalRole: "bridge",
    ioProfile: "file -> image",
    bridgeSuitability: "primary",
  });
  assertNode(registry.nodeSpecs, "wyS4YwhP8zrq110ixxl7", {
    functionalRole: "export",
    ioProfile: "image -> file",
  });
  assertNode(registry.nodeSpecs, "cXDqkhpo0Ul0hhWb5zFA", {
    taskTag: "image-edit",
    planningHint: "requires_text_prompt",
  });

  console.log(JSON.stringify({
    ok: true,
    checked: [
      "wkKkBSd0yrZGwbStnU6r",
      "SeV3xgeqgpZYmyHgQ205",
      "1qYW4dNMRDIjEu5Yi5Rk",
      "3w4OpEQntPBVwfbTkFnB",
      "wyS4YwhP8zrq110ixxl7",
      "cXDqkhpo0Ul0hhWb5zFA",
    ],
  }, null, 2));
}

function assertNode(
  nodeSpecs: NodeSpec[],
  definitionId: string,
  expected: {
    functionalRole?: string;
    ioProfile?: string;
    dependencyComplexity?: string;
    bridgeSuitability?: string;
    hiddenDependency?: string;
    taskTag?: string;
    planningHint?: string;
  },
): void {
  const node = nodeSpecs.find((entry) => entry.source.definitionId === definitionId);
  if (!node) {
    throw new Error(`Missing node ${definitionId}`);
  }

  if (expected.functionalRole && node.capabilities.functionalRole !== expected.functionalRole) {
    throw new Error(`${definitionId}: expected functionalRole=${expected.functionalRole} got ${node.capabilities.functionalRole}`);
  }
  if (expected.ioProfile && node.capabilities.ioProfile.summary !== expected.ioProfile) {
    throw new Error(`${definitionId}: expected ioProfile=${expected.ioProfile} got ${node.capabilities.ioProfile.summary}`);
  }
  if (expected.dependencyComplexity && node.capabilities.dependencyComplexity !== expected.dependencyComplexity) {
    throw new Error(
      `${definitionId}: expected dependencyComplexity=${expected.dependencyComplexity} got ${node.capabilities.dependencyComplexity}`,
    );
  }
  if (expected.bridgeSuitability && node.capabilities.bridgeSuitability !== expected.bridgeSuitability) {
    throw new Error(`${definitionId}: expected bridgeSuitability=${expected.bridgeSuitability} got ${node.capabilities.bridgeSuitability}`);
  }
  if (expected.hiddenDependency && !node.capabilities.hiddenDependencies.includes(expected.hiddenDependency)) {
    throw new Error(`${definitionId}: missing hidden dependency ${expected.hiddenDependency}`);
  }
  if (expected.taskTag && !node.capabilities.taskTags.includes(expected.taskTag)) {
    throw new Error(`${definitionId}: missing task tag ${expected.taskTag}`);
  }
  if (expected.planningHint && !node.capabilities.planningHints.includes(expected.planningHint)) {
    throw new Error(`${definitionId}: missing planning hint ${expected.planningHint}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
