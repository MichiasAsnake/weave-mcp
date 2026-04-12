#!/usr/bin/env node

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const { routeApiRequest } = require("./api-router");
const { runWorkbenchChat } = require("./chat-agent");
const { loadLocalEnv } = require("./runtime");

loadLocalEnv();

const PREVIEW_ROOT = __dirname;
const STATIC_ROUTES = new Map([
  ["/", { file: "preview.html", type: "text/html; charset=utf-8" }],
  ["/preview.css", { file: "preview.css", type: "text/css; charset=utf-8" }],
  ["/preview.js", { file: "preview.js", type: "text/javascript; charset=utf-8" }],
]);

async function main() {
  const port = parsePort(process.argv.slice(2)) || 8787;

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") {
        setCorsHeaders(response);
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url, "http://127.0.0.1");
      const staticRoute = STATIC_ROUTES.get(url.pathname);

      if (request.method === "GET" && staticRoute) {
        await sendStaticFile(response, staticRoute);
        return;
      }

      setCorsHeaders(response);

      const body = request.method === "POST" || request.method === "PUT"
        ? await readJsonBody(request)
        : {};

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const result = await runWorkbenchChat(body);
        sendJson(response, 200, {
          ok: true,
          data: result,
        });
        return;
      }

      const apiPath = normalizeApiPath(url.pathname);

      const result = await routeApiRequest(request.method, apiPath, body);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, error.statusCode || 400, {
        ok: false,
        error: error.message,
        details: error.details || null,
      });
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`Weavy agent preview listening on http://127.0.0.1:${port}`);
}

function parsePort(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--port" && argv[index + 1]) {
      return toInteger(argv[index + 1], 8787);
    }
    if (token.startsWith("--port=")) {
      return toInteger(token.split("=")[1], 8787);
    }
  }
  return null;
}

async function readJsonBody(request) {
  const chunks = [];
  let bytes = 0;

  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
}

function sendJson(response, statusCode, payload) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.writeHead(statusCode);
  response.end(JSON.stringify(payload, null, 2));
}

async function sendStaticFile(response, staticRoute) {
  const filePath = path.join(PREVIEW_ROOT, staticRoute.file);
  const content = await fs.readFile(filePath);
  response.setHeader("Content-Type", staticRoute.type);
  response.writeHead(200);
  response.end(content);
}

function normalizeApiPath(pathname) {
  if (pathname.startsWith("/api/")) {
    return pathname.slice(4) || "/";
  }

  return pathname;
}

function toInteger(value, fallback) {
  if (value == null || value === "") {
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
  main,
};
