const apiRouterModule = require("./api-router");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || "gpt-5-mini";
const MAX_TOOL_STEPS = 4;

const { routeApiRequest } = apiRouterModule;
let envLoaded = false;

async function runWorkbenchChat({
  messages,
  goal,
  template,
  reference,
  inputs,
}) {
  ensureChatEnvLoaded();

  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return {
      reply: "OPENAI_API_KEY is not set, so chat is unavailable right now.",
      toolCalls: [],
      model: null,
      stopReason: "missing-openai-key",
    };
  }

  const toolCalls = [];
  let previousResponseId = null;
  let input = buildInitialInput({
    messages,
    goal,
    template,
    reference,
    inputs,
  });

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const payload = await createResponse({
      apiKey,
      input,
      previousResponseId,
    });
    const functionCalls = extractFunctionCalls(payload);

    if (functionCalls.length === 0) {
      return {
        reply:
          extractResponseText(payload) ||
          "I did not get a usable assistant reply back from the model.",
        toolCalls,
        model: payload.model || DEFAULT_CHAT_MODEL,
        responseId: payload.id || null,
        stopReason: payload.stop_reason || "completed",
      };
    }

    previousResponseId = payload.id || null;
    input = [];

    for (const functionCall of functionCalls) {
      const parsedArgs = parseJson(functionCall.arguments, {});
      const result = await executeTool(functionCall.name, parsedArgs, {
        goal,
        template,
        reference,
        inputs,
      });

      toolCalls.push({
        name: functionCall.name,
        args: parsedArgs,
        result,
      });

      input.push({
        type: "function_call_output",
        call_id: functionCall.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  return {
    reply:
      "I hit the current tool-step limit before reaching a final reply. The latest tool results are below.",
    toolCalls,
    model: DEFAULT_CHAT_MODEL,
    stopReason: "step-limit",
  };
}

async function createResponse({ apiKey, input, previousResponseId }) {
  const response = await fetch(buildResponsesUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_CHAT_MODEL,
      reasoning: { effort: "low" },
      previous_response_id: previousResponseId || undefined,
      input,
      tools: buildToolDefinitions(),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `OpenAI chat request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function buildResponsesUrl() {
  const baseUrl = (process.env.OPENAI_BASE_URL || OPENAI_BASE_URL).replace(/\/$/, "");
  return `${baseUrl}/responses`;
}

function buildInitialInput({ messages, goal, template, reference, inputs }) {
  const safeMessages = Array.isArray(messages) ? messages : [];

  return [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: [
            "You are the Weavy Agent Workbench assistant.",
            "You sit on top of a deterministic workflow engine that already knows how to plan, draft, inspect, bootstrap, and prepare Weavy recipes.",
            "Use tools whenever the user is asking for workflow analysis or mutation.",
            "Prefer non-spending tools.",
            "Do not claim a workflow was created or changed unless a tool call confirms it.",
            "Be concise and explicit about which tool ran and what happened.",
          ].join(" "),
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: buildComposerContext({
            goal,
            template,
            reference,
            inputs,
          }),
        },
      ],
    },
    ...safeMessages
      .map((message) => {
        const role =
          message?.role === "assistant" ? "assistant" : message?.role === "system" ? "system" : "user";
        const text = String(message?.text || "").trim();
        if (!text) {
          return null;
        }

        return {
          role,
          content: [
            {
              type: "input_text",
              text,
            },
          ],
        };
      })
      .filter(Boolean),
  ];
}

function buildComposerContext({ goal, template, reference, inputs }) {
  const lines = [
    "Current composer context:",
    `- goal: ${goal || "not set"}`,
    `- template: ${template || "not set"}`,
    `- reference: ${reference || "not set"}`,
  ];

  const inputEntries = Object.entries(inputs || {});
  if (inputEntries.length === 0) {
    lines.push("- inputs: none");
  } else {
    lines.push("- inputs:");
    for (const [key, value] of inputEntries) {
      lines.push(`  - ${key}: ${value}`);
    }
  }

  return lines.join("\n");
}

function buildToolDefinitions() {
  return [
    {
      type: "function",
      name: "planWorkflow",
      description: "Create a planning analysis for a workflow goal using the selected or inferred template.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          goal: { type: "string" },
          template: { type: "string" },
        },
        required: ["goal"],
      },
    },
    {
      type: "function",
      name: "draftWorkflow",
      description:
        "Draft a workflow from the goal and expose capability or structural gaps without running it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          goal: { type: "string" },
          template: { type: "string" },
        },
        required: ["goal"],
      },
    },
    {
      type: "function",
      name: "prepareWorkflow",
      description:
        "Create or materialize a workflow and estimate readiness without executing a paid run.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          goal: { type: "string" },
          template: { type: "string" },
        },
        required: ["goal"],
      },
    },
    {
      type: "function",
      name: "bootstrapWorkflow",
      description:
        "Create a private copy of a workflow and apply the current draft and safe structural tools.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          goal: { type: "string" },
          template: { type: "string" },
        },
        required: ["goal"],
      },
    },
    {
      type: "function",
      name: "inspectWorkflow",
      description: "Inspect an existing Weavy recipe or flow by recipe ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          recipeId: { type: "string" },
        },
        required: ["recipeId"],
      },
    },
  ];
}

async function executeTool(name, args, composerState) {
  const mergedTemplate = args.template || composerState.template || undefined;

  switch (name) {
    case "planWorkflow":
      return callApi("POST", "/plan", {
        goal: args.goal || composerState.goal,
        template: mergedTemplate,
      });
    case "draftWorkflow":
      return callApi("POST", "/draft", {
        goal: args.goal || composerState.goal,
        template: mergedTemplate,
      });
    case "prepareWorkflow":
      return callApi("POST", "/cycle", {
        goal: args.goal || composerState.goal,
        template: mergedTemplate,
        execute: false,
        reference: composerState.reference,
        inputs: composerState.inputs,
      });
    case "bootstrapWorkflow":
      return callApi("POST", "/bootstrap", {
        goal: args.goal || composerState.goal,
        template: mergedTemplate,
      });
    case "inspectWorkflow":
      return callApi("POST", "/inspect", {
        recipeId: args.recipeId,
      });
    default:
      throw new Error(`Unsupported chat tool: ${name}`);
  }
}

async function callApi(method, pathname, body) {
  const response = await routeApiRequest(method, pathname, body);
  return response.data;
}

function extractFunctionCalls(payload) {
  return (payload?.output || []).filter((item) => item.type === "function_call");
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const fragments = [];

  for (const item of payload?.output || []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content || []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        fragments.push(content.text.trim());
      } else if (
        typeof content?.output_text === "string" &&
        content.output_text.trim()
      ) {
        fragments.push(content.output_text.trim());
      }
    }
  }

  return fragments.join("\n\n").trim();
}

function parseJson(value, fallbackValue) {
  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
}

function ensureChatEnvLoaded() {
  if (envLoaded || process.env.OPENAI_API_KEY) {
    return;
  }

  envLoaded = true;
  const { loadLocalEnv } = require("./runtime");
  loadLocalEnv();
}

module.exports = {
  runWorkbenchChat,
};
