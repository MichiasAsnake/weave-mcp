import assert from "node:assert/strict";
import test from "node:test";

import { CompilerResultSchema } from "./intent-zod.ts";

test("compiler result supports question-required responses", () => {
  const parsed = CompilerResultSchema.parse({
    ok: true,
    status: "question-required",
    intent: {
      domain: "image",
      originalRequest: "build a bag ad scene generator",
      input: { source: "prompt", kind: "text" },
      operations: [],
      output: { kind: "image", format: null, delivery: "app_output" },
      appMode: { enabled: true, requiredFields: [] },
      promptPlan: { primitives: [], finalPromptKey: null },
      ambiguities: [],
    },
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
});
