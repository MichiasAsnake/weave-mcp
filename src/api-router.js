const { listTemplates, resolveTemplate } = require("./config");
const { createAgentContext } = require("./runtime");

let sharedContextPromise = null;

async function routeApiRequest(method, pathname, body = {}) {
  if (method === "GET" && pathname === "/health") {
    return {
      ok: true,
      data: {
        service: "weavy-agent-api",
      },
    };
  }

  if (method === "GET" && pathname === "/templates") {
    return {
      ok: true,
      data: listTemplates(),
    };
  }

  if (method === "POST" && pathname === "/context/refresh") {
    const context = await getApiContext({ refresh: true });
    return {
      ok: true,
      data: summarizeContext(context),
    };
  }

  const context = await getApiContext();
  const { agent, client, detectedSession } = context;
  const overrides = mergeApiOverrides(body);
  const orchestrator = getLangGraphOrchestrator(context);
  const recipeOrchestrator = getRecipeLangGraphOrchestrator(context);
  const sessionOrchestrator = getSessionLangGraphOrchestrator(context);

  switch (`${method} ${pathname}`) {
    case "GET /auth":
    case "GET /session":
      return {
        ok: true,
        data: summarizeContext(context),
      };
    case "POST /plan":
      requireField(body, "goal");
      return {
        ok: true,
        data: await agent.plan(String(body.goal), {
          template: body.template,
          cheap: Boolean(body.cheap),
        }),
      };
    case "POST /draft":
      requireField(body, "goal");
      return {
        ok: true,
        data: await agent.draft(String(body.goal), {
          template: body.template,
          cheap: Boolean(body.cheap),
        }),
      };
    case "POST /graph":
      requireField(body, "goal");
      return {
        ok: true,
        data: await orchestrator.runGoal(String(body.goal), {
          mode: body.mode,
          threadId: body.threadId,
          template: body.template,
          cheap: Boolean(body.cheap),
          target: body.target ? resolveRecipeRef(body.target) : undefined,
          bootstrap: Boolean(body.bootstrap),
          scope: body.scope ? String(body.scope) : "PERSONAL",
          folderId: body.folderId ? String(body.folderId) : undefined,
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
          execute: Boolean(body.execute),
          wait: Boolean(body.wait),
          intervalMs: toInteger(body.intervalMs, 1000),
          timeoutMs: toInteger(body.timeoutMs, 30000),
          repair: Boolean(body.repair),
          maxRepairIterations: toInteger(body.maxRepairIterations, 3),
          executionSandbox:
            body.executionSandbox === undefined
              ? undefined
              : Boolean(body.executionSandbox),
        }),
      };
    case "POST /recipe-graph":
      requireField(body, "recipeId");
      requireField(body, "runIds");
      return {
        ok: true,
        data: await recipeOrchestrator.runRecipe(resolveRecipeRef(body.recipeId), {
          mode: body.mode,
          threadId: body.threadId,
          runIds: normalizeRunIds(body.runIds),
          apply: Boolean(body.apply),
          target: body.target ? resolveRecipeRef(body.target) : undefined,
          execute: Boolean(body.execute),
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
          maxIterations: toInteger(body.maxIterations, 1),
          targetSemanticScore: toInteger(body.targetSemanticScore, 92),
          wait: body.wait === undefined ? true : Boolean(body.wait),
          intervalMs: toInteger(body.intervalMs, 1000),
          timeoutMs: toInteger(body.timeoutMs, 30000),
          repair: Boolean(body.repair),
          maxRepairIterations: toInteger(body.maxRepairIterations, 3),
        }),
      };
    case "POST /session-graph":
      requireField(body, "goal");
      return {
        ok: true,
        data: await sessionOrchestrator.runSession(String(body.goal), {
          threadId: body.threadId,
          goalMode: body.mode,
          template: body.template,
          cheap: Boolean(body.cheap),
          target: body.target ? resolveRecipeRef(body.target) : undefined,
          bootstrap: Boolean(body.bootstrap),
          scope: body.scope ? String(body.scope) : "PERSONAL",
          folderId: body.folderId ? String(body.folderId) : undefined,
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
          execute: Boolean(body.execute),
          wait: body.wait,
          intervalMs: toInteger(body.intervalMs, 1000),
          timeoutMs: toInteger(body.timeoutMs, 30000),
          repair: Boolean(body.repair),
          maxRepairIterations: toInteger(body.maxRepairIterations, 3),
          executionSandbox:
            body.executionSandbox === undefined
              ? undefined
              : Boolean(body.executionSandbox),
          postMode: body.postMode || body.post,
          postExecute: Boolean(body.postExecute),
          postTarget: body.postTarget ? resolveRecipeRef(body.postTarget) : undefined,
          apply: Boolean(body.apply),
          maxIterations: toInteger(body.maxIterations, 1),
          targetSemanticScore: toInteger(body.targetSemanticScore, 92),
        }),
      };
    case "POST /create":
      return {
        ok: true,
        data: await agent.createBlank({
          scope: body.scope ? String(body.scope) : "PERSONAL",
          folderId: body.folderId ? String(body.folderId) : undefined,
        }),
      };
    case "POST /inspect":
      requireField(body, "recipeId");
      return {
        ok: true,
        data: await agent.inspect(resolveRecipeRef(body.recipeId)),
      };
    case "POST /structure":
      requireField(body, "recipeId");
      requireField(body, "goal");
      return {
        ok: true,
        data: await agent.structure(resolveRecipeRef(body.recipeId), {
          goal: String(body.goal),
          apply: Boolean(body.apply),
          cheap: Boolean(body.cheap),
        }),
      };
    case "POST /materialize":
      requireField(body, "goal");
      requireField(body, "target");
      return {
        ok: true,
        data: await agent.materialize(String(body.goal), {
          template: body.template,
          target: resolveRecipeRef(body.target),
          cheap: Boolean(body.cheap),
        }),
      };
    case "POST /bootstrap":
      requireField(body, "goal");
      return {
        ok: true,
        data: await agent.bootstrap(String(body.goal), {
          template: body.template,
          scope: body.scope ? String(body.scope) : "PERSONAL",
          folderId: body.folderId ? String(body.folderId) : undefined,
          cheap: Boolean(body.cheap),
        }),
      };
    case "POST /cost":
      requireField(body, "recipeId");
      return {
        ok: true,
        data: await agent.estimateRun(resolveRecipeRef(body.recipeId), {
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
        }),
      };
    case "POST /repair":
      requireField(body, "recipeId");
      return {
        ok: true,
        data: await agent.repair(resolveRecipeRef(body.recipeId), {
          apply: body.apply === undefined ? true : Boolean(body.apply),
        }),
      };
    case "POST /stabilize":
      requireField(body, "recipeId");
      return {
        ok: true,
        data: await agent.stabilize(resolveRecipeRef(body.recipeId)),
      };
    case "POST /run":
      requireField(body, "recipeId");
      return {
        ok: true,
        data: await agent.run(resolveRecipeRef(body.recipeId), {
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
          wait: Boolean(body.wait),
          intervalMs: toInteger(body.intervalMs, 1000),
          timeoutMs: toInteger(body.timeoutMs, 30000),
          repair: Boolean(body.repair),
          maxRepairIterations: toInteger(body.maxRepairIterations, 3),
          executionSandbox: Boolean(body.executionSandbox),
        }),
      };
    case "POST /review":
      requireField(body, "recipeId");
      requireField(body, "runIds");
      return {
        ok: true,
        data: await agent.review(resolveRecipeRef(body.recipeId), {
          runIds: normalizeRunIds(body.runIds),
        }),
      };
    case "POST /revise":
      requireField(body, "recipeId");
      requireField(body, "runIds");
      return {
        ok: true,
        data: await agent.revise(resolveRecipeRef(body.recipeId), {
          runIds: normalizeRunIds(body.runIds),
          apply: Boolean(body.apply),
        }),
      };
    case "POST /improve":
      requireField(body, "recipeId");
      requireField(body, "runIds");
      return {
        ok: true,
        data: await agent.improve(resolveRecipeRef(body.recipeId), {
          runIds: normalizeRunIds(body.runIds),
          target: body.target ? resolveRecipeRef(body.target) : undefined,
          execute: Boolean(body.execute),
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
          maxIterations: toInteger(body.maxIterations, 1),
          targetSemanticScore: toInteger(body.targetSemanticScore, 92),
          wait: body.wait === undefined ? true : Boolean(body.wait),
          intervalMs: toInteger(body.intervalMs, 1000),
          timeoutMs: toInteger(body.timeoutMs, 30000),
          repair: Boolean(body.repair),
          maxRepairIterations: toInteger(body.maxRepairIterations, 3),
        }),
      };
    case "POST /cycle":
      requireField(body, "goal");
      return {
        ok: true,
        data: await agent.cycle(String(body.goal), {
          template: body.template,
          target: body.target ? resolveRecipeRef(body.target) : undefined,
          scope: body.scope ? String(body.scope) : "PERSONAL",
          folderId: body.folderId ? String(body.folderId) : undefined,
          cheap: Boolean(body.cheap),
          overrides,
          numberOfRuns: toInteger(body.numberOfRuns, 1),
          execute: Boolean(body.execute),
          wait: Boolean(body.wait),
          intervalMs: toInteger(body.intervalMs, 1000),
          timeoutMs: toInteger(body.timeoutMs, 30000),
          repair: Boolean(body.repair),
          maxRepairIterations: toInteger(body.maxRepairIterations, 3),
          executionSandbox:
            body.executionSandbox === undefined
              ? undefined
              : Boolean(body.executionSandbox),
        }),
      };
    case "POST /duplicate":
      requireField(body, "recipeId");
      return {
        ok: true,
        data: {
          duplicatedFrom: resolveRecipeRef(body.recipeId),
          result: await client.duplicateRecipe(resolveRecipeRef(body.recipeId)),
        },
      };
    default:
      throw createHttpError(404, `No route for ${method} ${pathname}`);
  }
}

async function getApiContext({ refresh = false } = {}) {
  if (!sharedContextPromise || refresh) {
    sharedContextPromise = createAgentContext();
  }

  return sharedContextPromise;
}

function getLangGraphOrchestrator(context) {
  if (!context.langGraphOrchestrator) {
    const { WeavyLangGraphOrchestrator } = require("./langgraph-orchestrator");
    context.langGraphOrchestrator = new WeavyLangGraphOrchestrator(context.agent);
  }

  return context.langGraphOrchestrator;
}

function getRecipeLangGraphOrchestrator(context) {
  if (!context.recipeLangGraphOrchestrator) {
    const {
      WeavyRecipeLangGraphOrchestrator,
    } = require("./langgraph-recipe-orchestrator");
    context.recipeLangGraphOrchestrator = new WeavyRecipeLangGraphOrchestrator(
      context.agent,
    );
  }

  return context.recipeLangGraphOrchestrator;
}

function getSessionLangGraphOrchestrator(context) {
  if (!context.sessionLangGraphOrchestrator) {
    const {
      WeavySessionLangGraphOrchestrator,
    } = require("./langgraph-session-orchestrator");
    context.sessionLangGraphOrchestrator = new WeavySessionLangGraphOrchestrator(
      context.agent,
    );
  }

  return context.sessionLangGraphOrchestrator;
}

function summarizeContext(context) {
  return {
    authenticated: Boolean(context.client.token),
    authSource: context.client.authSource,
    email: context.detectedSession?.email || null,
    profile: context.detectedSession?.profile || null,
    expiresAt: context.detectedSession?.expiresAt || null,
  };
}

function mergeApiOverrides(body) {
  const overrides = { ...(body?.overrides || {}) };

  if (body?.reference) {
    overrides.reference = body.reference;
  }

  if (body?.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)) {
    Object.assign(overrides, body.inputs);
  }

  return overrides;
}

function resolveRecipeRef(value) {
  return resolveTemplate(String(value || "")).id;
}

function requireField(body, fieldName) {
  if (body?.[fieldName] == null || body[fieldName] === "") {
    throw createHttpError(400, `Missing required field: ${fieldName}`);
  }
}

function createHttpError(statusCode, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details || null;
  return error;
}

function normalizeRunIds(value) {
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return String(value);
}

function toInteger(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = {
  routeApiRequest,
  createHttpError,
};
