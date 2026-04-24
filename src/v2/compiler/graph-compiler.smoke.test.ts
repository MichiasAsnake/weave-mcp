import test from "node:test";
import assert from "node:assert/strict";

import { compileWorkflowFromRequest } from "./graph-compiler.ts";
import { readLatestNormalizedRegistrySnapshot } from "../registry/store.ts";

const registryPromise = readLatestNormalizedRegistrySnapshot();

async function compileOrThrow(userRequest: string) {
  const registry = await registryPromise;
  const result = await compileWorkflowFromRequest(userRequest, { registry });
  if (result.ok === false) {
    assert.fail(
      `Compilation failed for "${userRequest}": ${result.error.code} ${result.error.message}\n${result.trace.map((entry) => `${entry.stage}: ${entry.detail}`).join("\n")}`,
    );
  }
  return result;
}

function countNodeType(result: Awaited<ReturnType<typeof compileOrThrow>>, nodeType: string): number {
  return result.graph.nodes.filter((node) => node.nodeType === nodeType).length;
}

function countPurpose(result: Awaited<ReturnType<typeof compileOrThrow>>, purpose: string): number {
  return result.plan.nodes.filter((node) => node.purpose === purpose).length;
}

function getCoverage(result: Awaited<ReturnType<typeof compileOrThrow>>, operationKind: string) {
  const entry = result.plan.primitiveCoverage.find((coverage) => coverage.operationKind === operationKind);
  assert.ok(entry, `Expected primitive coverage for ${operationKind}`);
  return entry;
}

function getGap(result: Awaited<ReturnType<typeof compileOrThrow>>, operationKind: string) {
  const entry = result.plan.gaps.find((gap) => gap.operationKind === operationKind);
  assert.ok(entry, `Expected primitive gap for ${operationKind}`);
  return entry;
}

function hasField(
  result: Awaited<ReturnType<typeof compileOrThrow>>,
  predicate: (field: Awaited<ReturnType<typeof compileOrThrow>>["graph"]["appMode"]["fields"][number]) => boolean,
): boolean {
  return result.graph.appMode.fields.some(predicate);
}

async function getRegistryNode(definitionId: string) {
  const registry = await registryPromise;
  const node = registry.nodeSpecs.find((entry) => entry.source.definitionId === definitionId);
  assert.ok(node, `Expected registry node ${definitionId}`);
  return node;
}

test("compiler returns question-required for underspecified bag ad generator requests", async () => {
  const registry = await registryPromise;
  const result = await compileWorkflowFromRequest("build a bag ad scene generator", { registry });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "question-required");
    assert.equal(result.questions.length, 1);
    assert.equal(result.graph, null);
  }
});

test("compiler returns prompt scaffolding and explanation for prompt-driven graph generation", async () => {
  const registry = await registryPromise;
  const result = await compileWorkflowFromRequest(
    "build an app where I upload a bag image, generate three luxury travel ad scenes, and return the images",
    { registry },
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "complete");
    assert.ok(result.graph);
    assert.ok(result.promptDraft.length >= 1);
    assert.match(result.explanation?.summary || "", /ad scenes/i);
  }
});

test("normalized registry includes live helper nodes recovered from the public all-nodes flow", async () => {
  const routerNode = await getRegistryNode("Pgl8wL2X58uh8ZdehDtU");
  assert.equal(routerNode.displayName, "Router");
  assert.deepEqual(routerNode.capabilities.ioProfile.outputKinds, ["any"]);
  assert.ok(routerNode.ports.some((port) => port.direction === "input" && port.key === "in" && port.kind === "any"));
  assert.ok(routerNode.ports.some((port) => port.direction === "output" && port.key === "out" && port.kind === "any"));

  const compareNode = await getRegistryNode("comparison");
  assert.equal(compareNode.displayName, "Compare");
  assert.deepEqual(compareNode.capabilities.ioProfile.outputKinds, ["any"]);
  assert.ok(compareNode.ports.some((port) => port.direction === "input" && port.key === "input_a" && port.kind === "any"));
  assert.ok(compareNode.ports.some((port) => port.direction === "output" && port.key === "out_b" && port.kind === "any"));

  const klingElementNode = await getRegistryNode("kling_element");
  assert.equal(klingElementNode.displayName, "Kling Element");
  assert.deepEqual(klingElementNode.capabilities.ioProfile.outputKinds, ["object"]);
  assert.ok(klingElementNode.ports.some((port) => port.direction === "output" && port.key === "result" && port.kind === "object"));

  const levelsNode = await getRegistryNode("levels");
  assert.equal(levelsNode.capabilities.ioProfile.summary, "image -> image");
  assert.ok(levelsNode.ports.some((port) => port.direction === "input" && port.kind === "image"));
  assert.ok(levelsNode.ports.some((port) => port.direction === "output" && port.kind === "image"));

  const compositorNode = await getRegistryNode("compv3");
  assert.equal(compositorNode.displayName, "Compositor");
  assert.deepEqual(compositorNode.capabilities.ioProfile.outputKinds, ["image"]);
  assert.ok(compositorNode.ports.some((port) => port.direction === "input" && port.key === "background" && port.kind === "image"));
});

test("compiler supports single named prompt variable passthrough", async () => {
  const result = await compileOrThrow("build an app where I enter subject and generate an image");

  assert.equal(countNodeType(result, "promptV3"), 1);
  assert.equal(countNodeType(result, "prompt_concat"), 0);
  assert.equal(countPurpose(result, "text-to-image generation"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.deepEqual(
    result.graph.appMode.fields.map((field) => ({ key: field.key, label: field.label, bindingType: field.source.bindingType })),
    [{ key: "subject", label: "Subject", bindingType: "output-port" }],
  );
});

test("compiler composes multiple named prompt variables", async () => {
  const result = await compileOrThrow(
    "build an app where I enter subject, style, and lighting, compose them into a prompt, and generate an image",
  );

  assert.equal(countNodeType(result, "promptV3"), 3);
  assert.equal(countNodeType(result, "prompt_concat"), 2);
  assert.equal(countPurpose(result, "text-to-image generation"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.deepEqual(result.graph.appMode.fields.map((field) => field.key), ["subject", "style", "lighting"]);
});

test("compiler supports composed prompt compare image graphs", async () => {
  const result = await compileOrThrow(
    "build an app where I enter subject, style, and lighting, compose them into a prompt, and generate two images for comparison",
  );

  assert.equal(countNodeType(result, "promptV3"), 3);
  assert.equal(countNodeType(result, "prompt_concat"), 2);
  assert.equal(countPurpose(result, "multi-model image comparison"), 2);
  assert.equal(countPurpose(result, "app output"), 2);
  assert.equal(result.graph.outputs.nodeIds.length, 2);
});

test("compiler supports composed prompt compare video graphs", async () => {
  const result = await compileOrThrow(
    "build an app where I enter subject, style, and lighting, compose them into a prompt, and generate two videos for comparison",
  );

  assert.equal(countNodeType(result, "promptV3"), 3);
  assert.equal(countNodeType(result, "prompt_concat"), 2);
  assert.equal(countPurpose(result, "multi-model video comparison"), 2);
  assert.equal(countPurpose(result, "app output"), 2);
  assert.equal(result.graph.outputs.nodeIds.length, 2);
});

test("compiler supports multi-image composition graphs", async () => {
  const result = await compileOrThrow(
    "build an app where I upload two images, blend them together with a prompt, and return the composed image",
  );

  assert.equal(countPurpose(result, "multi-image composition"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.ok(hasField(result, (field) => field.label === "Source Image 1"));
  assert.ok(hasField(result, (field) => field.label === "Source Image 2"));
});

test("compiler supports style-transfer edit graphs", async () => {
  const result = await compileOrThrow(
    "build an app where I upload a content image and a style reference image, use a prompt to style transfer between them, and return the result",
  );

  assert.equal(countPurpose(result, "style-transfer edit"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.ok(hasField(result, (field) => field.label === "Content Image"));
  assert.ok(hasField(result, (field) => field.label === "Style Reference Image"));
});

test("compiler supports text-masked inpaint graphs", async () => {
  const result = await compileOrThrow(
    "build an app where I upload an image, describe the region to edit, inpaint it with a prompt, and return the edited image",
  );

  assert.equal(countPurpose(result, "mask generation"), 1);
  assert.equal(countPurpose(result, "masked image edit"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.ok(hasField(result, (field) => field.label === "Region Description"));
  assert.ok(hasField(result, (field) => field.label === "Inpaint Prompt"));
});

test("compiler supports slot-style composed prompt branching across three models", async () => {
  const result = await compileOrThrow(
    "build an app where I enter {subject}, {style}, and {location} as separate fields, compose them, and generate three image variations with different models",
  );

  assert.equal(countNodeType(result, "promptV3"), 3);
  assert.equal(countNodeType(result, "prompt_concat"), 2);
  assert.equal(countPurpose(result, "multi-model image comparison"), 3);
  assert.equal(countPurpose(result, "app output"), 3);
  assert.equal(result.graph.outputs.nodeIds.length, 3);
  assert.deepEqual(result.graph.appMode.fields.map((field) => field.key), ["subject", "style", "location"]);
});

test("compiler supports sequential uploaded-image to scene to video graphs", async () => {
  const result = await compileOrThrow(
    "build an app where I upload a character image, generate a scene around it, then animate it into a short video",
  );

  assert.equal(countPurpose(result, "prompt-guided image edit"), 1);
  assert.equal(countPurpose(result, "image-to-video generation"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.ok(hasField(result, (field) => field.control === "image-upload"));
});

test("compiler supports image-to-image-to-video chains", async () => {
  const result = await compileOrThrow(
    "build an app where I enter subject, generate an image, edit it with a prompt, then animate it into a short video",
  );

  assert.equal(countPurpose(result, "text-to-image generation"), 1);
  assert.equal(countPurpose(result, "prompt-guided image edit"), 1);
  assert.equal(countPurpose(result, "image-to-video generation"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
});

test("compiler supports parallel image and video outputs", async () => {
  const result = await compileOrThrow(
    "build an app where I upload a character image, generate a scene around it, also animate it into a short video, and expose both the image and video outputs",
  );

  assert.equal(countPurpose(result, "prompt-guided image edit"), 1);
  assert.equal(countPurpose(result, "image-to-video generation"), 1);
  assert.equal(countPurpose(result, "app output"), 2);
  assert.equal(result.graph.outputs.nodeIds.length, 2);
});

test("compiler keeps the dedicated lip-sync primitive for direct voiceover-video requests", async () => {
  const result = await compileOrThrow("build an app where I upload a video and lip sync it to a script");

  const coverage = getCoverage(result, "voiceover-video");
  assert.equal(coverage.registryGap, false);
  assert.equal(countPurpose(result, "voiceover video composition"), 1);
  assert.ok(hasField(result, (field) => field.control === "video-upload"));
  assert.ok(hasField(result, (field) => field.label === "Script"));
});

test("compiler supports text-to-speech audio generation", async () => {
  const result = await compileOrThrow("build an app where I enter a script and generate a voiceover audio file");

  const coverage = getCoverage(result, "text-to-speech");
  assert.equal(coverage.registryGap, false);
  assert.equal(countPurpose(result, "text-to-speech generation"), 1);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.deepEqual(
    result.graph.appMode.fields.map((field) => field.key),
    ["script"],
  );
});

test("compiler supports prompt-driven audio generation", async () => {
  const result = await compileOrThrow("build an app where I enter a prompt and generate an ambient audio track");

  const coverage = getCoverage(result, "generate-audio");
  assert.equal(coverage.registryGap, false);
  assert.equal(countPurpose(result, "text-to-audio generation"), 1);
  assert.ok(hasField(result, (field) => field.label === "Audio Prompt"));
});

test("compiler surfaces speech-to-text as an honest registry gap for audio inputs", async () => {
  const result = await compileOrThrow("build an app where I upload an audio file and transcribe it");

  const coverage = getCoverage(result, "speech-to-text");
  assert.equal(coverage.registryGap, true);
  assert.equal(getGap(result, "speech-to-text").blockedOutputKind, "text");
});

test("compiler surfaces audio concatenation as a registry gap", async () => {
  const result = await compileOrThrow("build an app where I concatenate audio clips into one track");

  const coverage = getCoverage(result, "audio-concat");
  assert.equal(coverage.registryGap, true);
  assert.equal(getGap(result, "audio-concat").blockedOutputKind, "audio");
});

test("compiler surfaces audio mixing as a registry gap", async () => {
  const result = await compileOrThrow("build an app where I mix narration with music into one audio track");

  const coverage = getCoverage(result, "audio-mix");
  assert.equal(coverage.registryGap, true);
  assert.equal(getGap(result, "audio-mix").blockedOutputKind, "audio");
});

test("compiler supports merge-audio-video with typed media inputs", async () => {
  const result = await compileOrThrow("build an app where I upload an audio track and a video clip and merge audio and video into one output");

  const coverage = getCoverage(result, "merge-audio-video");
  assert.equal(coverage.registryGap, false);
  assert.equal(countPurpose(result, "audio-video merge"), 1);
  assert.ok(hasField(result, (field) => field.control === "audio-upload"));
  assert.ok(hasField(result, (field) => field.control === "video-upload"));
});

test("compiler supports timeline assembly while surfacing transition gaps", async () => {
  const result = await compileOrThrow(
    "build an app where I upload three video clips and assemble them into a single reel with transitions",
  );

  const assembleCoverage = getCoverage(result, "timeline-assemble");
  assert.equal(assembleCoverage.registryGap, false);
  assert.equal(countPurpose(result, "timeline assembly"), 2);
  assert.equal(getGap(result, "timeline-transition").blockedOutputKind, "video");
  assert.equal(result.graph.appMode.fields.filter((field) => field.control === "video-upload").length, 3);
});

test("compiler surfaces trim-video as a registry gap", async () => {
  const result = await compileOrThrow("build an app where I upload a video clip and trim it to ten seconds");

  const coverage = getCoverage(result, "trim-video");
  assert.equal(coverage.registryGap, true);
  assert.equal(getGap(result, "trim-video").blockedOutputKind, "video");
});

test("compiler surfaces timeline-overlay as a registry gap", async () => {
  const result = await compileOrThrow("build an app where I upload two videos and overlay one over the other");

  const coverage = getCoverage(result, "timeline-overlay");
  assert.equal(coverage.registryGap, true);
  assert.equal(getGap(result, "timeline-overlay").blockedOutputKind, "video");
});

test("compiler uses image-collection plus map for open-ended plural image workflows", async () => {
  const result = await compileOrThrow("build an app where I upload multiple character images and generate a scene for each one");

  const coverage = getCoverage(result, "image-collection");
  assert.equal(coverage.registryGap, false);
  assert.equal(getCoverage(result, "map").registryGap, false);
  assert.equal(countPurpose(result, "parallel collection mapping"), 1);
  assert.equal(countPurpose(result, "prompt-guided image edit"), 1);
  assert.ok(hasField(result, (field) => field.control === "image-collection-upload"));
  assert.ok(hasField(result, (field) => field.label === "Scene Prompt"));
});

test("compiler normalizes shorter episode reel queries into scene generation plus downstream assembly", async () => {
  const result = await compileOrThrow(
    "build an app where I upload character images and a script, generate scenes for each character, add a voiceover from the script, and produce a single output reel",
  );

  assert.equal(getCoverage(result, "image-collection").registryGap, false);
  assert.equal(getCoverage(result, "map").registryGap, false);
  assert.equal(countPurpose(result, "parallel collection mapping"), 1);
  assert.equal(countPurpose(result, "prompt-guided image edit"), 1);
  assert.equal(getCoverage(result, "image-to-video").registryGap, false);
  assert.equal(countPurpose(result, "image-to-video generation"), 1);
  assert.equal(getCoverage(result, "timeline-assemble").registryGap, false);
  assert.equal(countPurpose(result, "timeline assembly"), 1);
  assert.equal(getCoverage(result, "text-to-speech").registryGap, false);
  assert.equal(getCoverage(result, "merge-audio-video").registryGap, false);
  assert.ok(countNodeType(result, "router") >= 1);
  assert.ok(hasField(result, (field) => field.key === "character_images"));
  assert.ok(hasField(result, (field) => field.key === "scene_prompt"));
  assert.ok(!hasField(result, (field) => field.key === "mergeAudioVideoNode_video_url"));
});

test("compiler uses array-input plus fanout for generic collection fan-out requests", async () => {
  const result = await compileOrThrow("build an app where I upload a collection of images and fan out parallel branches");

  assert.equal(getCoverage(result, "array-input").registryGap, false);
  assert.equal(getCoverage(result, "fanout").registryGap, false);
  assert.equal(countPurpose(result, "collection fanout"), 1);
  assert.ok(hasField(result, (field) => field.key === "input_collection"));
});

test("compiler uses array-input plus foreach for sequential collection processing requests", async () => {
  const result = await compileOrThrow("build an app where I upload a collection of images and process them sequentially for each item");

  assert.equal(getCoverage(result, "array-input").registryGap, false);
  assert.equal(getCoverage(result, "foreach").registryGap, false);
  assert.equal(countPurpose(result, "sequential collection processing"), 1);
});

test("compiler surfaces fanin and reduce gaps for collection reduction requests", async () => {
  const result = await compileOrThrow(
    "build an app where I upload a collection of images, collect them into a collection, and reduce them into a single image",
  );

  assert.equal(getCoverage(result, "array-input").registryGap, false);
  assert.equal(getCoverage(result, "fanin").registryGap, false);
  assert.equal(countPurpose(result, "collection fanin"), 1);
  assert.equal(getCoverage(result, "reduce").registryGap, true);
  assert.equal(getGap(result, "reduce").blockedOutputKind, "image");
});

test("compiler supports reference-set primitives", async () => {
  const result = await compileOrThrow("build an app where I upload a set of location references and expose them as a reusable collection");

  const coverage = getCoverage(result, "reference-set");
  assert.equal(coverage.registryGap, false);
  assert.ok(hasField(result, (field) => field.key === "location_references"));
  assert.equal(countPurpose(result, "reference set input"), 1);
});

test("compiler supports tagged-input-set primitives", async () => {
  const result = await compileOrThrow("build an app where I upload a tagged set of character images and expose them as a tagged collection");

  const coverage = getCoverage(result, "tagged-input-set");
  assert.equal(coverage.registryGap, false);
  assert.ok(hasField(result, (field) => field.control === "tagged-image-set-upload"));
});

test("compiler supports caption extraction from uploaded images", async () => {
  const result = await compileOrThrow("build an app where I upload an image and caption it");

  const coverage = getCoverage(result, "caption-extract");
  assert.equal(coverage.registryGap, false);
  assert.equal(countPurpose(result, "caption extraction"), 1);
  assert.ok(hasField(result, (field) => field.control === "image-upload"));
});

test("compiler supports transcript extraction from uploaded videos", async () => {
  const result = await compileOrThrow("build an app where I upload a video and extract a transcript");

  const coverage = getCoverage(result, "transcript-extract");
  assert.equal(coverage.registryGap, false);
  assert.equal(countPurpose(result, "transcript extraction"), 1);
  assert.ok(hasField(result, (field) => field.control === "video-upload"));
});

test("compiler surfaces scene detection as a registry gap", async () => {
  const result = await compileOrThrow("build an app where I upload a video and detect scenes");

  const coverage = getCoverage(result, "scene-detect");
  assert.equal(coverage.registryGap, true);
  assert.equal(getGap(result, "scene-detect").blockedOutputKind, "array");
});

test("compiler compiles the finish-line collection, timeline, and audio merge stress test", async () => {
  const result = await compileOrThrow(
    "build an app where I upload a tagged set of character images and location references, write a script, generate a scene for each character placed in their tagged location, assemble the scenes into a timeline with transitions, add a voiceover from the script, and produce a single output reel",
  );

  assert.equal(getCoverage(result, "tagged-input-set").registryGap, false);
  assert.equal(getCoverage(result, "reference-set").registryGap, false);
  assert.equal(getCoverage(result, "map").registryGap, false);
  assert.equal(countPurpose(result, "parallel collection mapping"), 1);
  assert.equal(countPurpose(result, "prompt-guided image edit"), 1);
  assert.equal(getCoverage(result, "timeline-assemble").registryGap, false);
  assert.equal(getCoverage(result, "timeline-transition").registryGap, true);
  assert.equal(getCoverage(result, "text-to-speech").registryGap, false);
  assert.equal(getCoverage(result, "merge-audio-video").registryGap, false);
  assert.equal(countPurpose(result, "app output"), 1);
  assert.equal(result.graph.outputs.nodeIds.length, 1);
  assert.ok(hasField(result, (field) => field.key === "character_images"));
  assert.ok(hasField(result, (field) => field.key === "location_references"));
  assert.ok(hasField(result, (field) => field.label === "Scene Prompt"));
  assert.ok(hasField(result, (field) => field.label === "Script"));
});
