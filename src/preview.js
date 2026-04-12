const state = {
  goal: "",
  template: "multi-views",
  reference: "",
  inputs: "",
  messages: [],
};

const thread = document.querySelector("#thread");
const composer = document.querySelector("#composer");
const messageInput = document.querySelector("#message");
const goalInput = document.querySelector("#goal");
const templateInput = document.querySelector("#template");
const referenceInput = document.querySelector("#reference");
const inputsInput = document.querySelector("#inputs");
const goalState = document.querySelector("#goal-state");
const referenceState = document.querySelector("#reference-state");
const authState = document.querySelector("#auth-state");
const status = document.querySelector("#status");
const latestSummary = document.querySelector("#latest-summary");
const latestTitle = document.querySelector("#latest-title");
const latestDescription = document.querySelector("#latest-description");

for (const chip of document.querySelectorAll(".suggestion-chip")) {
  chip.addEventListener("click", () => {
    messageInput.value = chip.textContent.trim();
  });
}

goalInput.addEventListener("input", () => {
  state.goal = goalInput.value.trim();
  renderContext();
});

templateInput.addEventListener("change", () => {
  state.template = templateInput.value;
});

referenceInput.addEventListener("input", () => {
  state.reference = referenceInput.value.trim();
  renderContext();
});

inputsInput.addEventListener("input", () => {
  state.inputs = inputsInput.value;
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  if (!state.goal) {
    state.goal = text;
    goalInput.value = text;
  }

  state.messages.push({
    role: "user",
    text,
  });
  renderThread();
  renderContext();
  status.textContent = "Thinking...";
  messageInput.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: state.messages,
        goal: state.goal,
        template: state.template,
        reference: state.reference,
        inputs: parseInlineInputs(state.inputs),
      }),
    });

    const json = await response.json();
    if (!response.ok || !json.ok) {
      throw new Error(json.error || "Chat request failed.");
    }

    state.messages.push({
      role: "assistant",
      text: json.data.reply || "No reply returned.",
      toolCalls: Array.isArray(json.data.toolCalls) ? json.data.toolCalls : [],
    });

    renderLatestSummary(json.data.toolCalls || []);
    status.textContent = "Ready";
    renderThread();
  } catch (error) {
    status.textContent = error.message;
  }
});

hydrateAuth();
renderContext();

async function hydrateAuth() {
  try {
    const response = await fetch("/api/auth");
    const json = await response.json();
    if (response.ok && json.ok && json.data) {
      authState.textContent = json.data.authenticated
        ? "Live Weavy session"
        : "No live session detected";
    } else {
      authState.textContent = "Auth unavailable";
    }
  } catch {
    authState.textContent = "Auth unavailable";
  }
}

function renderContext() {
  goalState.textContent = state.goal || "Your first prompt becomes the working goal.";
  referenceState.textContent = state.reference ? "Attached" : "Optional";
}

function renderThread() {
  if (state.messages.length === 0) {
    return;
  }

  thread.innerHTML = "";

  for (const message of state.messages) {
    const article = document.createElement("article");
    article.className = `chat-bubble chat-${message.role}`;

    const header = document.createElement("header");
    header.innerHTML = `<span>${message.role === "user" ? "You" : "Agent"}</span>`;
    article.appendChild(header);

    const text = document.createElement("p");
    text.className = "chat-text";
    text.textContent = message.text;
    article.appendChild(text);

    for (const toolCall of message.toolCalls || []) {
      const card = document.createElement("div");
      card.className = "tool-card";
      card.innerHTML = `
        <strong>${toolLabel(toolCall.name)}</strong>
        <pre>${escapeHtml(JSON.stringify(toolCall.args, null, 2))}</pre>
        <details>
          <summary>Tool result</summary>
          <pre>${escapeHtml(JSON.stringify(toolCall.result, null, 2))}</pre>
        </details>
      `;
      article.appendChild(card);
    }

    thread.appendChild(article);
  }
}

function renderLatestSummary(toolCalls) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    latestSummary.hidden = true;
    return;
  }

  const latest = toolCalls[toolCalls.length - 1];
  latestTitle.textContent = toolLabel(latest.name);
  latestDescription.textContent = summarizeTool(latest);
  latestSummary.hidden = false;
}

function summarizeTool(toolCall) {
  const result = toolCall.result || {};

  if (toolCall.name === "planWorkflow") {
    return (
      result.capabilityPlan?.strategy?.summary ||
      "The agent selected a starting workflow strategy."
    );
  }

  if (toolCall.name === "draftWorkflow") {
    return (
      result.nextExecutionStep ||
      "The agent drafted safe mutations and highlighted structural gaps."
    );
  }

  if (toolCall.name === "prepareWorkflow") {
    return result.cycle?.cost?.cost != null
      ? `Estimated run cost: ${result.cycle.cost.cost} credits.`
      : "The agent prepared a non-spending flow state.";
  }

  if (toolCall.name === "bootstrapWorkflow") {
    return result.target?.url || "The agent created a copy and applied safe setup.";
  }

  return "The agent completed a tool step.";
}

function toolLabel(name) {
  switch (name) {
    case "planWorkflow":
      return "Workflow plan";
    case "draftWorkflow":
      return "Workflow draft";
    case "prepareWorkflow":
      return "Safe preparation";
    case "bootstrapWorkflow":
      return "Bootstrap copy";
    case "inspectWorkflow":
      return "Recipe inspection";
    default:
      return name;
  }
}

function parseInlineInputs(value) {
  const entries = {};

  for (const line of String(value || "")
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (key) {
      entries[key] = rawValue;
    }
  }

  return entries;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
