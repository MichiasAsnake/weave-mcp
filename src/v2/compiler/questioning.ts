import type { CompilerClarifyingQuestion, CompilerIntent } from "./types.ts";

const QUESTION_CATALOG: Record<string, CompilerClarifyingQuestion> = {
  missing_brand_tone: {
    key: "brand_tone",
    label: "Brand Tone",
    reason: "Tone changes prompt language and scene framing.",
    options: ["luxury", "playful", "minimal"],
  },
  missing_reference_asset: {
    key: "reference_asset",
    label: "Reference Asset",
    reason: "The requested workflow sounds like an edit flow and needs an image or video to edit.",
    options: ["image", "video"],
  },
};

export function buildClarifyingQuestions(intent: CompilerIntent): CompilerClarifyingQuestion[] {
  const seen = new Set<string>();

  return intent.ambiguities
    .map((entry) => QUESTION_CATALOG[entry.code])
    .filter((entry): entry is CompilerClarifyingQuestion => Boolean(entry))
    .filter((entry) => {
      if (seen.has(entry.key)) {
        return false;
      }

      seen.add(entry.key);
      return true;
    })
    .slice(0, 2);
}
