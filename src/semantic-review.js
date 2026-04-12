const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_REVIEW_MODEL = process.env.OPENAI_REVIEW_MODEL || "gpt-5";

async function reviewRunSemantics({
  recipe,
  structuralEvaluation,
  diagnosis,
  runIds,
}) {
  if (diagnosis?.kind !== "completed") {
    return unavailableReview(
      "semantic-review-skipped",
      "Semantic review only runs after a successful completed run.",
    );
  }

  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return unavailableReview(
      "semantic-review-unavailable",
      "OPENAI_API_KEY is not set.",
    );
  }

  const imageAssets = (diagnosis.assets || []).filter(
    (asset) => asset.type === "image" && asset.url,
  );
  if (imageAssets.length === 0) {
    return unavailableReview(
      "semantic-review-unavailable",
      "No completed image outputs were available for semantic review.",
    );
  }

  const promptContext = buildPromptContext(recipe, structuralEvaluation, diagnosis, runIds);
  let response;
  let payload;
  try {
    response = await fetch(buildResponsesUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_REVIEW_MODEL,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are reviewing creative workflow outputs for an autonomous repair agent. " +
                  "Judge only what is visible in the images and the supplied workflow context. " +
                  "Respond with strict JSON only and no markdown.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: promptContext,
              },
              ...imageAssets.slice(0, 6).map((asset) => ({
                type: "input_image",
                image_url: asset.url,
              })),
            ],
          },
        ],
      }),
    });
    payload = await response.json().catch(() => null);
  } catch (error) {
    return unavailableReview("semantic-review-error", error.message || "Network error");
  }
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      `OpenAI semantic review failed with status ${response.status}`;
    return unavailableReview("semantic-review-error", message);
  }

  const rawText = extractResponseText(payload);
  const parsed = parseJsonObject(rawText);
  if (!parsed) {
    return unavailableReview(
      "semantic-review-error",
      "The semantic reviewer returned an unreadable response.",
      {
        model: DEFAULT_REVIEW_MODEL,
        rawText,
      },
    );
  }

  return normalizeSemanticReview(parsed, {
    model: payload?.model || DEFAULT_REVIEW_MODEL,
    rawText,
  });
}

function buildResponsesUrl() {
  const baseUrl = (process.env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL).replace(
    /\/$/,
    "",
  );
  return `${baseUrl}/responses`;
}

function buildPromptContext(recipe, structuralEvaluation, diagnosis, runIds) {
  const outputSummaries = (structuralEvaluation?.outputSummaries || [])
    .map((output, index) => {
      const crop = output.sourceCrop
        ? `crop=${output.sourceCrop.width}x${output.sourceCrop.height}@${output.sourceCrop.x},${output.sourceCrop.y}`
        : "crop=unknown";
      const size = output.intermediateSize
        ? `intermediate=${output.intermediateSize.width}x${output.intermediateSize.height}`
        : "intermediate=unknown";
      return `${index + 1}. ${output.name} branch=${output.sourceBranchId || "unknown"} ${crop} ${size} prompt=${output.promptPreview || "<none>"}`;
    })
    .join("\n");

  const deliveredAssets = (diagnosis.assets || [])
    .map(
      (asset, index) =>
        `${index + 1}. type=${asset.type} size=${asset.width || "?"}x${asset.height || "?"} inputPrompt=${asset.input?.prompt || "<none>"}`,
    )
    .join("\n");

  const structuralFindings = (structuralEvaluation?.findings || [])
    .map((finding) => `- [${finding.severity}] ${finding.summary}`)
    .join("\n");

  return [
    "Review these completed Weavy workflow outputs.",
    "",
    `Recipe: ${recipe?.name || recipe?.id || "Unknown recipe"}`,
    `Run IDs: ${(runIds || []).join(", ") || "unknown"}`,
    "",
    "Structural review context:",
    `- score: ${structuralEvaluation?.score ?? "n/a"}`,
    `- verdict: ${structuralEvaluation?.verdict || "n/a"}`,
    `- expected outputs: ${structuralEvaluation?.expectedOutputCount ?? "n/a"}`,
    `- actual outputs: ${structuralEvaluation?.actualOutputCount ?? "n/a"}`,
    `- asset types: ${(structuralEvaluation?.assetTypes || []).join(", ") || "n/a"}`,
    `- aspect ratios: ${(structuralEvaluation?.aspectRatios || []).join(", ") || "n/a"}`,
    structuralFindings ? structuralFindings : "- no structural findings",
    "",
    "Workflow branch summaries:",
    outputSummaries || "No output branch summaries available.",
    "",
    "Delivered assets:",
    deliveredAssets || "No delivered assets available.",
    "",
    "Return JSON with this shape:",
    JSON.stringify(
      {
        score: 0,
        verdict: "short sentence",
        strengths: ["string"],
        findings: [
          {
            severity: "low|medium|high",
            summary: "short sentence",
            evidence: "brief evidence grounded in visible outputs",
          },
        ],
        nextActions: ["string"],
      },
      null,
      2,
    ),
    "",
    "Scoring guidance:",
    "- Evaluate prompt adherence, consistency of subject/clothing across outputs, branch variation, composition quality, and overall publishability.",
    "- Penalize duplicated-looking outputs, broken anatomy, inconsistent identity, muddled styling, unreadable garment details, and weak visual separation between branches.",
    "- Do not claim hidden metadata or generation settings as visual evidence.",
    "- If uncertain, say so in evidence rather than overclaiming.",
  ].join("\n");
}

function extractResponseText(payload) {
  if (!payload) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const fragments = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        fragments.push(content.text);
      } else if (typeof content.output_text === "string") {
        fragments.push(content.output_text);
      }
    }
  }

  return fragments.join("\n").trim();
}

function parseJsonObject(text) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeSemanticReview(parsed, metadata) {
  const findings = Array.isArray(parsed.findings)
    ? parsed.findings
        .map((finding) => ({
          severity: normalizeSeverity(finding?.severity),
          summary: String(finding?.summary || "").trim(),
          evidence: String(finding?.evidence || "").trim(),
        }))
        .filter((finding) => finding.summary)
    : [];

  const review = {
    available: true,
    stage: "semantic-review-completed",
    provider: "openai",
    model: metadata.model,
    score: clampScore(parsed.score),
    verdict: String(parsed.verdict || "").trim() || "Semantic review completed.",
    strengths: normalizeStringList(parsed.strengths),
    findings,
    nextActions: normalizeStringList(parsed.nextActions),
    rawText: metadata.rawText,
  };

  return review;
}

function unavailableReview(stage, reason, extra = {}) {
  return {
    available: false,
    stage,
    reason,
    ...extra,
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeSeverity(value) {
  const normalized = String(value || "").toLowerCase().trim();
  return ["low", "medium", "high"].includes(normalized) ? normalized : "medium";
}

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

module.exports = {
  reviewRunSemantics,
};
