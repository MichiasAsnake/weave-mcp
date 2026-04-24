import { CompilerIntentSchema } from "./intent-zod.ts";
import type { CompilerIntent, CompilerOperation, CompilerPromptPrimitive } from "./types.ts";

const COUNT_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

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

function normalizePromptKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:a|an|the)\b/g, " ")
    .replace(/\b(?:field|fields|input|inputs|variable|variables)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function toPromptLabel(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function splitPromptVariableSegment(segment: string): Array<{ key: string; label: string }> {
  return segment
    .replace(/\s+or\s+/gi, ", ")
    .replace(/\s+and\s+/gi, ", ")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/\b(?:a|an|the)\b/gi, "").trim())
    .map((entry) => ({ key: normalizePromptKey(entry), label: toPromptLabel(entry) }))
    .filter((entry) =>
      entry.key.length > 0
      && !["prompt", "image", "video", "comparison"].includes(entry.key)
      && !/^(generate|create|make|produce|compare|compose|concatenate|combine|assemble|join)_/.test(entry.key),
    );
}

function extractPromptVariables(userRequest: string): Array<{ key: string; label: string }> {
  const bracketedVariables = Array.from(userRequest.matchAll(/\{([^}]+)\}/g))
    .map((match) => match[1]?.trim() || "")
    .filter(Boolean)
    .map((entry) => ({ key: normalizePromptKey(entry), label: toPromptLabel(entry) }))
    .filter((entry, index, list) => entry.key.length > 0 && list.findIndex((candidate) => candidate.key === entry.key) === index);

  if (bracketedVariables.length > 0) {
    return bracketedVariables.slice(0, 6);
  }

  const patterns = [
    /\b(?:enter|input|provide|specify|fill in)\s+(.+?)(?=(?:,\s*(?:then\s+)?(?:compose|combine|concatenate|assemble|join|generate|create|make|produce|compare|upload|import|drop)\b|\s+and\s+(?:compose|combine|concatenate|assemble|join|generate|create|make|produce|compare|upload|import|drop)\b|\s+to\s+(?:compose|combine|concatenate|assemble|join|generate|create|make|produce|compare|upload|import|drop)\b|$))/i,
    /\bwith\s+(?:named\s+)?(?:fields?|inputs?|variables?)\s+(.+?)(?=(?:,\s*(?:then\s+)?(?:compose|combine|concatenate|assemble|join|generate|create|make|produce|compare|upload|import|drop)\b|\s+and\s+(?:compose|combine|concatenate|assemble|join|generate|create|make|produce|compare|upload|import|drop)\b|\s+to\s+(?:compose|combine|concatenate|assemble|join|generate|create|make|produce|compare|upload|import|drop)\b|$))/i,
    /\bnamed\s+(.+?)(?:\s+(?:fields?|inputs?|variables?))\b/i,
  ];

  for (const pattern of patterns) {
    const match = userRequest.match(pattern);
    if (!match) continue;

    const variables = splitPromptVariableSegment(match[1]);
    if (variables.length > 0) {
      return variables
        .filter((entry, index, list) => list.findIndex((candidate) => candidate.key === entry.key) === index)
        .slice(0, 6);
    }
  }

  return [];
}

function requiresPromptComposition(text: string, promptVariables: Array<{ key: string; label: string }>): boolean {
  if (promptVariables.length <= 1) {
    return false;
  }

  return /\bcompose\b|\bconcatenate\b|\bcombine\b|\bassemble\b|\bjoin\b|into a prompt|single prompt|shared prompt/.test(text);
}

function extractRequestedCount(text: string): number | null {
  const match = text.match(/\b(\d+|one|two|three|four|five|six)\s+(?:different\s+)?(?:image|images|video|videos|clip|clips|variation|variations|model|models|branch|branches)\b/i);
  if (!match) {
    return null;
  }

  const rawValue = match[1].toLowerCase();
  if (/^\d+$/.test(rawValue)) {
    return Number.parseInt(rawValue, 10);
  }

  return COUNT_WORDS[rawValue] || null;
}

function hasExplicitUploadCountCue(text: string): boolean {
  return /\b(\d+|one|two|three|four|five|six)\s+(?:character images?|characters?|location references?|location images?|images?|videos?|audio clips?|audio tracks?|audio files?|clips?)\b/.test(text);
}

function extractModelHints(text: string): string[] {
  const hints = [
    "gpt image",
    "flux",
    "ideogram",
    "recraft",
    "imagen",
    "midjourney",
    "runway",
    "luma",
    "hunyuan",
    "wan",
    "kling",
    "pixverse",
    "gemini",
  ];

  return hints.filter((hint) => text.includes(hint));
}

function hasOpenEndedPluralCue(text: string): boolean {
  if (/\bmultiple\b|\bseveral\b|\ba set of\b|\bset of\b|\bcollection of\b|\bgroup of\b/.test(text)) {
    return true;
  }

  return /\bupload(?:ed|ing)?\b|\bimport(?:ed|ing)?\b|\bdrop\b/.test(text)
    && !hasExplicitUploadCountCue(text)
    && /\bcharacter images\b|\bcharacters\b|\blocation references?\b|\blocation images\b|\bimages\b|\bvideos\b|\baudio clips?\b|\baudio tracks?\b|\baudio files?\b/.test(text);
}

function inferCollectionItemKind(text: string): CompilerOperation["collectionItemKind"] {
  if (/\bvideo clips?\b|\bvideos?\b/.test(text)) return "video";
  if (/\baudio clips?\b|\baudio tracks?\b|\baudio files?\b/.test(text)) return "audio";
  if (/\bimages?\b|\bphotos?\b|\bpictures?\b|\bcharacters?\b|\blocations?\b/.test(text)) return "image";
  return "file";
}

function usesCollectionItemKind(
  operation: CompilerOperation,
  collectionItemKinds: Set<NonNullable<CompilerOperation["collectionItemKind"]>>,
): boolean {
  const inputKind = operation.inputKind;
  const manualInputKinds = operation.manualInputKinds || [];
  return Boolean(
    (inputKind && collectionItemKinds.has(inputKind))
    || manualInputKinds.some((kind) => collectionItemKinds.has(kind)),
  );
}

function reorderIteratorBackedTransforms(
  operations: CompilerOperation[],
  collectionItemKinds: Set<NonNullable<CompilerOperation["collectionItemKind"]>>,
): CompilerOperation[] {
  const preItemKinds = new Set<CompilerOperation["kind"]>(["fanout", "foreach", "map"]);
  const postItemKinds = new Set<CompilerOperation["kind"]>(["fanin", "reduce"]);
  const specialIndexes = operations
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => (
      preItemKinds.has(operation.kind)
      || postItemKinds.has(operation.kind)
      || usesCollectionItemKind(operation, collectionItemKinds)
    ))
    .map(({ index }) => index);

  if (specialIndexes.length <= 1) {
    return operations;
  }

  const start = Math.min(...specialIndexes);
  const end = Math.max(...specialIndexes);
  const leading = operations.slice(0, start);
  const trailing = operations.slice(end + 1);
  const segment = operations.slice(start, end + 1);
  const preItem = segment.filter((operation) => preItemKinds.has(operation.kind));
  const itemScoped = segment.filter((operation) =>
    !preItemKinds.has(operation.kind)
    && !postItemKinds.has(operation.kind)
    && usesCollectionItemKind(operation, collectionItemKinds),
  );
  const postItem = segment.filter((operation) => postItemKinds.has(operation.kind));
  const passthrough = segment.filter((operation) =>
    !preItemKinds.has(operation.kind)
    && !postItemKinds.has(operation.kind)
    && !usesCollectionItemKind(operation, collectionItemKinds),
  );

  return [...leading, ...preItem, ...itemScoped, ...postItem, ...passthrough, ...trailing];
}

function toFieldHelpText(label: string, descriptor: string): string {
  return `Provide ${descriptor} for ${label.toLowerCase()}.`;
}

function buildCollectionInputOperations(text: string): CompilerOperation[] {
  const operations: CompilerOperation[] = [];
  const hasOpenEnded = hasOpenEndedPluralCue(text);

  if (/\btagged set of character images\b|\btagged character images\b/.test(text)) {
    operations.push({
      kind: "tagged-input-set",
      summary: "Collect a tagged set of character images.",
      inputKind: null,
      outputKind: "array",
      requiresUserInput: true,
      requestedFormat: null,
      collectionItemKind: "image",
      countMode: "open-ended",
      fieldLabels: {
        collection: "Character Images",
      },
      fieldHelpText: {
        collection: "Upload character images and tag each one for downstream routing.",
      },
    });
  } else if (hasOpenEnded && /\bcharacter images\b|\bcharacters\b/.test(text)) {
    operations.push({
      kind: "image-collection",
      summary: "Collect a reusable set of character images.",
      inputKind: null,
      outputKind: "array",
      requiresUserInput: true,
      requestedFormat: null,
      collectionItemKind: "image",
      countMode: "open-ended",
      fieldLabels: {
        collection: "Character Images",
      },
      fieldHelpText: {
        collection: "Upload one or more character images.",
      },
    });
  }

  if (/\btagged location images\b|\btagged location references\b/.test(text)) {
    operations.push({
      kind: "tagged-input-set",
      summary: "Collect a tagged set of location reference images.",
      inputKind: null,
      outputKind: "array",
      requiresUserInput: true,
      requestedFormat: null,
      collectionItemKind: "image",
      countMode: "open-ended",
      fieldLabels: {
        collection: "Location References",
      },
      fieldHelpText: {
        collection: "Upload location reference images and tag each one for downstream pairing.",
      },
    });
  } else if ((hasOpenEnded || /\blocation references?\b/.test(text)) && /\blocation references?\b|\blocation images\b/.test(text)) {
    operations.push({
      kind: "reference-set",
      summary: "Collect a reusable set of location reference images.",
      inputKind: null,
      outputKind: "array",
      requiresUserInput: true,
      requestedFormat: null,
      collectionItemKind: "image",
      countMode: "open-ended",
      fieldLabels: {
        collection: "Location References",
      },
      fieldHelpText: {
        collection: "Upload one or more location reference images.",
      },
    });
  }

  if (operations.length === 0 && hasOpenEnded && /upload/.test(text) && /\bimages?\b|\bvideos?\b|\baudio\b/.test(text)) {
    const itemKind = inferCollectionItemKind(text);
    operations.push({
      kind: "array-input",
      summary: `Collect a reusable ${itemKind} collection from the user.`,
      inputKind: null,
      outputKind: "array",
      requiresUserInput: true,
      requestedFormat: null,
      collectionItemKind: itemKind,
      countMode: "open-ended",
      fieldLabels: {
        collection: itemKind === "video"
          ? "Video Clips"
          : itemKind === "audio"
            ? "Audio Clips"
            : "Input Collection",
      },
      fieldHelpText: {
        collection: toFieldHelpText(
          itemKind === "video"
            ? "Video Clips"
            : itemKind === "audio"
              ? "Audio Clips"
              : "Input Collection",
          itemKind === "video"
            ? "the video clips"
            : itemKind === "audio"
              ? "the audio clips"
              : "the uploaded items",
        ),
      },
    });
  }

  return operations;
}

function inferDomain(text: string): CompilerIntent["domain"] {
  if (/\btranscript\b|\btranscribe\b|\bspeech to text\b|\bspeech-to-text\b|\bcaption\b/.test(text)) {
    return "text";
  }
  const videoCue = /\bvideos?\b|\bclip\b|\banimation\b|\banimate\b|\bmovies?\b|\blip ?sync\b|\breel\b/.test(text)
    || (/\bvoiceover\b/.test(text) && /\bvideo\b|\bclip\b|\breel\b|\blip ?sync\b/.test(text));
  if (/\baudio\b|\bvoiceover audio\b|\bspoken audio\b|\bnarration\b|\btts\b|\btext to speech\b|\bread aloud\b/.test(text) && !videoCue) {
    return "audio";
  }
  if (videoCue) {
    return "video";
  }
  if (
    /\bimages?\b|\bphotos?\b|\bpictures?\b|\bportrait\b|\bart\b|\billustration\b|\bicon\b|\blogo\b|\binpaint\b|\bmask(?:ed)?\b|\bstyle transfer\b|\bcomposite\b|\blocation references?\b|\breference images?\b/.test(text)
    || (/\bscene\b|\bscenes\b/.test(text) && /\bgenerate(?:s|d|ing)?\b|\bcreate(?:s|d|ing)?\b|\bmake(?:s|ing)?\b|\bproduce(?:s|d|ing)?\b|\bgenerator\b/.test(text))
  ) {
    return "image";
  }
  return "unknown";
}

function hasAdSceneIntent(text: string): boolean {
  return /\bad\b|\bcampaign\b|\bproduct scenes?\b|\bscene generator\b/.test(text)
    && /\bscene\b|\bscenes\b/.test(text)
    && /\bbag\b|\bproduct\b|\bbrand\b/.test(text);
}

function hasBrandToneCue(text: string): boolean {
  return /\bluxury\b|\bplayful\b|\bminimal(?:ist)?\b|\bpremium\b|\bbold\b|\belegant\b|\beditorial\b|\bstreetwear\b|\bsporty\b|\bwhimsical\b|\bmoody\b|\bbright\b|\bclean\b|\bgritty\b|\bmodern\b|\bvintage\b|\bfor\s+\w+/.test(text);
}

function hasSceneGenerationCue(text: string): boolean {
  return (
    /\bgenerate(?:s|d|ing)?\b.*\bscenes?\b/.test(text)
    || /\bcreate(?:s|d|ing)?\b.*\bscenes?\b/.test(text)
    || /\bmake(?:s|ing)?\b.*\bscenes?\b/.test(text)
    || /\bproduce(?:s|d|ing)?\b.*\bscenes?\b/.test(text)
    || /\bgenerate(?:s|d|ing)?\b.*\bscene\b.*\bfor\b/.test(text)
    || /\bcreate(?:s|d|ing)?\b.*\bscene\b.*\bfor\b/.test(text)
    || /\bmake(?:s|ing)?\b.*\bscene\b.*\bfor\b/.test(text)
    || /\bproduce(?:s|d|ing)?\b.*\bscene\b.*\bfor\b/.test(text)
    || /\bscene\b.*\bfor each\b/.test(text)
    || /\bscene\b.*\bper\b/.test(text)
    || /\bscene\b.*\beach\b/.test(text)
    || /\baround it\b/.test(text)
    || /\baround the character\b/.test(text)
    || /\baround the uploaded image\b/.test(text)
    || /\bbackground\b/.test(text)
  );
}

function hasExplicitGenerativeContentCue(text: string): boolean {
  return (
    /\bgenerate(?:s|d|ing)?\b.*\b(?:scene|scenes|image|images|video|videos|content)\b/.test(text)
    || /\bcreate(?:s|d|ing)?\b.*\b(?:scene|scenes|image|images|video|videos|content)\b/.test(text)
    || /\bmake(?:s|ing)?\b.*\b(?:scene|scenes|image|images|video|videos|content)\b/.test(text)
    || /\bproduce(?:s|d|ing)?\b.*\b(?:scene|scenes|image|images|video|videos|content)\b/.test(text)
  );
}

function hasReelAssemblyCue(text: string): boolean {
  return (
    /\bassemble\b.*\breel\b/.test(text)
    || /\bassemble\b.*\btimeline\b/.test(text)
    || /\bsingle reel\b/.test(text)
    || /\bsingle output reel\b/.test(text)
    || /\boutput reel\b/.test(text)
    || /\bproduce\b.*\b(?:single\s+)?reel\b/.test(text)
    || /\bcreate\b.*\b(?:single\s+)?reel\b/.test(text)
    || /\bmake\b.*\b(?:single\s+)?reel\b/.test(text)
    || /\breel\b/.test(text) && /\boutput\b/.test(text)
    || /\btimeline\b/.test(text)
  );
}

function shouldSortBefore(otherKind: CompilerOperation["kind"], currentKind: CompilerOperation["kind"]): boolean {
  return currentKind === "enhance-prompt"
    && [
      "edit-image",
      "reference-image-edit",
      "multi-image-compose",
      "style-transfer-edit",
      "mask-from-text",
      "inpaint-image",
      "generate-image",
      "compare-generate-image",
      "generate-video",
      "compare-generate-video",
      "image-to-video",
      "voiceover-video",
    ].includes(otherKind);
}

function isCompareIntent(text: string): boolean {
  return /\bcompare\b|\bcomparison\b|\bversus\b|\bvs\b|side by side|same prompt.*different models|different models|multiple models|two models/.test(text);
}

function buildTransformOperations(text: string, domain: CompilerIntent["domain"]): CompilerOperation[] {
  const candidates: Array<{ index: number; operation: CompilerOperation }> = [];
  const mentionsPrompt = /\bprompt\b|text prompt|type a prompt|from a prompt|using a prompt|same prompt/.test(text);
  const mentionsUpload = /\bupload(?:ed|ing)?\b|\bimport(?:ed|ing)?\b|\bdrop\b/.test(text);
  const compareIntent = isCompareIntent(text) && !mentionsUpload;
  const requestedCount = extractRequestedCount(text) || (compareIntent ? 2 : null);
  const modelHints = extractModelHints(text);

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

  const multiImageComposeIntent = /blend|combine|merge|composite/.test(text)
    && /\b(?:two|multiple|several)\s+images?\b|\banother image\b|\bsecond image\b/.test(text);
  const styleTransferIntent = /\bstyle transfer\b|transfer .* style|style reference|style image|content image/.test(text);
  const inpaintIntent = /\binpaint\b|\bmasked edit\b|\bmask\b|remove .* from .*image|replace .* in .*image/.test(text);
  const regionMaskIntent = inpaintIntent && /\bregion\b|\barea\b|\bmask by text\b|\bdescribe\b|\btag\b/.test(text);
  const referenceEditIntent = /reference image|reference photo|reference picture|style reference|style image|another image|second image|two images/.test(text)
    && !styleTransferIntent
    && !multiImageComposeIntent;

  if (multiImageComposeIntent) {
    const composeIndex = findMatchIndex(text, [/\bblend(?:s|ed|ing)?\b/, /\bcombin(?:e|es|ed|ing)\b/, /\bmerge(?:s|d|ing)?\b/, /\bcomposite(?:s|d|ing)?\b/]);
    candidates.push({
      index: Number.isFinite(composeIndex) ? composeIndex : 0,
      operation: {
        kind: "multi-image-compose",
        summary: "Blend or composite multiple uploaded images using a prompt.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: true,
        requestedFormat: null,
        manualInputKinds: ["image"],
        fieldLabels: {
          input_image_1: "Source Image 1",
          input_image_2: "Source Image 2",
          prompt: "Composition Prompt",
        },
        fieldHelpText: {
          input_image_1: "Upload the first image to composite.",
          input_image_2: "Upload the second image to composite.",
          prompt: "Describe how the uploaded images should be blended or composed together.",
        },
      },
    });
  }

  if (styleTransferIntent) {
    const styleTransferIndex = findMatchIndex(text, [/\bstyle transfer\b/, /transfer .* style/, /style reference/, /style image/]);
    candidates.push({
      index: Number.isFinite(styleTransferIndex) ? styleTransferIndex : 0,
      operation: {
        kind: "style-transfer-edit",
        summary: "Apply the style of a reference image to a content image using a prompt.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: true,
        requestedFormat: null,
        manualInputKinds: ["image"],
        fieldLabels: {
          input_image_1: "Content Image",
          input_image_2: "Style Reference Image",
          prompt: "Style Transfer Prompt",
        },
        fieldHelpText: {
          input_image_1: "Upload the content image that should be transformed.",
          input_image_2: "Upload the style reference image that should guide the look.",
          prompt: "Describe how the content image should be restyled.",
        },
      },
    });
  }

  if (regionMaskIntent) {
    const maskIndex = findMatchIndex(text, [/\bmask by text\b/, /\bregion\b/, /\barea\b/, /\bdescribe\b/]);
    candidates.push({
      index: Number.isFinite(maskIndex) ? maskIndex : 0,
      operation: {
        kind: "mask-from-text",
        summary: "Generate a mask from a text description of the image region to edit.",
        inputKind: "image",
        outputKind: "mask",
        requiresUserInput: true,
        requestedFormat: null,
        fieldLabels: {
          text_prompt: "Region Description",
        },
        fieldHelpText: {
          text_prompt: "Describe the part of the image that should be edited.",
        },
      },
    });
  }

  if (inpaintIntent) {
    const inpaintIndex = findMatchIndex(text, [/\binpaint\b/, /\bmask(?:ed)?\b/, /remove .* from .*image/, /replace .* in .*image/]);
    const inpaintFieldLabels = regionMaskIntent
      ? { prompt: "Inpaint Prompt" }
      : {
          image: "Image to Edit",
          mask: "Mask Image",
          prompt: "Inpaint Prompt",
        };
    const inpaintFieldHelpText = regionMaskIntent
      ? { prompt: "Describe the change that should be applied inside the masked region." }
      : {
          image: "Upload the image that should be edited.",
          mask: "Upload a mask image for the region to replace.",
          prompt: "Describe the change that should be applied inside the mask.",
        };
    candidates.push({
      index: Number.isFinite(inpaintIndex) ? inpaintIndex : 0,
      operation: {
        kind: "inpaint-image",
        summary: regionMaskIntent
          ? "Edit part of an image using a generated mask and a prompt."
          : "Edit part of an image using an uploaded mask and a prompt.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: true,
        requestedFormat: null,
        manualInputKinds: regionMaskIntent ? [] : ["image"],
        fieldLabels: inpaintFieldLabels,
        fieldHelpText: inpaintFieldHelpText,
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
    /\bblend(?:s|ed|ing)?\b/,
    /\bcombin(?:e|es|ed|ing)\b/,
    /\bmerge(?:s|d|ing)?\b/,
    /\bcomposite(?:s|d|ing)?\b/,
    /remove background/,
    /erase/,
    /replace/,
  ]);
  const imageEditContext = domain === "image" || /\bimage\b|\bphoto\b|\bpicture\b|\bportrait\b|\bart\b|\billustration\b|\blogo\b/.test(text);
  if (Number.isFinite(editIndex) && imageEditContext && !multiImageComposeIntent && !styleTransferIntent && !inpaintIntent) {
    candidates.push({
      index: editIndex,
      operation: {
        kind: referenceEditIntent ? "reference-image-edit" : "edit-image",
        summary: referenceEditIntent
          ? "Apply prompt-guided edits to the image using a reference image."
          : "Apply prompt-guided edits to the image.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: true,
        requestedFormat: null,
      },
    });
  }

  const sceneEditIntent = mentionsUpload
    && hasSceneGenerationCue(text)
    && /\bgenerate(?:s|d|ing)?\b|\bcreate(?:s|d|ing)?\b|\bmake(?:s|ing)?\b|\bproduce(?:s|d|ing)?\b/.test(text);
  if (sceneEditIntent) {
    const sceneEditIndex = findMatchIndex(text, [
      /\bgenerate(?:s|d|ing)?\b.*\bscenes?\b/,
      /\bcreate(?:s|d|ing)?\b.*\bscenes?\b/,
      /\bscene\b.*\bfor each\b/,
      /\bscene\b.*\bper\b/,
      /\bscene\b/,
      /\bbackground\b/,
      /\baround it\b/,
      /\baround the character\b/,
    ]);
    candidates.push({
      index: Number.isFinite(sceneEditIndex) ? sceneEditIndex : 0,
      operation: {
        kind: "edit-image",
        summary: "Generate a scene around the uploaded source image.",
        inputKind: "image",
        outputKind: "image",
        requiresUserInput: true,
        requestedFormat: null,
        fieldLabels: {
          prompt: "Scene Prompt",
        },
        fieldHelpText: {
          prompt: "Describe the scene that should be generated around the uploaded image.",
        },
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
    /\b(?:scene|scenes|image|images|video|videos|ad)\s+generator\b/,
  ]);
  const imageToVideoIntent = /\bimage to video\b|\banimate\b|\banimation\b|\bturn .* into .*video\b|\bmake .* move\b/.test(text);
  const needsIntermediateImageGeneration = imageToVideoIntent
    && !mentionsUpload
    && (mentionsPrompt || /\bimage\b|\bscene\b/.test(text));
  const uploadDrivenGenerationIntent = mentionsUpload && hasExplicitGenerativeContentCue(text);
  const pureUploadTransformIntent = mentionsUpload && !uploadDrivenGenerationIntent;
  const allowGenericPromptGeneration = !pureUploadTransformIntent && !sceneEditIntent;
  if (allowGenericPromptGeneration && (Number.isFinite(generateIndex) || mentionsPrompt)) {
    if (domain === "image" || needsIntermediateImageGeneration) {
      candidates.push({
        index: Number.isFinite(generateIndex) ? generateIndex : 0,
        operation: {
          kind: compareIntent ? "compare-generate-image" : "generate-image",
          summary: compareIntent
            ? "Generate images from the same prompt with multiple models for comparison."
            : "Generate an image from a text prompt.",
          inputKind: "text",
          outputKind: "image",
          requiresUserInput: true,
          requestedFormat: null,
          branchCount: compareIntent ? requestedCount || 2 : undefined,
          modelHints,
        },
      });
    }
    if (domain === "video" && !needsIntermediateImageGeneration) {
      candidates.push({
        index: Number.isFinite(generateIndex) ? generateIndex : 0,
        operation: {
          kind: compareIntent ? "compare-generate-video" : "generate-video",
          summary: compareIntent
            ? "Generate videos from the same prompt with multiple models for comparison."
            : "Generate a video from a text prompt.",
          inputKind: "text",
          outputKind: "video",
          requiresUserInput: true,
          requestedFormat: null,
          branchCount: compareIntent ? requestedCount || 2 : undefined,
          modelHints,
        },
      });
    }
  }

  if (imageToVideoIntent) {
    const imageToVideoIndex = findMatchIndex(text, [/\bimage to video\b/, /\banimate\b/, /\banimation\b/, /turn .* into .*video/]);
    candidates.push({
      index: Number.isFinite(imageToVideoIndex) ? imageToVideoIndex : 0,
      operation: {
        kind: "image-to-video",
        summary: "Animate an image into a video clip.",
        inputKind: "image",
        outputKind: "video",
        requiresUserInput: true,
        requestedFormat: null,
        modelHints,
      },
    });
  }

  const scriptVoiceoverIntent = /\bvoiceover\b|\badd voice\b|\badd narration\b|\bnarration\b/.test(text)
    && /\bscript\b/.test(text)
    && /\bvideo\b|\bclip\b|\breel\b|\btimeline\b|\bscene\b/.test(text)
    && !/\blip ?sync\b/.test(text);
  if (scriptVoiceoverIntent) {
    const voiceoverAudioIndex = findMatchIndex(text, [/\bvoiceover\b/, /\badd voice\b/, /\badd narration\b/, /\bnarration\b/]);
    candidates.push({
      index: Number.isFinite(voiceoverAudioIndex) ? voiceoverAudioIndex : 0,
      operation: {
        kind: "text-to-speech",
        summary: "Generate a spoken audio clip from a script.",
        inputKind: "text",
        outputKind: "audio",
        requiresUserInput: true,
        requestedFormat: null,
        fieldLabels: {
          prompt: "Script",
        },
        fieldHelpText: {
          prompt: "Enter the script that should be spoken in the generated audio.",
        },
      },
    });
    candidates.push({
      index: Number.isFinite(voiceoverAudioIndex) ? voiceoverAudioIndex + 1 : 1,
      operation: {
        kind: "merge-audio-video",
        summary: "Merge an audio track into a video output.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const voiceoverIntent = /\blip ?sync\b|\bvoiceover video\b|\badd voice directly to video\b/.test(text)
    && /\bvideo\b|\bclip\b|\breel\b|\blip ?sync\b|\banimat(?:e|ion)\b/.test(text);
  if (voiceoverIntent) {
    const voiceoverIndex = findMatchIndex(text, [/\blip ?sync\b/, /\bvoiceover video\b/, /\badd voice directly to video\b/]);
    candidates.push({
      index: Number.isFinite(voiceoverIndex) ? voiceoverIndex : 0,
      operation: {
        kind: "voiceover-video",
        summary: "Add script-driven voiceover to a video.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: true,
        requestedFormat: null,
        fieldLabels: {
          text: "Script",
        },
        fieldHelpText: {
          text: "Enter the script text that should drive the narration or lip sync.",
        },
        modelHints,
      },
    });
  }

  const videoConcatIntent = !hasReelAssemblyCue(text)
    && /\bconcatenate\b|\bcontinuous reel\b|\bvideo reel\b|\bmerge the scenes\b|\bcombine the scenes\b|\bproduce\b.*\breel\b|\bcreate\b.*\breel\b|\boutput reel\b|\bsingle output reel\b|\bsingle reel\b/.test(text);
  if (videoConcatIntent && /\bscenes?\b|\bvideos?\b|\breel\b/.test(text)) {
    const videoConcatIndex = findMatchIndex(text, [/\bconcatenate\b/, /\bcontinuous reel\b/, /\bvideo reel\b/, /\bmerge the scenes\b/, /\bcombine the scenes\b/]);
    candidates.push({
      index: Number.isFinite(videoConcatIndex) ? videoConcatIndex : 0,
      operation: {
        kind: "video-concat",
        summary: "Combine multiple video clips into one continuous reel.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
        branchCount: Math.max(2, requestedCount || 2),
      },
    });
  }

  const generateAudioIntent = domain === "audio"
    && !mentionsUpload
    && (Number.isFinite(generateIndex) || mentionsPrompt || /\bvoiceover audio\b|\bspoken audio\b|\btext to speech\b|\btts\b|\bread aloud\b/.test(text));
  const textToSpeechIntent = generateAudioIntent
    && /\bscript\b|\bvoiceover\b|\bnarration\b|\bspoken\b|\btext to speech\b|\btts\b|\bread aloud\b/.test(text);
  if (generateAudioIntent) {
    const audioIndex = findMatchIndex(text, [/\bvoiceover\b/, /\bnarration\b/, /\bspoken\b/, /\btext to speech\b/, /\btts\b/, /\baudio\b/]);
    candidates.push({
      index: Number.isFinite(audioIndex) ? audioIndex : 0,
      operation: {
        kind: textToSpeechIntent ? "text-to-speech" : "generate-audio",
        summary: textToSpeechIntent
          ? "Generate a spoken audio clip from a script."
          : "Generate an audio clip from a text prompt.",
        inputKind: "text",
        outputKind: "audio",
        requiresUserInput: true,
        requestedFormat: null,
        fieldLabels: {
          prompt: textToSpeechIntent ? "Script" : "Audio Prompt",
        },
        fieldHelpText: {
          prompt: textToSpeechIntent
            ? "Enter the script that should be spoken in the generated audio."
            : "Describe the audio that should be generated.",
        },
      },
    });
  }

  const speechToTextIntent = /\bspeech to text\b|\bspeech-to-text\b/.test(text)
    || (/\btranscrib(?:e|ed|ing)\b/.test(text) && /\baudio\b|\bspeech\b|\bvoice\b/.test(text));
  if (speechToTextIntent) {
    const sttIndex = findMatchIndex(text, [/\btranscribe\b/, /\btranscript\b/, /\bspeech to text\b/, /\bspeech-to-text\b/]);
    candidates.push({
      index: Number.isFinite(sttIndex) ? sttIndex : 0,
      operation: {
        kind: "speech-to-text",
        summary: "Extract transcript text from uploaded audio or video.",
        inputKind: "audio",
        outputKind: "text",
        requiresUserInput: true,
        requestedFormat: null,
      },
    });
  }

  const audioConcatIntent = /\bconcatenate audio\b|\bjoin audio\b|\bcombine audio clips sequentially\b|\bsequence audio clips\b/.test(text);
  if (audioConcatIntent) {
    const audioConcatIndex = findMatchIndex(text, [/\bconcatenate audio\b/, /\bjoin audio\b/, /\bsequence audio clips\b/]);
    candidates.push({
      index: Number.isFinite(audioConcatIndex) ? audioConcatIndex : 0,
      operation: {
        kind: "audio-concat",
        summary: "Combine multiple audio clips sequentially into one track.",
        inputKind: "audio",
        outputKind: "audio",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const audioMixIntent = /\bmix audio\b|\blayer audio\b|\bcombine audio tracks\b|\bmix narration with music\b/.test(text);
  if (audioMixIntent) {
    const audioMixIndex = findMatchIndex(text, [/\bmix audio\b/, /\blayer audio\b/, /\bcombine audio tracks\b/]);
    candidates.push({
      index: Number.isFinite(audioMixIndex) ? audioMixIndex : 0,
      operation: {
        kind: "audio-mix",
        summary: "Layer multiple audio tracks into one mixed result.",
        inputKind: "audio",
        outputKind: "audio",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const mergeAudioVideoIntent = /\bmerge audio and video\b|\badd audio to video\b|\bembed audio in video\b|\bcombine audio with video\b/.test(text);
  if (mergeAudioVideoIntent) {
    const mergeAudioVideoIndex = findMatchIndex(text, [/\bmerge audio and video\b/, /\badd audio to video\b/, /\bcombine audio with video\b/]);
    candidates.push({
      index: Number.isFinite(mergeAudioVideoIndex) ? mergeAudioVideoIndex : 0,
      operation: {
        kind: "merge-audio-video",
        summary: "Merge an audio track into a video output.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const timelineAssembleIntent = hasReelAssemblyCue(text);
  if (timelineAssembleIntent && /\bclips?\b|\bscenes?\b|\bvideos?\b/.test(text)) {
    const timelineAssembleIndex = findMatchIndex(text, [
      /\bassemble\b.*\breel\b/,
      /\bassemble\b.*\btimeline\b/,
      /\bsingle output reel\b/,
      /\boutput reel\b/,
      /\bproduce\b.*\b(?:single\s+)?reel\b/,
      /\bcreate\b.*\b(?:single\s+)?reel\b/,
      /\bmake\b.*\b(?:single\s+)?reel\b/,
      /\bsingle reel\b/,
      /\btimeline\b/,
    ]);
    candidates.push({
      index: Number.isFinite(timelineAssembleIndex) ? timelineAssembleIndex : 0,
      operation: {
        kind: "timeline-assemble",
        summary: "Assemble an ordered sequence of clips into a single reel.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
        branchCount: Math.max(2, requestedCount || 2),
        mergeStrategy: "ordered-sequence",
      },
    });
  }

  const trimVideoIntent = /\btrim\b|\bclip to\b|\bcut to\b/.test(text);
  if (trimVideoIntent && /\bvideo\b|\bclip\b/.test(text)) {
    const trimVideoIndex = findMatchIndex(text, [/\btrim\b/, /\bclip to\b/, /\bcut to\b/]);
    candidates.push({
      index: Number.isFinite(trimVideoIndex) ? trimVideoIndex : 0,
      operation: {
        kind: "trim-video",
        summary: "Trim a video clip to a requested segment or duration.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const timelineOverlayIntent = /\boverlay\b|\bplace .* over\b|\bpicture in picture\b/.test(text);
  if (timelineOverlayIntent) {
    const timelineOverlayIndex = findMatchIndex(text, [/\boverlay\b/, /\bplace .* over\b/, /\bpicture in picture\b/]);
    candidates.push({
      index: Number.isFinite(timelineOverlayIndex) ? timelineOverlayIndex : 0,
      operation: {
        kind: "timeline-overlay",
        summary: "Overlay one timed track over another in a composed timeline.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const transitionIntent = /\btransitions?\b|\btransition effect\b|\btransition between clips\b/.test(text);
  if (transitionIntent) {
    const transitionIndex = findMatchIndex(text, [/\btransitions?\b/, /\btransition effect\b/, /\btransition between clips\b/]);
    candidates.push({
      index: Number.isFinite(transitionIndex) ? transitionIndex : 0,
      operation: {
        kind: "timeline-transition",
        summary: "Insert transition effects between timeline clips.",
        inputKind: "video",
        outputKind: "video",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  if (hasOpenEndedPluralCue(text) && /\bfor each\b|\beach one\b|\beach character\b|\beach location\b/.test(text)) {
    const mapIndex = findMatchIndex(text, [/\bfor each\b/, /\beach one\b/, /\beach character\b/, /\beach location\b/]);
    candidates.push({
      index: Number.isFinite(mapIndex) ? mapIndex : 0,
      operation: {
        kind: /\bin sequence\b|\bsequentially\b/.test(text) ? "foreach" : "map",
        summary: "Apply the requested transformation to each item in the uploaded collection.",
        inputKind: "array",
        outputKind: "array",
        requiresUserInput: false,
        requestedFormat: null,
        itemInputKind: inferCollectionItemKind(text),
        itemOutputKind: domain === "video" ? "video" : "image",
        countMode: "open-ended",
      },
    });
  }

  if (/\bfan out\b|\bparallel branches\b/.test(text)) {
    const fanoutIndex = findMatchIndex(text, [/\bfan out\b/, /\bparallel branches\b/]);
    candidates.push({
      index: Number.isFinite(fanoutIndex) ? fanoutIndex : 0,
      operation: {
        kind: "fanout",
        summary: "Fan out a collection into parallel item-level branches.",
        inputKind: "array",
        outputKind: "array",
        requiresUserInput: false,
        requestedFormat: null,
        itemInputKind: inferCollectionItemKind(text),
        itemOutputKind: inferCollectionItemKind(text),
        countMode: "open-ended",
      },
    });
  }

  if (/\bcollect\b|\bgather\b.*\binto\b.*\bcollection\b/.test(text)) {
    const faninIndex = findMatchIndex(text, [/\bcollect\b/, /\bgather\b/]);
    candidates.push({
      index: Number.isFinite(faninIndex) ? faninIndex : 0,
      operation: {
        kind: "fanin",
        summary: "Collect multiple branch outputs into one collection.",
        inputKind: domain === "video" ? "video" : "image",
        outputKind: "array",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  if (/\breduce\b|\bmerge strategy\b|\bcombine .* into a single\b/.test(text)) {
    const reduceIndex = findMatchIndex(text, [/\breduce\b/, /\bmerge strategy\b/, /\bcombine .* into a single\b/]);
    candidates.push({
      index: Number.isFinite(reduceIndex) ? reduceIndex : 0,
      operation: {
        kind: "reduce",
        summary: "Reduce a collection into a single merged result.",
        inputKind: "array",
        outputKind: domain === "video" ? "video" : domain === "audio" ? "audio" : "image",
        requiresUserInput: false,
        requestedFormat: null,
        mergeStrategy: "single-output",
      },
    });
  }

  const captionExtractIntent = /\bcaption\b|\bdescribe the image\b|\bdescribe the video\b/.test(text);
  if (captionExtractIntent) {
    const captionExtractIndex = findMatchIndex(text, [/\bcaption\b/, /\bdescribe the image\b/, /\bdescribe the video\b/]);
    candidates.push({
      index: Number.isFinite(captionExtractIndex) ? captionExtractIndex : 0,
      operation: {
        kind: "caption-extract",
        summary: "Extract a descriptive caption from an image or video input.",
        inputKind: /video/.test(text) ? "video" : "image",
        outputKind: "text",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const transcriptExtractIntent = !speechToTextIntent && /\btranscript\b|\bextract transcript\b|\btranscrib(?:e|ed|ing)\b/.test(text);
  if (transcriptExtractIntent) {
    const transcriptExtractIndex = findMatchIndex(text, [/\btranscript\b/, /\bextract transcript\b/]);
    candidates.push({
      index: Number.isFinite(transcriptExtractIndex) ? transcriptExtractIndex : 0,
      operation: {
        kind: "transcript-extract",
        summary: "Extract transcript-like text from audio or video input.",
        inputKind: /video/.test(text) ? "video" : "audio",
        outputKind: "text",
        requiresUserInput: false,
        requestedFormat: null,
      },
    });
  }

  const sceneDetectIntent = /\bscene detect\b|\bscene detection\b|\bdetect scenes\b/.test(text);
  if (sceneDetectIntent) {
    const sceneDetectIndex = findMatchIndex(text, [/\bscene detect\b/, /\bscene detection\b/, /\bdetect scenes\b/]);
    candidates.push({
      index: Number.isFinite(sceneDetectIndex) ? sceneDetectIndex : 0,
      operation: {
        kind: "scene-detect",
        summary: "Detect scene boundaries and timestamps in a video.",
        inputKind: "video",
        outputKind: "array",
        requiresUserInput: false,
        requestedFormat: null,
        itemOutputKind: "object",
      },
    });
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
  const requestedCount = extractRequestedCount(text);
  const collectionInputOperations = buildCollectionInputOperations(text);
  const explicitUploadCount = requestedCount && /upload/.test(text) && !hasOpenEndedPluralCue(text) ? requestedCount : null;
  const episodeReelIntent = /\bcharacter images?\b|\bcharacters\b/.test(text)
    && /\bscript\b/.test(text)
    && hasSceneGenerationCue(text)
    && hasReelAssemblyCue(text)
    && !/\btagged set\b|\btagged location\b|\btagged character\b/.test(text);
  const promptVariables = [
    ...extractPromptVariables(userRequest),
    ...(episodeReelIntent && /\blocation references?\b|\blocations?\b/.test(text)
      ? [{ key: "location_tags", label: "Location Tags" }]
      : []),
  ].filter((entry, index, list) => list.findIndex((candidate) => candidate.key === entry.key) === index);
  const unfilteredTransformOperations = buildTransformOperations(text, domain);
  const collectionItemKinds = new Set(
    collectionInputOperations
      .map((operation) => operation.collectionItemKind)
      .filter((kind): kind is NonNullable<CompilerOperation["collectionItemKind"]> => kind != null),
  );
  const hasCollectionIteration = unfilteredTransformOperations.some((operation) =>
    ["fanout", "fanin", "foreach", "map", "reduce"].includes(operation.kind),
  );
  const hasIteratorBackedCollectionKinds = collectionItemKinds.size > 0
    && [...collectionItemKinds].every((kind) => ["image", "text", "video"].includes(kind));
  const transformOperations = hasCollectionIteration && collectionItemKinds.size > 0
    ? (
      hasIteratorBackedCollectionKinds
        ? reorderIteratorBackedTransforms(unfilteredTransformOperations, collectionItemKinds)
        : unfilteredTransformOperations.filter((operation) => {
      if (["fanout", "fanin", "foreach", "map", "reduce"].includes(operation.kind)) {
        return true;
      }
      return !usesCollectionItemKind(operation, collectionItemKinds);
    })
    )
    : unfilteredTransformOperations;
  const hasExport = /export|download|save/.test(text);
  const hasWorkflowIntent = /\bapp\b|\bworkflow\b|\bflow\b|\bpipeline\b|design app|tool/.test(text) || transformOperations.length > 0;
  const wantsParallelImageAndVideoOutputs = transformOperations.some((operation) => operation.kind === "image-to-video")
    && transformOperations.some((operation) => ["edit-image", "reference-image-edit", "multi-image-compose", "style-transfer-edit", "inpaint-image", "generate-image", "compare-generate-image"].includes(operation.kind))
    && /\bboth\b|\balso\b|\bsimultaneous(?:ly)?\b|\bparallel\b|\beach with (?:its|their) own output\b/.test(text);
  const hasCollectionInputs = collectionInputOperations.length > 0;
  const hasManualImageInputs = transformOperations.some((operation) => (operation.manualInputKinds || []).includes("image"));
  const directMediaInputKind = transformOperations.find((operation) =>
    operation.inputKind != null
    && ["image", "video", "audio"].includes(operation.inputKind)
  )?.inputKind || null;
  const hasUserUpload = !hasCollectionInputs
    && !hasManualImageInputs
    && !directMediaInputKind
    && /\bupload(?:ed|ing)?\b|\bimport(?:ed|ing)?\b|\bdrop\b/.test(text);
  const needsPromptSource = promptVariables.length === 0
    && transformOperations.some((operation) => operation.kind === "compare-generate-image" || operation.kind === "compare-generate-video");
  const needsScenePromptSource = episodeReelIntent;
  const needsPromptCompose = requiresPromptComposition(text, promptVariables)
    || (needsScenePromptSource && promptVariables.length > 0);
  const promptPrimitives: CompilerPromptPrimitive[] = [];

  operations.push(...collectionInputOperations);

  if (hasUserUpload) {
    operations.push({
      kind: "upload",
      summary: domain === "video"
        ? "Allow the user to upload video files."
        : domain === "audio"
          ? "Allow the user to upload audio files."
          : "Allow the user to upload image files.",
      inputKind: null,
      outputKind: "file",
      requiresUserInput: true,
      requestedFormat: null,
      branchCount: explicitUploadCount || undefined,
      countMode: explicitUploadCount ? "explicit" : undefined,
    });
  }

  for (const promptVariable of promptVariables) {
    operations.push({
      kind: "prompt-variable",
      summary: `Capture the ${promptVariable.label.toLowerCase()} prompt variable.`,
      inputKind: null,
      outputKind: "text",
      requiresUserInput: true,
      requestedFormat: null,
      promptKey: promptVariable.key,
      promptLabel: promptVariable.label,
    });
    promptPrimitives.push({
      kind: "prompt-variable",
      key: promptVariable.key,
      label: promptVariable.label,
    });
  }

  if (needsPromptSource) {
    operations.push({
      kind: "prompt-source",
      summary: "Provide a shared prompt source for downstream branches.",
      inputKind: null,
      outputKind: "text",
      requiresUserInput: true,
      requestedFormat: null,
      promptKey: "prompt",
      promptLabel: "Prompt",
    });
    promptPrimitives.push({
      kind: "prompt-source",
      key: "prompt",
      label: "Prompt",
    });
  }

  if (needsScenePromptSource) {
    operations.push({
      kind: "prompt-source",
      summary: "Provide a reusable scene prompt for the generated reel scenes.",
      inputKind: null,
      outputKind: "text",
      requiresUserInput: true,
      requestedFormat: null,
      promptKey: "scene_prompt",
      promptLabel: "Scene Prompt",
    });
    promptPrimitives.push({
      kind: "prompt-source",
      key: "scene_prompt",
      label: "Scene Prompt",
    });
  }

  if (needsPromptCompose) {
    const composedPromptInputs = needsScenePromptSource
      ? ["scene_prompt", ...promptVariables.map((variable) => variable.key)]
      : promptVariables.map((variable) => variable.key);
    operations.push({
      kind: "prompt-compose",
      summary: "Compose the named prompt variables into a single prompt string.",
      inputKind: "text",
      outputKind: "text",
      requiresUserInput: false,
      requestedFormat: null,
      promptKey: "composed_prompt",
      promptInputs: composedPromptInputs,
    });
    promptPrimitives.push({
      kind: "prompt-compose",
      key: "composed_prompt",
      inputs: composedPromptInputs,
    });
  }

  operations.push(...transformOperations);

  const finalTransformOperation = [...transformOperations]
    .reverse()
    .find((operation) => operation.outputKind != null);
  const finalCollectionOperation = [...collectionInputOperations]
    .reverse()
    .find((operation) => operation.outputKind != null);
  const finalOutputKind = finalTransformOperation?.outputKind
    || finalCollectionOperation?.outputKind
    || (domain === "video"
      ? "video"
      : domain === "audio"
        ? "audio"
        : domain === "text"
          ? "text"
          : hasWorkflowIntent
            ? "image"
            : "unknown");

  if (hasExport) {
    const exportTarget = finalOutputKind === "text" ? "text result" : finalOutputKind === "array" ? "collection" : finalOutputKind;
    operations.push({
      kind: "export",
      summary: format
        ? `Export the resulting ${exportTarget} as ${format.toUpperCase()}.`
        : /user-specified|specified format|chosen format/.test(text)
          ? `Export the resulting ${exportTarget} in a user-specified format.`
          : `Export the resulting ${exportTarget}.`,
      inputKind: finalOutputKind,
      outputKind: "file",
      requiresUserInput: !format,
      requestedFormat: format,
    });
  } else if (hasWorkflowIntent && domain !== "unknown") {
    operations.push({
      kind: "output-result",
      summary: `Expose the resulting ${finalOutputKind === "array" ? "collection" : finalOutputKind} in the app output.`,
      inputKind: finalOutputKind,
      outputKind: null,
      requiresUserInput: false,
      requestedFormat: null,
    });
    if (wantsParallelImageAndVideoOutputs) {
      operations.push({
        kind: "output-result",
        summary: "Expose the intermediate image result in the app output.",
        inputKind: "image",
        outputKind: null,
        requiresUserInput: false,
        requestedFormat: null,
      });
    }
  }

  const ambiguities: CompilerIntent["ambiguities"] = [];
  if (domain === "unknown") {
    ambiguities.push({
      code: "missing-supported-domain",
      message: "The request does not clearly describe a supported image, video, audio, or text workflow.",
    });
  }
  if (transformOperations.length === 0) {
    ambiguities.push({
      code: "missing-transform-operation",
      message: "The request does not clearly specify a supported generation or transform operation.",
    });
  }
  if (hasAdSceneIntent(text) && !hasBrandToneCue(text)) {
    ambiguities.push({
      code: "missing_brand_tone",
      message: "Brand tone changes prompt wording and scene framing for ad-generation requests.",
    });
  }
  if (/\bedit\b|\bremix\b/.test(text) && inputSourceKind === "prompt") {
    ambiguities.push({
      code: "missing_reference_asset",
      message: "Reference-driven edit flows require a source asset.",
    });
  }

  const requiresReferenceImage = /reference image|reference photo|reference picture|style reference|style image|another image|second image|two images|blend|combine|merge|composite/.test(text)
    && !isCompareIntent(text);

  const requiredFields: string[] = [];
  if (hasUserUpload) requiredFields.push("file_upload");
  requiredFields.push(
    ...collectionInputOperations.map((operation) =>
      normalizePromptKey(operation.fieldLabels?.collection || operation.summary),
    ),
  );
  requiredFields.push(...promptVariables.map((variable) => variable.key));
  if (needsPromptSource) requiredFields.push("prompt");
  if (needsScenePromptSource) requiredFields.push("scene_prompt");
  if (transformOperations.some((operation) => ["edit-image", "reference-image-edit", "multi-image-compose", "style-transfer-edit", "inpaint-image"].includes(operation.kind))) requiredFields.push("edit_prompt");
  if (
    promptVariables.length === 0
    && !needsPromptSource
    && transformOperations.some((operation) => [
      "enhance-prompt",
      "generate-image",
      "compare-generate-image",
      "generate-video",
      "compare-generate-video",
      "generate-audio",
      "text-to-speech",
    ].includes(operation.kind))
  ) {
    requiredFields.push("prompt");
  }
  if (requiresReferenceImage) requiredFields.push("reference_image");
  if (hasExport && !format) requiredFields.push("output_format");

  const outputKind = hasExport ? "file" : finalOutputKind;
  const inputSourceKind = hasCollectionInputs || hasUserUpload
    ? "user_upload"
    : directMediaInputKind
      ? "user_upload"
    : promptVariables.length > 0 || needsPromptSource
      ? "prompt"
      : transformOperations.some((operation) => [
        "enhance-prompt",
        "generate-image",
        "compare-generate-image",
        "generate-video",
        "compare-generate-video",
        "generate-audio",
        "text-to-speech",
      ].includes(operation.kind))
        ? "prompt"
        : "unknown";
  const inputKind = hasCollectionInputs
    ? "array"
    : directMediaInputKind
      ? directMediaInputKind
    : hasUserUpload
      ? "file"
    : inputSourceKind === "prompt"
      ? "text"
      : "unknown";
  const finalPromptKey = needsPromptCompose
    ? "composed_prompt"
    : promptVariables[0]?.key || (needsPromptSource ? "prompt" : null);

  return CompilerIntentSchema.parse({
    domain,
    originalRequest: userRequest,
    input: {
      source: inputSourceKind,
      kind: inputKind,
    },
    operations,
    output: {
      kind: outputKind,
      format,
      delivery: hasExport ? "download" : hasWorkflowIntent ? "app_output" : "unknown",
    },
    appMode: {
      enabled: requiredFields.length > 0,
      requiredFields: Array.from(new Set(requiredFields)),
    },
    promptPlan: {
      primitives: promptPrimitives,
      finalPromptKey,
    },
    ambiguities,
  });
}
