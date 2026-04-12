"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

export default function AgentStudio({
  goal,
  initialAuth,
  initialTemplates,
  inlineInputs,
  reference,
  setGoal,
  setInlineInputs,
  setReference,
  setTemplate,
  template,
}) {
  const [auth, setAuth] = useState(initialAuth);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedAsset, setUploadedAsset] = useState(null);
  const [response, setResponse] = useState(null);
  const [error, setError] = useState("");
  const [activeAction, setActiveAction] = useState("plan");
  const [uploadMessage, setUploadMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [isUploading, startUploadTransition] = useTransition();

  const parsedInputs = useMemo(() => parseInlineInputs(inlineInputs), [inlineInputs]);
  const summary = summarizeResponse(response);

  useEffect(() => {
    let cancelled = false;

    async function hydrateAuth() {
      try {
        const result = await fetch("/api/auth", {
          method: "GET",
        });
        const json = await result.json();
        if (!cancelled && result.ok && json.ok && json.data) {
          setAuth(json.data);
        }
      } catch {
        // Keep the placeholder auth state if the request fails.
      }
    }

    hydrateAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  function runAction(action) {
    setActiveAction(action);
    setError("");

    startTransition(async () => {
      try {
        const payload = {
          goal,
          template,
          reference: reference || undefined,
          inputs: parsedInputs,
        };

        let endpoint = "/api/plan";

        if (action === "draft") {
          endpoint = "/api/draft";
        } else if (action === "prepare") {
          endpoint = "/api/cycle";
        } else if (action === "bootstrap") {
          endpoint = "/api/bootstrap";
        }

        if (action === "prepare") {
          payload.execute = false;
          payload.repair = false;
        }

        const result = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const json = await result.json();
        if (!result.ok || !json.ok) {
          throw new Error(json.error || "Request failed.");
        }

        setResponse(json.data);
      } catch (requestError) {
        setError(requestError.message);
      }
    });
  }

  function uploadSelectedFile() {
    if (!selectedFile) {
      setUploadMessage("Choose a local image or video file first.");
      return;
    }

    setUploadMessage("");
    setError("");

    startUploadTransition(async () => {
      try {
        const formData = new FormData();
        formData.append("file", selectedFile);

        const result = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const json = await result.json();
        if (!result.ok || !json.ok) {
          throw new Error(json.error || "Upload failed.");
        }

        setUploadedAsset(json.data);
        setReference(json.data.publicUrl);
        setUploadMessage(
          json.data.localOnly
            ? "File staged locally. This URL will work fully once the app is deployed on a public host."
            : "File uploaded and ready for the agent.",
        );
      } catch (uploadError) {
        setUploadMessage(uploadError.message);
      }
    });
  }

  return (
    <section className="workbench">
      <div className="composer-panel panel">
        <div className="panel-head">
          <p className="panel-kicker">Compose</p>
          <h2>Describe the workflow app you want</h2>
          <p>
            This studio hits the same agent core as the CLI. Right now it is best at
            planning, drafting, structural preparation, and non-spending flow setup.
          </p>
        </div>

        <label className="field">
          <span>Goal</span>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            rows={6}
            placeholder="Describe the workflow or app"
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Template</span>
            <select value={template} onChange={(event) => setTemplate(event.target.value)}>
              {initialTemplates.map((item) => (
                <option key={item.alias} value={item.alias}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Reference Asset URL</span>
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="https://..."
            />
          </label>
        </div>

        <div className="upload-card">
          <div className="upload-copy">
            <span>Local asset staging</span>
            <strong>Upload a file and the app will mint a reference URL for the agent.</strong>
          </div>
          <div className="upload-actions">
            <input
              accept="image/*,video/*"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
              type="file"
            />
            <button
              className="action"
              disabled={isUploading}
              onClick={uploadSelectedFile}
              type="button"
            >
              {isUploading ? "Uploading..." : "Stage File"}
            </button>
          </div>
          {selectedFile ? (
            <p className="upload-meta">
              Selected: {selectedFile.name} ({formatBytes(selectedFile.size)})
            </p>
          ) : null}
          {uploadedAsset ? (
            <p className="upload-meta">
              Staged asset: <code>{uploadedAsset.publicUrl}</code>
            </p>
          ) : null}
          {uploadMessage ? <p className="upload-note">{uploadMessage}</p> : null}
        </div>

        <label className="field">
          <span>Extra Inputs</span>
          <textarea
            value={inlineInputs}
            onChange={(event) => setInlineInputs(event.target.value)}
            rows={3}
            placeholder={`Clothing=white running shoe campaign\nStyle=clean editorial minimalism`}
          />
        </label>

        <div className="action-row">
          <button
            className="action action-primary"
            disabled={isPending}
            onClick={() => runAction("plan")}
            type="button"
          >
            {isPending && activeAction === "plan" ? "Planning..." : "Plan"}
          </button>
          <button
            className="action"
            disabled={isPending}
            onClick={() => runAction("draft")}
            type="button"
          >
            {isPending && activeAction === "draft" ? "Drafting..." : "Draft"}
          </button>
          <button
            className="action"
            disabled={isPending}
            onClick={() => runAction("prepare")}
            type="button"
          >
            {isPending && activeAction === "prepare" ? "Preparing..." : "Prepare Flow"}
          </button>
          <button
            className="action"
            disabled={isPending}
            onClick={() => runAction("bootstrap")}
            type="button"
          >
            {isPending && activeAction === "bootstrap" ? "Bootstrapping..." : "Bootstrap Copy"}
          </button>
        </div>

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="hint-grid">
          <div className="hint-card">
            <span>Session</span>
            <strong>{auth.authenticated ? "Live Weavy auth detected" : "No auth"}</strong>
          </div>
          <div className="hint-card">
            <span>Reference Input</span>
            <strong>
              {uploadedAsset
                ? "Local asset staged into a reference URL"
                : reference
                  ? "Ready to map into import nodes"
                : "Optional"}
            </strong>
          </div>
          <div className="hint-card">
            <span>Spend Safety</span>
            <strong>Prepare Flow stays non-spending</strong>
          </div>
        </div>
      </div>

      <div className="result-panel panel">
        <div className="panel-head">
          <p className="panel-kicker">Output</p>
          <h2>Agent response</h2>
          <p>The right column keeps the raw JSON visible while surfacing the key steps.</p>
        </div>

        <div className="summary-strip">
          <article>
            <span>Stage</span>
            <strong>{summary.stage}</strong>
          </article>
          <article>
            <span>Template</span>
            <strong>{summary.template}</strong>
          </article>
          <article>
            <span>Target</span>
            <strong>{summary.target}</strong>
          </article>
        </div>

        <div className="summary-card">
          <h3>Quick read</h3>
          <ul className="flat-list">
            {summary.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="json-card">
          <div className="json-head">
            <span>Raw payload</span>
            <span>{response ? "live" : "waiting"}</span>
          </div>
          <pre>{response ? JSON.stringify(response, null, 2) : "Run an action to see the agent payload."}</pre>
        </div>
      </div>
    </section>
  );
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

function summarizeResponse(response) {
  if (!response) {
    return {
      stage: "idle",
      template: "none",
      target: "none",
      items: [
        "Plan will inspect templates and propose a workflow strategy.",
        "Draft will include capability and structural mutation plans.",
        "Prepare Flow will materialize a recipe and estimate spend without running it.",
      ],
    };
  }

  const items = [];

  if (response.trace?.length) {
    items.push(response.trace[response.trace.length - 1]);
  }
  if (response.capabilityPlan?.strategy?.summary) {
    items.push(response.capabilityPlan.strategy.summary);
  }
  if (response.structuralToolPlan?.summary?.readyToolCount) {
    items.push(
      `${response.structuralToolPlan.summary.readyToolCount} structural tool(s) are ready to auto-apply.`,
    );
  }
  if (response.appliedStructuralTools?.length) {
    items.push(
      `${response.appliedStructuralTools.length} structural tool(s) were applied to the recipe.`,
    );
  }
  if (response.cycle?.cost?.cost != null) {
    items.push(`Estimated run cost: ${response.cycle.cost.cost} credits.`);
  }
  if (response.target?.url) {
    items.push(`Target flow: ${response.target.url}`);
  }

  return {
    stage: response.cycle?.stage || response.stage || "ready",
    template: response.template?.label || response.template?.alias || "custom",
    target: response.target?.name || response.recipe?.name || "not created",
    items: items.length > 0 ? items : ["The agent returned data without a summary signal."],
  };
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
