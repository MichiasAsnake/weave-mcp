import { CompilerIntentSchema } from "./intent-zod.ts";
import type { CompilerIntent, CompilerOperation } from "./types.ts";

function extractRequestedFormat(text: string): string | null {
  const normalized = text.toLowerCase();
  for (const format of ["png", "jpg", "jpeg", "webp", "psd"]) {
    if (new RegExp(`\b${format}\b`, "i").test(normalized)) {
      return format;
    }
  }
  return null;
}

export function parseCompilerIntent(userRequest: string): CompilerIntent {
  const text = userRequest.toLowerCase();
  const format = extractRequestedFormat(text);
  const operations: CompilerOperation[] = [];

  if (/upload|uploaded|input image|image file/.test(text)) {
    operations.push({
      kind: "upload",
      summary: "Allow the user to upload an image file.",
      inputKind: null,
      outputKind: "file",
      requiresUserInput: true,
      requestedFormat: null,
    });
  }

  if (/upscale|upscaling/.test(text)) {
    operations.push({
      kind: "upscale-image",
      summary: "Upscale the uploaded image.",
      inputKind: "image",
      outputKind: "image",
      requiresUserInput: false,
      requestedFormat: null,
    });
  }

  if (/export|download|save/.test(text)) {
    operations.push({
      kind: "export",
      summary: format
        ? `Export the upscaled image as ${format.toUpperCase()}.`
        : /user-specified|specified format|chosen format/.test(text)
          ? "Export the upscaled image in a user-specified format."
          : "Export the upscaled image.",
      inputKind: "image",
      outputKind: "file",
      requiresUserInput: !format,
      requestedFormat: format,
    });
  }

  const ambiguities = [];
  if (!/image/.test(text)) {
    ambiguities.push({
      code: "missing-image-domain",
      message: "The request does not clearly describe an image workflow.",
    });
  }

  return CompilerIntentSchema.parse({
    domain: /image/.test(text) ? "image" : "unknown",
    originalRequest: userRequest,
    input: {
      source: /upload|uploaded|image file/.test(text) ? "user_upload" : "unknown",
      kind: "file",
    },
    operations,
    output: {
      kind: /export|download|save/.test(text) ? "file" : "unknown",
      format,
      delivery: /export|download|save/.test(text) ? "download" : "unknown",
    },
    appMode: {
      enabled: /upload|user/.test(text),
      requiredFields: format ? ["image_upload"] : ["image_upload", "output_format"],
    },
    ambiguities,
  });
}
