import {
  selectPromptDescriberCandidates,
  selectPromptEnhancerCandidates,
} from "../registry/capability-selectors.ts";
import type { CompilerIntent, CompilerPromptDraft, CompilerPromptField, CompilerRuntime } from "./types.ts";

function requestText(intent: CompilerIntent): string {
  return intent.originalRequest.toLowerCase();
}

function isPromptHeavyAdRequest(intent: CompilerIntent): boolean {
  const text = requestText(intent);
  return /\bad generator\b|\bcampaign\b|\bscene(?:s)?\b|\bproduct scene(?:s)?\b|\bad scene(?:s)?\b/.test(text);
}

function buildAdPromptFields(intent: CompilerIntent): CompilerPromptField[] {
  const text = requestText(intent);
  const fields: CompilerPromptField[] = [
    {
      nodeRole: "prompt-node",
      promptKey: "base_product_prompt",
      purpose: "Describe the product identity and non-negotiable visual traits.",
      text: "Premium bag product photography with a consistent product silhouette, clear material detail, clean edges, and ad-ready lighting.",
      editable: true,
    },
    {
      nodeRole: "prompt-node",
      promptKey: "scene_variation_prompt",
      purpose: "Define the requested campaign setting or scene variation.",
      text: "Luxury travel campaign setting with an elegant environment, premium lifestyle framing, and believable scene composition.",
      editable: true,
    },
  ];

  if (/\bnegative\b|\bavoid\b|\bno\b/.test(text)) {
    fields.push({
      nodeRole: "prompt-node",
      promptKey: "negative_prompt",
      purpose: "Capture user-provided visual constraints or exclusions.",
      text: "Avoid distorted product shape, unreadable branding, extra straps, unnatural reflections, cluttered backgrounds, and low-quality artifacts.",
      editable: true,
    });
  }

  return fields;
}

export function buildPromptPlan(
  intent: CompilerIntent,
  registry: CompilerRuntime["registry"],
): CompilerPromptDraft {
  const fields: CompilerPromptField[] = [];

  if (isPromptHeavyAdRequest(intent)) {
    fields.push(...buildAdPromptFields(intent));
  }

  const useAssetDescriber =
    intent.input.kind === "image" && selectPromptDescriberCandidates(registry, "image").length > 0;

  return {
    fields,
    usePromptEnhancer: fields.length > 0 && selectPromptEnhancerCandidates(registry).length > 0,
    useAssetDescriber,
  };
}
