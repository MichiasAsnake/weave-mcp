class WeavyRequestError extends Error {
  constructor(message, { status, payload, pathname } = {}) {
    super(message);
    this.name = "WeavyRequestError";
    this.status = status;
    this.payload = payload;
    this.pathname = pathname;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

class WeavyClient {
  constructor({ apiBaseUrl, token, authSource }) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/, "");
    this.token = token || "";
    this.authSource = authSource || (token ? "env" : "none");
  }

  async request(pathname, { method = "GET", body, auth = false } = {}) {
    const headers = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (auth) {
      if (!this.token) {
        throw new Error(
          "This command needs auth. Set WEAVY_BEARER_TOKEN or use a logged-in Chrome profile.",
        );
      }

      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${this.apiBaseUrl}${pathname}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const payload = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error ||
        `Request failed with status ${response.status}`;

      throw new WeavyRequestError(message, {
        status: response.status,
        payload,
        pathname,
      });
    }

    return payload;
  }

  async getRecipe(recipeId) {
    return this.request(`/v1/recipes/${recipeId}`, {
      auth: Boolean(this.token),
    });
  }

  async createRecipe({ folderId, scope } = {}) {
    return this.request("/v1/recipes/create", {
      method: "POST",
      auth: true,
      body: {
        ...(folderId ? { folderId } : {}),
        ...(scope ? { scope } : {}),
      },
    });
  }

  async duplicateRecipe(recipeId) {
    return this.request(`/v1/recipes/${recipeId}/duplicate`, {
      method: "POST",
      auth: true,
    });
  }

  async renameRecipe(recipeId, name) {
    return this.request(`/v1/recipes/${recipeId}`, {
      method: "PUT",
      body: { name },
      auth: true,
    });
  }

  async saveRecipe(recipeId, payload) {
    return this.request(`/v1/recipes/${recipeId}/save`, {
      method: "POST",
      body: payload,
      auth: true,
    });
  }

  async publishRecipe(recipeId) {
    return this.request(`/v1/recipes/${recipeId}/publish`, {
      method: "POST",
      auth: true,
    });
  }

  async estimateRecipeCost(recipeId, payload) {
    return this.request(`/v1/recipe-runs/recipes/${recipeId}/cost`, {
      method: "POST",
      body: payload,
      auth: true,
    });
  }

  async runRecipe(recipeId, payload) {
    return this.request(`/v1/recipe-runs/recipes/${recipeId}/run`, {
      method: "POST",
      body: payload,
      auth: true,
    });
  }

  async getRunStatus(recipeId, runIds) {
    const query = encodeURIComponent(runIds.join(","));
    return this.request(
      `/v1/recipe-runs/recipes/${recipeId}/runs/status?runIds=${query}`,
      {
        auth: true,
      },
    );
  }

  async cancelRuns(recipeId) {
    return this.request(`/v1/recipe-runs/recipes/${recipeId}/runs/cancel`, {
      method: "POST",
      auth: true,
    });
  }

  async getUserDesignApp(recipeId, version) {
    return this.request(
      `/v1/recipes/${recipeId}/user-design-app?version=${version}`,
      {
        auth: true,
      },
    );
  }

  async getPublicNodeDefinitions() {
    return this.request("/v1/node-definitions/public", {
      auth: true,
    });
  }

  async getUserNodeDefinitions() {
    return this.request("/v1/node-definitions/user", {
      auth: true,
    });
  }

  async getModelPrices() {
    return this.request("/v1/models/prices", {
      auth: true,
    });
  }
}

module.exports = {
  WeavyClient,
  WeavyRequestError,
};
