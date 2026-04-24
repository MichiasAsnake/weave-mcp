import assert from "node:assert/strict";
import test from "node:test";

import { CompilerResultSchema } from "./intent-zod.ts";
import type { CompilerResult } from "./types.ts";

const baseIntent = {
  domain: "image" as const,
  originalRequest: "build a bag ad scene generator",
  input: { source: "prompt" as const, kind: "text" as const },
  operations: [],
  output: { kind: "image" as const, format: null, delivery: "app_output" as const },
  appMode: { enabled: true, requiredFields: [] },
  promptPlan: { primitives: [], finalPromptKey: null },
  ambiguities: [],
};

const basePlan = {
  summary: "Generate a single image",
  nodes: [
    {
      stepId: "generate",
      definitionId: "textToImage",
      nodeId: "node-generate",
      displayName: "Generate Image",
      purpose: "text-to-image generation",
    },
  ],
  edges: [],
  appModeFields: [],
  primitiveCoverage: [],
  gaps: [],
};

const baseGraph = {
  irVersion: "1" as const,
  registryVersion: "test-registry",
  metadata: {
    graphId: "graph-1",
    name: "Bag Ad Generator",
    description: "Test graph",
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
  },
  nodes: [
    {
      nodeId: "node-generate",
      definitionId: "textToImage",
      nodeType: "textToImage",
      displayName: "Generate Image",
      params: {},
    },
  ],
  edges: [],
  outputs: {
    nodeIds: ["node-generate"],
  },
  appMode: {
    enabled: true,
    publishState: "draft" as const,
    exposureStrategy: "manual" as const,
    fields: [],
    layout: {
      sections: [],
    },
  },
};

test("compiler result supports question-required responses", () => {
  const parsed: CompilerResult = CompilerResultSchema.parse({
    ok: true,
    status: "question-required",
    intent: baseIntent,
    questions: [
      {
        key: "audience",
        label: "Target Audience",
        reason: "Audience changes prompt wording and visual framing.",
        options: ["luxury", "travel", "streetwear"],
      },
    ],
    plan: null,
    graph: null,
    explanation: null,
    trace: [],
  });

  assert.equal(parsed.status, "question-required");
  assert.equal(parsed.questions.length, 1);
  assert.deepEqual(parsed.promptDraft, []);
  assert.equal(parsed.explanation, null);
});

test("compiler result supports legacy complete success responses", () => {
  const parsed: CompilerResult = CompilerResultSchema.parse({
    ok: true,
    intent: baseIntent,
    plan: basePlan,
    graph: baseGraph,
    trace: [],
  });

  assert.equal(parsed.status, "complete");
  assert.deepEqual(parsed.questions, []);
  assert.deepEqual(parsed.promptDraft, []);
  assert.equal(parsed.explanation, null);
  assert.equal(parsed.graph.nodes.length, 1);
});

test("compiler result supports legacy error responses without status", () => {
  const parsed: CompilerResult = CompilerResultSchema.parse({
    ok: false,
    intent: baseIntent,
    error: {
      code: "unsupported_domain",
      message: "The compiler intent layer could not infer a supported workflow domain.",
    },
    trace: [],
  });

  assert.equal(parsed.status, "unsupported");
  assert.deepEqual(parsed.questions, []);
  assert.deepEqual(parsed.promptDraft, []);
  assert.equal(parsed.error.code, "unsupported_domain");
});

test("compiler result rejects invalid success shape combinations", () => {
  assert.throws(() =>
    CompilerResultSchema.parse({
      ok: true,
      status: "complete",
      intent: baseIntent,
      questions: [],
      promptDraft: [],
      plan: null,
      graph: null,
      explanation: null,
      trace: [],
    }),
  );

  assert.throws(() =>
    CompilerResultSchema.parse({
      ok: true,
      status: "question-required",
      intent: baseIntent,
      questions: [],
      promptDraft: [],
      plan: basePlan,
      graph: baseGraph,
      explanation: null,
      trace: [],
    }),
  );
});
