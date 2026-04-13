import { CompilerIntentSchema } from "./intent-zod.ts";
import type { CompilerIntent, CompilerOperation } from "./types.ts";

function extractRequestedFormat(text: string): string | null {
  const normalized = text.toLowerCase();
  for (const format of ["png", "jpg", "jpeg", "webp", "psd"]) {
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

function buildTransformOperations(text: string): CompilerOperation[] {
  const candidates: Array<{ index: number; operation: CompilerOperation }> = [];

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

  return candidates.sort((a, b) => a.index - b.index).map((entry) => entry.operation);
}

export function parseCompilerIntent(userRequest: string): CompilerIntent {
  const text = userRequest.toLowerCase();
  const format = extractRequestedFormat(text);
  const operations: CompilerOperation[] = [];
  const transformOperations = buildTransformOperations(text);
  const mentionsImage = /image|photo|picture/.test(text);
  const hasExport = /export|download|save/.test(text);
  const hasUserUpload = /upload|uploaded|input image|image file|this image/.test(text) || (mentionsImage && transformOperations.length > 0);

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
        ? `Export the resulting image as ${format.toUpperCase()}.`
        : /user-specified|specified format|chosen format/.test(text)
          ? "Export the resulting image in a user-specified format."
          : "Export the resulting image.",
      inputKind: "image",
      outputKind: "file",
      requiresUserInput: !format,
      requestedFormat: format,
    });
  }

  const ambiguities = [];
  if (!mentionsImage) {
    ambiguities.push({
      code: "missing-image-domain",
      message: "The request does not clearly describe an image workflow.",
    });
  }
  if (transformOperations.length === 0) {
    ambiguities.push({
      code: "missing-transform-operation",
      message: "The request does not clearly specify a supported image operation.",
    });
  }

  const requiredFields: string[] = [];
  if (hasUserUpload) requiredFields.push("image_upload");
  if (transformOperations.some((operation) => operation.kind === "edit-image")) requiredFields.push("edit_prompt");
  if (hasExport && !format) requiredFields.push("output_format");

  const outputKind = hasExport ? "file" : transformOperations.length > 0 ? "image" : "unknown";

  return CompilerIntentSchema.parse({
    domain: mentionsImage ? "image" : "unknown",
    originalRequest: userRequest,
    input: {
      source: hasUserUpload ? "user_upload" : "unknown",
      kind: hasUserUpload ? "file" : "unknown",
    },
    operations,
    output: {
      kind: outputKind,
      format,
      delivery: hasExport ? "download" : transformOperations.length > 0 ? "preview" : "unknown",
    },
    appMode: {
      enabled: requiredFields.length > 0,
      requiredFields,
    },
    ambiguities,
  });
}
