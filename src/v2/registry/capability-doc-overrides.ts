import type { NodeCapabilitySpec } from "./types.ts";

export interface CapabilityDocOverride {
  match: {
    definitionIds?: string[];
    displayNames?: string[];
    modelNamePrefixes?: string[];
  };
  docs: string[];
  capabilities: Partial<NodeCapabilitySpec>;
}

export const CAPABILITY_DOC_OVERRIDES: CapabilityDocOverride[] = [
  {
    match: {
      definitionIds: ["5AuHOOqORKUC7g1hAyOl"],
      displayNames: ["Output"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers-overview",
      "https://help.weavy.ai/en/articles/12267755-the-design-app",
    ],
    capabilities: {
      functionalRole: "ui-binding",
      taskTags: ["app-output", "workflow-output"],
      ioProfile: {
        summary: "any -> none",
        requiredInputKinds: ["any"],
        outputKinds: [],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Exposes a connected workflow result in the Weavy app so the flow can be turned into a Design App.",
      commonUseCases: [
        "Expose the final image result in a Design App",
        "Turn a workflow into an app-facing tool",
      ],
      planningHints: ["prefer_for_app_output", "prefer_near_workflow_end"],
    },
  },
  {
    match: {
      definitionIds: ["wkKkBSd0yrZGwbStnU6r"],
      displayNames: ["File"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers",
      "https://help.weavy.ai/en/articles/12292386-understanding-nodes",
    ],
    capabilities: {
      functionalRole: "import",
      taskTags: ["file-import", "image-upload"],
      ioProfile: {
        summary: "none -> file",
        requiredInputKinds: [],
        outputKinds: ["file"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription: "Imports a file into the graph so downstream nodes can process it.",
      commonUseCases: ["Upload an image file", "Provide a source file to a workflow"],
      planningHints: ["prefer_for_file_import"],
    },
  },
  {
    match: {
      definitionIds: ["SeV3xgeqgpZYmyHgQ205"],
      displayNames: ["Image Upscale / Real-ESRGAN"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-upscale", "image-transform"],
      ioProfile: {
        summary: "image -> image",
        requiredInputKinds: ["image"],
        outputKinds: ["image"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription: "Upscales a single image and returns an enhanced image output.",
      commonUseCases: ["Increase image resolution", "Improve image detail before export"],
      planningHints: ["prefer_for_simple_image_upscale"],
    },
  },
  {
    match: {
      definitionIds: ["1qYW4dNMRDIjEu5Yi5Rk"],
      displayNames: ["Image Upscale / Clarity"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-upscale", "model-conditioned"],
      dependencyComplexity: "heavy",
      hiddenDependencies: ["custom_sd_model"],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Upscales images but depends on an additional model input, so it is unsuitable for simple image-only workflows.",
      commonUseCases: ["Advanced model-conditioned image upscaling"],
      planningHints: ["avoid_without_model_source"],
    },
  },
  {
    match: {
      definitionIds: ["3w4OpEQntPBVwfbTkFnB"],
      displayNames: ["Blur"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268186-editing-tools",
      "https://help.weavy.ai/en/articles/12268346-datatypes",
    ],
    capabilities: {
      functionalRole: "bridge",
      taskTags: ["file-to-image", "image-bridge"],
      ioProfile: {
        summary: "file -> image",
        requiredInputKinds: ["file"],
        outputKinds: ["image"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "primary",
      naturalLanguageDescription:
        "Converts an incoming file input into an image output usable by image-processing nodes.",
      commonUseCases: ["Bridge uploaded files into image pipelines", "Prepare image input for image-only transforms"],
      planningHints: ["prefer_for_file_to_image_bridge", "requires_existing_file_input"],
    },
  },
  {
    match: {
      definitionIds: ["wyS4YwhP8zrq110ixxl7"],
      displayNames: ["Create PSD File"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers",
      "https://help.weavy.ai/en/articles/12268346-datatypes",
    ],
    capabilities: {
      functionalRole: "export",
      taskTags: ["image-to-file", "file-export"],
      fileExport: {
        mode: "fixed",
        supportedFormats: ["psd"],
      },
      bridgeSuitability: "secondary",
      naturalLanguageDescription:
        "Converts an image into a PSD file artifact. This is a fixed-format export, not a generic file exporter.",
      commonUseCases: ["Export an image specifically as a PSD file"],
      planningHints: ["prefer_for_image_to_file_export", "prefer_near_workflow_end", "fixed_file_export:psd"],
    },
  },
  {
    match: {
      definitionIds: ["JyaWOYxm1VCFqfdn6tFi"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers",
      "https://help.weavy.ai/en/articles/12343738-how-to-download-all-of-my-generation-at-once",
    ],
    capabilities: {
      functionalRole: "export",
      taskTags: ["generic-export", "image-export", "video-export", "file-export"],
      ioProfile: {
        summary: "any -> none",
        requiredInputKinds: ["any"],
        outputKinds: [],
      },
      fileExport: {
        mode: "selectable",
        supportedFormats: [],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Exports an image or video result from the graph for download, preserving or selecting an output format at export time.",
      commonUseCases: [
        "Download a generated image",
        "Download a generated video",
        "Expose a final workflow result to the user",
      ],
      planningHints: ["prefer_for_generic_export", "prefer_near_workflow_end"],
    },
  },
  {
    match: {
      definitionIds: ["7gKmskdJQ28nMlxdB6aR"],
      displayNames: ["Prompt Enhancer"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268282-text-tools",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["prompt-enhance", "text-transform"],
      ioProfile: {
        summary: "text -> text",
        requiredInputKinds: ["text"],
        outputKinds: ["text"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Improves or expands a prompt before it is sent to a downstream generation node.",
      commonUseCases: ["Improve a user's prompt before image generation", "Refine a text prompt for stronger outputs"],
      planningHints: ["prefer_for_prompt_enhancement", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["gVM2rcm5yygP8EEtR1os"],
      modelNamePrefixes: ["gpt_image_1_edit"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-edit", "prompt-guided-image-edit", "uploaded-image-edit"],
      ioProfile: {
        summary: "image+text -> image",
        requiredInputKinds: ["image", "text"],
        outputKinds: ["image"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Edits an existing image using a text prompt and returns an edited image.",
      commonUseCases: [
        "Edit an uploaded image with text instructions",
        "Apply style changes or localized edits to an existing image",
      ],
      planningHints: ["prefer_for_uploaded_image_edit", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["zeSQQxxjcaVdWWunD60J"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "generate",
      taskTags: ["text-to-image", "prompt-to-image", "image-generate"],
      dependencyComplexity: "simple",
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Generates an image directly from a text prompt and returns an image result.",
      commonUseCases: ["Create an image generator app", "Generate images from a user prompt"],
      planningHints: ["prefer_for_prompt_to_image_app", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["YH3Csui0gBsRIIJuWIxU"],
      displayNames: ["Luma Ray 2"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "generate",
      taskTags: ["text-to-video", "prompt-to-video", "video-generate"],
      dependencyComplexity: "simple",
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Generates a video directly from a text prompt and returns a video result.",
      commonUseCases: ["Create a prompt-to-video app", "Generate short videos from text prompts"],
      planningHints: ["prefer_for_prompt_to_video_app", "requires_text_prompt"],
    },
  },
  {
    match: {
      modelNamePrefixes: [
        "fal-ai/nano-banana",
        "fal-ai/nano-banana-2",
        "fal-ai/nano-banana-pro",
      ],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-edit", "prompt-guided-image-edit", "model-backed"],
      dependencyComplexity: "moderate",
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Applies prompt-guided edits to an image and returns an edited image using the Nano Banana model family.",
      commonUseCases: ["Edit an existing image with text instructions", "Apply prompt-guided image transformations"],
      planningHints: ["prefer_when_request_mentions_editing", "requires_text_prompt"],
    },
  },
];
