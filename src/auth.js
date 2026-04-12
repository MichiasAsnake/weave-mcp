const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const FIREBASE_SECURE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function refreshFirebaseIdToken({ refreshToken, apiKey }) {
  if (!refreshToken || !apiKey) {
    throw new Error("A Firebase refresh token and api key are required.");
  }

  const response = await fetch(`${FIREBASE_SECURE_TOKEN_URL}?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Failed to refresh Firebase token.");
  }

  const token = payload.id_token || payload.access_token;
  const decoded = decodeJwtPayload(token);

  return {
    token,
    refreshToken: payload.refresh_token || refreshToken,
    email: decoded?.email || null,
    expiresAt: decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null,
    exp: decoded?.exp || 0,
    iat: decoded?.iat || 0,
  };
}

function isTokenFresh(candidate, minTtlSeconds = 60) {
  if (!candidate?.exp) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  return candidate.exp - now > minTtlSeconds;
}

function findFileMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : "";
}

async function detectChromeWeavySession(options = {}) {
  const minTtlSeconds = Number.isFinite(options.minTtlSeconds)
    ? options.minTtlSeconds
    : 60;
  const shouldRefresh = options.refresh !== false;
  const chromeRoot = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
  );

  let entries;
  try {
    entries = await fs.readdir(chromeRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const profiles = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (entry.name === "Default" || /^Profile \d+$/.test(entry.name)),
    )
    .map((entry) => entry.name);

  const candidates = [];

  for (const profile of profiles) {
    const levelDbDir = path.join(
      chromeRoot,
      profile,
      "IndexedDB",
      "https_app.weavy.ai_0.indexeddb.leveldb",
    );

    let files;
    try {
      files = await fs.readdir(levelDbDir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".ldb") && !file.endsWith(".log")) {
        continue;
      }

      const fullPath = path.join(levelDbDir, file);
      let content;
      try {
        content = await fs.readFile(fullPath);
      } catch {
        continue;
      }

      const text = content.toString("latin1");
      const refreshToken = findFileMatch(text, /refreshToken"\W+([^"\\\s]+)/);
      const apiKey = findFileMatch(text, /apiKey"\W+(AIza[0-9A-Za-z_-]+)/);
      const matches = text.matchAll(
        /accessToken"\W+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
      );

      for (const match of matches) {
        const token = match[1];
        const payload = decodeJwtPayload(token);
        if (!payload?.exp) {
          continue;
        }

        candidates.push({
          token,
          email: payload.email || null,
          expiresAt: new Date(payload.exp * 1000).toISOString(),
          exp: payload.exp,
          iat: payload.iat || 0,
          refreshToken: refreshToken || "",
          apiKey: apiKey || "",
          profile,
          source: `chrome:${profile}`,
        });
      }
    }
  }

  candidates.sort((left, right) => {
    if (right.exp !== left.exp) {
      return right.exp - left.exp;
    }
    return right.iat - left.iat;
  });

  const freshCandidate = candidates.find((candidate) =>
    isTokenFresh(candidate, minTtlSeconds),
  );
  if (freshCandidate) {
    return freshCandidate;
  }

  const refreshableCandidate = candidates.find(
    (candidate) => candidate.refreshToken && candidate.apiKey,
  );

  if (!refreshableCandidate || !shouldRefresh) {
    return candidates[0] || null;
  }

  try {
    const refreshed = await refreshFirebaseIdToken(refreshableCandidate);
    return {
      ...refreshableCandidate,
      ...refreshed,
      source: `${refreshableCandidate.source}:refreshed`,
    };
  } catch {
    return candidates[0] || null;
  }
}

module.exports = {
  decodeJwtPayload,
  detectChromeWeavySession,
  refreshFirebaseIdToken,
};
