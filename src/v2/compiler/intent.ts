import { CompilerIntentSchema } from "./intent-zod.ts";
import type { CompilerIntent, CompilerOperation } from "./types.ts";

function extractRequestedFormat(text: string): string | null {
  const normalized = text.toLowerCase();
  for (const format of ["png", "jpg", "jpeg", "webp", "psd", "mp4", "mov", "gif"]) {
    if (new RegExp(`\\b${format}\\b`, "i").test(normalized)) {
      return format;
    }
  }
  return null;
}

function findMatchIndex(text: string, patterns: RegExp[]): number {
  const indexes = patterns
    .map((pattern) => text.search(pattern))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : Number.POSITIVE_INFINITY;
}

function inferDomain(text: string): CompilerIntent["domain"] {
  if (/\bvideo\b|\bclip\b|\banimation\b|\bmovie\b/.test(text)) {
    return "video";
  }
  if (/\bimage\b|\bphoto\b|\bpicture\b|\bportrait\b|\bart\b|\billustration\b|\bicon\b|\blogo\b/.test(text)) {
    return "image";
  }
  return "unknown";
}

function shouldSortBefore(otherKind: CompilerOperation["kind"], currentKind: CompilerOperation["kind"]): boolean {
  return currentKind === "enhance-prompt"
    && ["edit-image", "generate-image", "generate-video"].includes(otherKind);
}

function buildTransformOperations(text: string, domain: CompilerIntent["domain"]): CompilerOperation[] {
  const candidates: Array<{ index: number; operation: CompilerOperation }> = [];
  const mentionsPrompt = /\bprompt\b|text prompt|type a prompt/.test(text);

  const enhancePromptIndex = findMatchIndex(text, [
    /\benhance(?:s|d|ing)?\b.*\bprompt\b/,
    /\bimprov(?:e|es|ed|ing)\b.*\bprompt\b/,
    /\bprompt enhancer\b/,
    /\bbetter prompt\b/,
    /\boptimi(?:ze|zes|zed|zing)\b.*\bprompt\b/,
    /\benhance(?:s|d|ing)?\b.*\bit\b/,
    /\bimprov(?:e|es|ed|ing)\b.*\bit\b/,
  ]);
  if (Number.isFinite(enhancePromptIndex) && mentionsPrompt) {
    candidates.push({
      index: enhancePromptIndex,
      operation: {
        kind: "enhance-prompt",
        summary: "Enhance the user's prompt before generation.",
        inputKind: "text",
        outputKind: "text",
        requiresUserInput: true,
        requestedFormat: null,
      },
    });
  }

  const editIndex = findMatchIndex(text, [
    /\bedit(?:s|ing|ed)?\b/,
    /\bmodif(?:y|ies|ied|ying)\b/,
    /\bretouch(?:es|ing|ed)?\b/,
    /\brestyl(?:e|es|ed|ing)\b/,
    /\btransform(?:s|ed|ing)?\b/,
    /\bchange(?:s|d|ing)?\b/,
    /remove background/,
    /erase/,
    /replace/,
  ]);
  if (Number.isFinite(editIndex)) {
    candidates.push({
      index: editIndex,
      operation: {
        kind: "edit-image",
        summary: "Apply prompt-guided edits to the image.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: true,
        requestedFormat: null,
      },
    });
  }

  const upscaleIndex = findMatchIndex(text, [/\bupscale(?:s|d|ing)?\b/]);
  if (Number.isFinite(upscaleIndex)) {
    candidates.push({
      index: upscaleIndex,
      operation: {
        kind: "upscale-image",
        summary: "Upscale the image.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const generateIndex = findMatchIndex(text, [
    /\bgenerate(?:s|d|ing)?\b/,
    /\bcreate(?:s|d|ing)?\b/,
    /\bmake(?:s|ing)?\b/,
    /\bproduce(?:s|d|ing)?\b/,
  ]);
  const mentionsUpload = /upload|uploaded|input image|image file|this image/.test(text);
  if (!mentionsUpload && (Number.isFinite(generateIndex) || mentionsPrompt)) {
    if (domain === "image") {
      candidates.push({
        index: Number.isFinite(generateIndex) ? generateIndex : 0,
        operation: {
          kind: "generate-image",
          summary: "Generate an image from a text prompt.",
          inputKind: "text",
          outputKind: "image",
          requiresUserInput: true,
          requestedFormat: null,
        },
      });
    }
    if (domain === "video") {
      candidates.push({
        index: Number.isFinite(generateIndex) ? generateIndex : 0,
        operation: {
          kind: "generate-video",
          summary: "Generate a video from a text prompt.",
          inputKind: "text",
          outputKind: "video",
          requiresUserInput: true,
          requestedFormat: null,
        },
      });
    }
  }

  const uniqueByKind = new Map<string, { index: number; operation: CompilerOperation }>();
  for (const candidate of candidates) {
    const existing = uniqueByKind.get(candidate.operation.kind);
    if (!existing || candidate.index < existing.index) {
      uniqueByKind.set(candidate.operation.kind, candidate);
    }
  }

  return Array.from(uniqueByKind.values())
    .sort((a, b) => {
      if (shouldSortBefore(b.operation.kind, a.operation.kind)) return -1;
      if (shouldSortBefore(a.operation.kind, b.operation.kind)) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.operation);
}

export function parseCompilerIntent(userRequest: string): CompilerIntent {
  const text = userRequest.toLowerCase();
  const format = extractRequestedFormat(text);
  const domain = inferDomain(text);
  const operations: CompilerOperation[] = [];
  const transformOperations = buildTransformOperations(text, domain);
  const hasExport = /export|download|save/.test(text);
  const hasWorkflowIntent = /\bapp\b|\bworkflow\b|\bflow\b|\bpipeline\b|design app|tool/.test(text) || transformOperations.length > 0;
  const hasUserUpload = /upload|uploaded|input image|image file|this image/.test(text) || (domain === "image" && transformOperations.some((operation) => operation.kind === "edit-image" || operation.kind === "upscale-image"));

  if (hasUserUpload) {
    operations.push({
      kind: "upload",
      summary: "Allow the user to upload an image file.",
      inputKind: null,
      outputKind: "file",
      requiresUserInput: true,
      requestedFormat: null,
    });
  }

  operations.push(...transformOperations);

  if (hasExport) {
    operations.push({
      kind: "export",
      summary: format
        ? `Export the resulting ${domain === "video" ? "video" : "image"} as ${format.toUpperCase()}.`
        : /user-specified|specified format|chosen format/.test(text)
          ? `Export the resulting ${domain === "video" ? "video" : "image"} in a user-specified format.`
          : `Export the resulting ${domain === "video" ? "video" : "image"}.`,
      inputKind: domain === "video" ? "video" : "image",
      outputKind: "file",
      requiresUserInput: !format,
      requestedFormat: format,
    });
  } else if (hasWorkflowIntent && domain !== "unknown") {
    operations.push({
      kind: "output-result",
      summary: `Expose the resulting ${domain === "video" ? "video" : "image"} in the app output.`,
      inputKind: domain === "video" ? "video" : "image",
      outputKind: null,
      requiresUserInput: false,
      requestedFormat: null,
    });
  }

  const ambiguities = [];
  if (domain === "unknown") {
    ambiguities.push({
      code: "missing-supported-domain",
      message: "The request does not clearly describe a supported image or video workflow.",
    });
  }
  if (transformOperations.length === 0) {
    ambiguities.push({
      code: "missing-transform-operation",
      message: "The request does not clearly specify a supported generation or transform operation.",
    });
  }

  const requiredFields: string[] = [];
  if (hasUserUpload) requiredFields.push("image_upload");
  if (transformOperations.some((operation) => operation.kind === "edit-image")) requiredFields.push("edit_prompt");
  if (transformOperations.some((operation) => ["enhance-prompt", "generate-image", "generate-video"].includes(operation.kind))) requiredFields.push("prompt");
  if (hasExport && !format) requiredFields.push("output_format");

  const outputKind = hasExport ? "file" : domain === "video" ? "video" : hasWorkflowIntent ? "image" : "unknown";

  return CompilerIntentSchema.parse({
    domain,
    originalRequest: userRequest,
    input: {
      source: hasUserUpload ? "user_upload" : transformOperations.some((operation) => ["enhance-prompt", "generate-image", "generate-video"].includes(operation.kind)) ? "prompt" : "unknown",
      kind: hasUserUpload ? "file" : transformOperations.some((operation) => ["enhance-prompt", "generate-image", "generate-video"].includes(operation.kind)) ? "text" : "unknown",
    },
    operations,
    output: {
      kind: outputKind,
      format,
      delivery: hasExport ? "download" : hasWorkflowIntent ? "app_output" : "unknown",
    },
    appMode: {
      enabled: requiredFields.length > 0,
      requiredFields,
    },
    ambiguities,
  });
}
