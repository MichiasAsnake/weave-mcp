const fsSync = require("node:fs");
const path = require("node:path");

const { detectChromeWeavySession } = require("./auth");
const { WeavyClient } = require("./client");
const { API_BASE_URL } = require("./config");
const { WeavyWorkflowAgent } = require("./agent");

function loadLocalEnv() {
  const candidates = [
    path.join(process.cwd(), "local.env"),
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "src", "local.env"),
  ];

  for (const candidate of candidates) {
    if (!fsSync.existsSync(candidate)) {
      continue;
    }

    const content = fsSync.readFileSync(candidate, "utf8");
    applyEnvContent(content);
    process.env.WEAVY_LOCAL_ENV = candidate;
    return candidate;
  }

  return "";
}

function applyEnvContent(content) {
  const lines = String(content || "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

async function createAgentContext() {
  const authToken =
    process.env.WEAVY_BEARER_TOKEN || process.env.WEAVY_TOKEN || "";
  const detectedSession = authToken
    ? {
        token: authToken,
        source: "env",
        profile: null,
        email: null,
        expiresAt: null,
      }
    : await detectChromeWeavySession();

  const client = new WeavyClient({
    apiBaseUrl: API_BASE_URL,
    token: detectedSession?.token || authToken,
    authSource: detectedSession?.source || (authToken ? "env" : "none"),
  });

  return {
    agent: new WeavyWorkflowAgent(client),
    client,
    detectedSession,
  };
}

module.exports = {
  loadLocalEnv,
  createAgentContext,
};
