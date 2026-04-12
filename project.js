#!/usr/bin/env node

const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const { listTemplates, resolveTemplate } = require("./src/config");
const {
  WeavySessionLangGraphOrchestrator,
} = require("./src/langgraph-session-orchestrator");
const { render } = require("./src/render");
const {
  WeavyRecipeLangGraphOrchestrator,
} = require("./src/langgraph-recipe-orchestrator");
const { createAgentContext, loadLocalEnv } = require("./src/runtime");
const { main: startServer } = require("./src/server");

loadLocalEnv();

async function main() {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));
  const overrides = await loadOverrides(flags.inputs, flags);
  let context = null;
  let orchestrator = null;
  let recipeOrchestrator = null;
  let sessionOrchestrator = null;

  async function getContext() {
    if (!context) {
      context = await createAgentContext();
    }
    return context;
  }

  async function getOrchestrator() {
    if (!orchestrator) {
      const { agent } = await getContext();
      const { WeavyLangGraphOrchestrator } = require("./src/langgraph-orchestrator");
      orchestrator = new WeavyLangGraphOrchestrator(agent);
    }
    return orchestrator;
  }

  async function getRecipeOrchestrator() {
    if (!recipeOrchestrator) {
      const { agent } = await getContext();
      recipeOrchestrator = new WeavyRecipeLangGraphOrchestrator(agent);
    }
    return recipeOrchestrator;
  }

  async function getSessionOrchestrator() {
    if (!sessionOrchestrator) {
      const { agent } = await getContext();
      sessionOrchestrator = new WeavySessionLangGraphOrchestrator(agent);
    }
    return sessionOrchestrator;
  }

  switch (command) {
    case "help":
    case undefined:
      printHelp();
      return;
    case "auth":
      {
        const { client, detectedSession } = await getContext();
      render(flags, {
        authenticated: Boolean(client.token),
        authSource: client.authSource,
        email: detectedSession?.email || null,
        profile: detectedSession?.profile || null,
        expiresAt: detectedSession?.expiresAt || null,
      });
      return;
      }
    case "templates":
      render(flags, listTemplates());
      return;
    case "serve":
      await startServer();
      return;
    case "create": {
      const { agent } = await getContext();
      const result = await agent.createBlank({
        scope: flags.scope ? String(flags.scope) : "PERSONAL",
        folderId: flags.folder ? String(flags.folder) : undefined,
      });
      render(flags, result);
      return;
    }
    case "inspect": {
      const { agent } = await getContext();
      const target = resolveRecipeRef(positional[0]);
      if (!target) {
        throw new Error("Usage: node project.js inspect <template-alias|recipe-id>");
      }
      render(flags, await agent.inspect(target));
      return;
    }
    case "plan": {
      const { agent } = await getContext();
      const goal = positional.join(" ").trim();
      if (!goal) {
        throw new Error('Usage: node project.js plan "describe the workflow"');
      }
      render(flags, await agent.plan(goal, {
        template: flags.template,
        cheap: Boolean(flags.cheap),
      }));
      return;
    }
    case "draft": {
      const { agent } = await getContext();
      const goal = positional.join(" ").trim();
      if (!goal) {
        throw new Error('Usage: node project.js draft "describe the workflow"');
      }
      const result = await agent.draft(goal, {
        template: flags.template,
        cheap: Boolean(flags.cheap),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "graph": {
      const workflow = await getOrchestrator();
      const goal = positional.join(" ").trim();
      if (!goal) {
        throw new Error(
          'Usage: node project.js graph "describe the workflow" [--mode draft|materialize|bootstrap|cycle|plan]',
        );
      }
      const result = await workflow.runGoal(goal, {
        mode: flags.mode ? String(flags.mode) : undefined,
        threadId: flags.thread ? String(flags.thread) : undefined,
        template: flags.template,
        cheap: Boolean(flags.cheap),
        target: flags.target ? resolveRecipeRef(String(flags.target)) : undefined,
        bootstrap: Boolean(flags.bootstrap),
        scope: flags.scope ? String(flags.scope) : "PERSONAL",
        folderId: flags.folder ? String(flags.folder) : undefined,
        overrides,
        numberOfRuns: toInteger(flags.runs, 1),
        execute: Boolean(flags.execute),
        wait: Boolean(flags.wait),
        intervalMs: toInteger(flags.interval, 1000),
        timeoutMs: toInteger(flags.timeout, 30000),
        repair: Boolean(flags.repair),
        maxRepairIterations: toInteger(flags["repair-limit"], 3),
        executionSandbox: flags.sandbox === true ? true : undefined,
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "recipe-graph": {
      const workflow = await getRecipeOrchestrator();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId || !flags.run) {
        throw new Error(
          "Usage: node project.js recipe-graph <recipe-id> --run <run-id[,run-id]> [--mode review|revise|improve]",
        );
      }
      const result = await workflow.runRecipe(recipeId, {
        mode: flags.mode ? String(flags.mode) : undefined,
        threadId: flags.thread ? String(flags.thread) : undefined,
        runIds: String(flags.run),
        apply: Boolean(flags.apply),
        target: flags.target ? resolveRecipeRef(String(flags.target)) : undefined,
        execute: Boolean(flags.execute),
        overrides,
        numberOfRuns: toInteger(flags.runs, 1),
        maxIterations: toInteger(flags.iterations, 1),
        targetSemanticScore: toInteger(flags["target-score"], 92),
        wait: flags.wait === undefined ? true : Boolean(flags.wait),
        intervalMs: toInteger(flags.interval, 1000),
        timeoutMs: toInteger(flags.timeout, 30000),
        repair: Boolean(flags.repair),
        maxRepairIterations: toInteger(flags["repair-limit"], 3),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "session-graph": {
      const workflow = await getSessionOrchestrator();
      const goal = positional.join(" ").trim();
      if (!goal) {
        throw new Error(
          'Usage: node project.js session-graph "describe the workflow" [--post review|improve]',
        );
      }
      const result = await workflow.runSession(goal, {
        threadId: flags.thread ? String(flags.thread) : undefined,
        goalMode: flags.mode ? String(flags.mode) : undefined,
        template: flags.template,
        cheap: Boolean(flags.cheap),
        target: flags.target ? resolveRecipeRef(String(flags.target)) : undefined,
        bootstrap: Boolean(flags.bootstrap),
        scope: flags.scope ? String(flags.scope) : "PERSONAL",
        folderId: flags.folder ? String(flags.folder) : undefined,
        overrides,
        numberOfRuns: toInteger(flags.runs, 1),
        execute: Boolean(flags.execute),
        wait: flags.wait === undefined ? undefined : Boolean(flags.wait),
        intervalMs: toInteger(flags.interval, 1000),
        timeoutMs: toInteger(flags.timeout, 30000),
        repair: Boolean(flags.repair),
        maxRepairIterations: toInteger(flags["repair-limit"], 3),
        executionSandbox: flags.sandbox === true ? true : undefined,
        postMode: flags.post ? String(flags.post) : undefined,
        postExecute: Boolean(flags["post-execute"]),
        postTarget: flags["post-target"]
          ? resolveRecipeRef(String(flags["post-target"]))
          : undefined,
        apply: Boolean(flags.apply),
        maxIterations: toInteger(flags.iterations, 1),
        targetSemanticScore: toInteger(flags["target-score"], 92),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "structure": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      const goal = positional.slice(1).join(" ").trim() || String(flags.goal || "").trim();
      if (!recipeId || !goal) {
        throw new Error(
          'Usage: node project.js structure <recipe-id> --goal "describe the workflow goal" [--apply]',
        );
      }
      const result = await agent.structure(recipeId, {
        goal,
        apply: Boolean(flags.apply),
        cheap: Boolean(flags.cheap),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "materialize": {
      const { agent } = await getContext();
      const goal = positional.join(" ").trim();
      if (!goal || !flags.target) {
        throw new Error(
          'Usage: node project.js materialize "describe the workflow" --target <recipe-id>',
        );
      }
      const result = await agent.materialize(goal, {
        template: flags.template,
        target: resolveRecipeRef(String(flags.target)),
        cheap: Boolean(flags.cheap),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "bootstrap": {
      const { agent } = await getContext();
      const goal = positional.join(" ").trim();
      if (!goal) {
        throw new Error(
          'Usage: node project.js bootstrap "describe the workflow" [--template <alias>]',
        );
      }
      const result = await agent.bootstrap(goal, {
        template: flags.template,
        scope: flags.scope ? String(flags.scope) : "PERSONAL",
        folderId: flags.folder ? String(flags.folder) : undefined,
        cheap: Boolean(flags.cheap),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "cost": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId) {
        throw new Error(
          "Usage: node project.js cost <recipe-id> [--inputs overrides.json] [--input \"Name=value;Other=value\"] [--reference <url>] [--runs 1]",
        );
      }
      render(
        flags,
        await agent.estimateRun(recipeId, {
          overrides,
          numberOfRuns: toInteger(flags.runs, 1),
        }),
      );
      return;
    }
    case "repair": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId) {
        throw new Error(
          "Usage: node project.js repair <recipe-id> [--apply]",
        );
      }
      const result = await agent.repair(recipeId, {
        apply: Boolean(flags.apply),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "stabilize": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId) {
        throw new Error("Usage: node project.js stabilize <recipe-id>");
      }
      const result = await agent.stabilize(recipeId);
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "run": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId) {
        throw new Error(
          "Usage: node project.js run <recipe-id> [--inputs overrides.json] [--input \"Name=value;Other=value\"] [--reference <url>] [--runs 1] [--wait] [--repair]",
        );
      }
      const result = await agent.run(recipeId, {
        overrides,
        numberOfRuns: toInteger(flags.runs, 1),
        wait: Boolean(flags.wait),
        intervalMs: toInteger(flags.interval, 1000),
        timeoutMs: toInteger(flags.timeout, 30000),
        repair: Boolean(flags.repair),
        maxRepairIterations: toInteger(flags["repair-limit"], 3),
        executionSandbox: Boolean(flags.sandbox),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "review": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId || !flags.run) {
        throw new Error(
          "Usage: node project.js review <recipe-id> --run <run-id[,run-id]>",
        );
      }
      const result = await agent.review(recipeId, {
        runIds: String(flags.run),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "revise": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId || !flags.run) {
        throw new Error(
          "Usage: node project.js revise <recipe-id> --run <run-id[,run-id]> [--apply]",
        );
      }
      const result = await agent.revise(recipeId, {
        runIds: String(flags.run),
        apply: Boolean(flags.apply),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "improve": {
      const { agent } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId || !flags.run) {
        throw new Error(
          "Usage: node project.js improve <recipe-id> --run <run-id[,run-id]> [--execute] [--target <recipe-id>]",
        );
      }
      const result = await agent.improve(recipeId, {
        runIds: String(flags.run),
        target: flags.target ? resolveRecipeRef(String(flags.target)) : undefined,
        execute: Boolean(flags.execute),
        overrides,
        numberOfRuns: toInteger(flags.runs, 1),
        maxIterations: toInteger(flags.iterations, 1),
        targetSemanticScore: toInteger(flags["target-score"], 92),
        wait: flags.wait === undefined ? true : Boolean(flags.wait),
        intervalMs: toInteger(flags.interval, 1000),
        timeoutMs: toInteger(flags.timeout, 30000),
        repair: Boolean(flags.repair),
        maxRepairIterations: toInteger(flags["repair-limit"], 3),
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "cycle": {
      const { agent } = await getContext();
      const goal = positional.join(" ").trim();
      if (!goal) {
        throw new Error(
          'Usage: node project.js cycle "describe the workflow" [--template <alias>] [--target <recipe-id>] [--execute]',
        );
      }
      const result = await agent.cycle(goal, {
        template: flags.template,
        target: flags.target ? resolveRecipeRef(String(flags.target)) : undefined,
        scope: flags.scope ? String(flags.scope) : "PERSONAL",
        folderId: flags.folder ? String(flags.folder) : undefined,
        cheap: Boolean(flags.cheap),
        overrides,
        numberOfRuns: toInteger(flags.runs, 1),
        execute: Boolean(flags.execute),
        wait: Boolean(flags.wait),
        intervalMs: toInteger(flags.interval, 1000),
        timeoutMs: toInteger(flags.timeout, 30000),
        repair: Boolean(flags.repair),
        maxRepairIterations: toInteger(flags["repair-limit"], 3),
        executionSandbox: flags.sandbox === true ? true : undefined,
      });
      await maybeWriteResult(flags.out, result);
      render(flags, result);
      return;
    }
    case "duplicate": {
      const { client } = await getContext();
      const recipeId = resolveRecipeRef(positional[0]);
      if (!recipeId) {
        throw new Error(
          "Usage: node project.js duplicate <template-alias|recipe-id>",
        );
      }
      render(flags, {
        duplicatedFrom: recipeId,
        result: await client.duplicateRecipe(recipeId),
      });
      return;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let command;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!command && !token.startsWith("--")) {
      command = token;
      continue;
    }

    if (token.startsWith("--")) {
      const [name, inlineValue] = token.slice(2).split("=");
      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
        continue;
      }

      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        flags[name] = next;
        index += 1;
      } else {
        flags[name] = true;
      }
      continue;
    }

    positional.push(token);
  }

  return { command, positional, flags };
}

function printHelp() {
  console.log(`
Weavy workflow agent prototype

Usage
  node project.js auth
  node project.js templates
  node project.js serve [--port 8787]
  node project.js create [--scope PERSONAL]
  node project.js inspect <template-alias|recipe-id>
  node project.js plan "<goal>" [--template <alias>] [--cheap]
  node project.js draft "<goal>" [--template <alias>] [--cheap] [--out result.json]
  node project.js graph "<goal>" [--mode plan|draft|materialize|bootstrap|cycle] [--template <alias>] [--cheap] [--target <recipe-id>] [--execute]
  node project.js recipe-graph <recipe-id> --run <run-id[,run-id]> [--mode review|revise|improve] [--apply] [--execute]
  node project.js session-graph "<goal>" [--mode draft|materialize|bootstrap|cycle] [--post review|improve] [--cheap] [--execute]
  node project.js structure <recipe-id> --goal "<goal>" [--apply] [--cheap]
  node project.js materialize "<goal>" --target <recipe-id> [--template <alias>] [--cheap]
  node project.js bootstrap "<goal>" [--template <alias>] [--cheap] [--scope PERSONAL]
  node project.js cost <recipe-id> [--inputs overrides.json] [--input "Name=value;Other=value"] [--reference <url>] [--runs 1]
  node project.js repair <recipe-id> [--apply]
  node project.js stabilize <recipe-id>
  node project.js run <recipe-id> [--inputs overrides.json] [--input "Name=value;Other=value"] [--reference <url>] [--runs 1] [--wait] [--repair] [--repair-limit 3] [--sandbox]
  node project.js review <recipe-id> --run <run-id[,run-id]>
  node project.js revise <recipe-id> --run <run-id[,run-id]> [--apply]
  node project.js improve <recipe-id> --run <run-id[,run-id]> [--execute] [--target <recipe-id>] [--iterations 1] [--target-score 92]
  node project.js cycle "<goal>" [--template <alias>] [--cheap] [--target <recipe-id>] [--execute] [--wait] [--repair] [--repair-limit 3] [--sandbox] [--reference <url>] [--input "Name=value"]
  node project.js duplicate <template-alias|recipe-id>

Template aliases
  multi-views
  design-app

Optional env
  WEAVY_BEARER_TOKEN   Enables authenticated calls directly.
  WEAVY_API_BASE_URL   Override the API base URL.
  OPENAI_API_KEY       Enables semantic output review on completed image runs.
  OPENAI_REVIEW_MODEL  Optional override for the semantic review model.

Notes
  This can auto-detect your logged-in Chrome Weavy session.
  It uses unsupported internal endpoints.
  \`cycle\` does not spend credits unless you pass \`--execute\`.
  \`--cheap\` biases template selection toward the lowest verified baseline cost when the capability match is close enough.
  \`run --repair\` and \`cycle --execute --repair\` will apply safe blocked-model repairs for up to \`--repair-limit\` iterations.
  \`run --sandbox\` executes against a duplicate recipe so repairs and stabilizers do not mutate the source flow.
  \`cycle --execute --repair\` will use an execution sandbox automatically unless you override that in code.
  \`--reference <url>\` is a shorthand for the primary exposed import input on reference-driven recipes.
  \`--input "Name=value;Other=value"\` can set exposed prompt/string/import inputs without creating a JSON file.
  \`review\` needs explicit run IDs because the private API surface exposed here does not list historical runs.
  \`revise --apply\` only applies safe prompt-level edits derived from review findings.
  \`improve\` duplicates the recipe by default, applies safe revisions to the copy, and can optionally execute multiple improvement rounds with \`--iterations\`.
  \`structure\` plans or applies deterministic structural tools such as exposing safe Design App inputs on an existing recipe.
  \`graph\` routes goal orchestration through LangGraph so the plan/draft/materialize/bootstrap/cycle steps are explicit and checkpointed in memory.
  \`recipe-graph\` routes review/revise/improve through LangGraph so post-run iteration is also explicit and checkpointed in memory.
  \`session-graph\` composes the goal graph and recipe graph so a single session can author a workflow and optionally hand the completed run into review or improve.
  The improve loop stops early once the semantic score reaches \`--target-score\` and only low-severity findings remain.
  Semantic review is optional and only runs when \`OPENAI_API_KEY\` is available.
`.trim());
}

function resolveRecipeRef(value) {
  if (!value) {
    return "";
  }

  return resolveTemplate(value).id;
}

async function loadOverrides(inputPath, flags = {}) {
  const loaded = inputPath ? await loadOverridesFile(inputPath) : {};
  const overrides = { ...loaded };

  if (flags.input) {
    Object.assign(overrides, parseInlineOverrides(String(flags.input)));
  }

  if (flags.reference) {
    overrides.reference = normalizeReferenceOverride(String(flags.reference));
  }

  return overrides;
}

async function loadOverridesFile(inputPath) {
  const absolutePath = path.resolve(process.cwd(), String(inputPath));
  const content = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(content);
}

function parseInlineOverrides(value) {
  const overrides = {};

  for (const segment of String(value)
    .split(/[;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const separator = segment.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = segment.slice(0, separator).trim();
    const rawValue = segment.slice(separator + 1).trim();

    if (!key) {
      continue;
    }

    overrides[key] = rawValue;
  }

  return overrides;
}

function normalizeReferenceOverride(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const absolutePath = path.resolve(process.cwd(), trimmed);
  if (fsSync.existsSync(absolutePath)) {
    throw new Error(
      "Local file paths are not supported for --reference yet. Use a public URL or a JSON override with a hosted file object.",
    );
  }

  return trimmed;
}

async function maybeWriteResult(outputPath, payload) {
  if (!outputPath) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), String(outputPath));
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2));
}

function toInteger(value, fallback) {
  if (value == null) {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  loadLocalEnv,
};
