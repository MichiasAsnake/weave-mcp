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
      definitionIds: ["jzXJ8QEfxQm2sZfvzu7q"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268282-text-tools",
      "https://help.weavy.ai/en/articles/14047674-prompt-variables",
    ],
    capabilities: {
      functionalRole: "ui-binding",
      taskTags: ["prompt-source", "text-input", "prompt-input", "prompt-authoring", "prompt-variable-target"],
      ioProfile: {
        summary: "none -> text",
        requiredInputKinds: [],
        acceptedInputKinds: [],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Provides a reusable text prompt input that can fan out into one or more downstream prompt-driven nodes.",
      commonUseCases: [
        "Drive one or more generation nodes from a shared prompt",
        "Expose a top-level prompt input in a Weavy app",
      ],
      planningHints: ["prefer_for_prompt_source", "prefer_for_prompt_scaffold", "prefer_near_workflow_start"],
    },
  },
  {
    match: {
      definitionIds: ["7gKmskdJQ28nMlxdB6aR"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268282-text-tools",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["prompt-enhance", "text-transform", "prompt-authoring", "prompt-enhancement"],
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
      planningHints: ["prefer_for_prompt_enhancement", "prefer_for_prompt_refinement", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["Skt5hMt1fJCOrLtaOBERClone"],
      displayNames: ["Prompt Concatenator"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268282-text-tools",
      "https://help.weavy.ai/en/articles/14047674-prompt-variables",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["prompt-compose", "text-transform", "prompt-concatenate", "prompt-authoring", "prompt-composition"],
      ioProfile: {
        summary: "text+text -> text",
        requiredInputKinds: ["text"],
        acceptedInputKinds: ["text"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Combines multiple text prompt fragments into a single prompt string for downstream prompt-driven nodes.",
      commonUseCases: [
        "Compose named prompt variables into one prompt",
        "Combine reusable text fragments before generation",
      ],
      planningHints: ["prefer_for_prompt_compose", "prefer_for_prompt_merge", "requires_text_prompt"],
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
        acceptedInputKinds: ["image", "text"],
        optionalInputKinds: [],
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
      definitionIds: ["bebebed5-50c1-4701-98b3-86929db21585"],
      displayNames: ["Gemini Edit"],
      modelNamePrefixes: ["fal-ai/nano-banana-2/edit"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      planningHints: ["prefer_for_explicit_gemini_edit", "prefer_for_reference_image_edit"],
      commonUseCases: [
        "Edit an uploaded image with Gemini Edit",
        "Use a reference-style image edit model with text instructions",
      ],
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
      ioProfile: {
        summary: "text -> image",
        requiredInputKinds: ["text"],
        acceptedInputKinds: ["image", "text"],
        optionalInputKinds: ["image"],
        outputKinds: ["image"],
      },
      dependencyComplexity: "moderate",
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Applies prompt-guided edits to an image and returns an edited image using the Nano Banana model family.",
      commonUseCases: ["Edit an existing image with text instructions", "Apply prompt-guided image transformations"],
      planningHints: ["prefer_when_request_mentions_editing", "prefer_for_optional_image_edit", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["167894b0-37a1-4bd0-b189-7ec245f342b6"],
      displayNames: ["Flux Kontext Multi Image"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["multi-image-compose", "style-transfer-edit", "image-edit"],
      ioProfile: {
        summary: "image+image+text -> image",
        requiredInputKinds: ["image", "image", "text"],
        acceptedInputKinds: ["image", "text"],
        optionalInputKinds: [],
        outputKinds: ["image"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Combines two uploaded images with a text instruction to produce a single composed image result.",
      commonUseCases: [
        "Blend two uploaded images into one composition",
        "Transfer styling from a reference image onto a content image",
      ],
      planningHints: ["prefer_for_multi_image_compose", "prefer_for_style_transfer_edit", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["da813f69-224a-4b01-a3ca-03c7b088e21f"],
      displayNames: ["Mask by Text"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["mask-from-text", "mask-generate", "image-segmentation"],
      ioProfile: {
        summary: "image+text -> mask",
        requiredInputKinds: ["image", "text"],
        acceptedInputKinds: ["image", "text"],
        optionalInputKinds: [],
        outputKinds: ["mask"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Creates an edit mask from an uploaded image and a region description.",
      commonUseCases: [
        "Turn a text region description into a usable inpaint mask",
        "Select an object or area before inpainting",
      ],
      planningHints: ["prefer_for_mask_from_text", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["860VaIt3ufsa1vyFJdJe", "ifIMhfCO5bUbiiaQGcq5Clone", "kM22VnK1FAo4kMhXDn1g", "lM22VnK1FAo4kMhXDn1h", "B3qmf2tStypPLsSUgzSV", "C3qmf2tStypPLsSUgzSW"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["inpaint-edit", "masked-edit", "image-edit"],
      ioProfile: {
        summary: "image+mask+text -> image",
        requiredInputKinds: ["image", "mask", "text"],
        acceptedInputKinds: ["image", "mask", "text"],
        optionalInputKinds: [],
        outputKinds: ["image"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Edits a specific region of an uploaded image using a mask and a prompt.",
      commonUseCases: [
        "Inpaint part of an image with an uploaded mask",
        "Apply targeted edits to a masked region",
      ],
      planningHints: ["prefer_for_inpaint_edit", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["XY0fHk7ZqzqzSNlGjBuw", "75QG26UXKa7OflfJgHC6"],
      displayNames: ["Image to Video", "SD Image to Video"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "generate",
      taskTags: ["image-to-video", "video-generate"],
      ioProfile: {
        summary: "image -> video",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["video"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Animates an input image into a short video clip.",
      commonUseCases: [
        "Turn a generated image into a video",
        "Animate an uploaded still image",
      ],
      planningHints: ["prefer_for_image_to_video"],
    },
  },
  {
    match: {
      definitionIds: ["30294578-47a3-49ba-abd7-56ce4a526393"],
      displayNames: ["Video Concatenator"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["video-concat", "video-compose"],
      ioProfile: {
        summary: "video+video -> video",
        requiredInputKinds: ["video", "video"],
        acceptedInputKinds: ["video"],
        optionalInputKinds: [],
        outputKinds: ["video"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Concatenates multiple scene clips into a single continuous video.",
      commonUseCases: [
        "Join generated scene clips into one reel",
        "Compose multiple videos into one output clip",
      ],
      planningHints: ["prefer_for_video_concat"],
    },
  },
  {
    match: {
      definitionIds: ["09abbc34-010d-461d-8e7f-bcbad5973deb", "2a889770-82f1-49de-b772-c58cf764ad05"],
      displayNames: ["Pixverse Lipsync", "Kling lip-sync"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["voiceover-video", "lip-sync", "tts-video"],
      ioProfile: {
        summary: "video+text -> video",
        requiredInputKinds: ["video"],
        acceptedInputKinds: ["video", "text", "audio"],
        optionalInputKinds: ["text", "audio"],
        outputKinds: ["video"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Adds narration or lip-sync to an existing video using text or audio input.",
      commonUseCases: [
        "Add a script-driven voiceover to a video clip",
        "Generate narrated video output from text and video inputs",
      ],
      planningHints: ["prefer_for_voiceover_video"],
    },
  },
  {
    match: {
      definitionIds: ["E4Lo1vBJYlSjvgs0LtcS", "E4Lo1vBJYlSjvgs0LtcSClone", "eUJLF9oGyVVprrX1OURL"],
      displayNames: ["Array"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers-overview",
    ],
    capabilities: {
      functionalRole: "utility",
      taskTags: ["array-input", "collection-input", "collection-build", "fanin", "collection-fanin"],
      ioProfile: {
        summary: "any -> array",
        requiredInputKinds: [],
        acceptedInputKinds: ["any"],
        optionalInputKinds: ["any"],
        outputKinds: ["array"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Provides a reusable collection output that can seed collection workflows or gather multiple upstream items into an array for iterator-driven processing.",
      commonUseCases: [
        "Represent a collection input in compiler IR",
        "Seed collection-oriented workflows before iterator-driven map or foreach steps",
        "Collect multiple upstream items into one array output",
      ],
      planningHints: ["prefer_for_array_input", "prefer_for_fanin", "prefer_near_workflow_start"],
    },
  },
  {
    match: {
      definitionIds: ["Pgl8wL2X58uh8ZdehDtU", "Pgl8wL2X58uh8ZdehDtUClone"],
      displayNames: ["Router"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers-overview",
    ],
    capabilities: {
      functionalRole: "utility",
      taskTags: ["router", "pass-through", "fanout-routing"],
      ioProfile: {
        summary: "any -> any",
        requiredInputKinds: ["any"],
        acceptedInputKinds: ["any"],
        optionalInputKinds: [],
        outputKinds: ["any"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Passes one upstream value through to one or more downstream nodes without transforming it.",
      commonUseCases: [
        "Fan a shared prompt out into multiple downstream consumers",
        "Route one generated asset into multiple model branches",
      ],
      planningHints: ["prefer_for_router", "prefer_for_fanout_routing"],
    },
  },
  {
    match: {
      definitionIds: ["text_iterator"],
      displayNames: ["Text Iterator"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12343281-iterators",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["text-iterator", "collection-iterator", "fanout", "foreach", "map"],
      ioProfile: {
        summary: "array -> text",
        requiredInputKinds: [],
        acceptedInputKinds: ["array", "text"],
        optionalInputKinds: ["array", "text"],
        outputKinds: ["text"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Iterates over a text collection so one downstream text-driven subgraph can run once per item.",
      commonUseCases: [
        "Fan out a prompt list into repeated downstream generations",
        "Map one text-processing subgraph over a text collection",
      ],
      planningHints: ["prefer_for_text_iterator", "prefer_for_map", "prefer_for_foreach", "prefer_for_fanout"],
    },
  },
  {
    match: {
      definitionIds: ["image_iterator"],
      displayNames: ["Image Iterator"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12343281-iterators",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-iterator", "collection-iterator", "fanout", "foreach", "map"],
      ioProfile: {
        summary: "array -> image",
        requiredInputKinds: [],
        acceptedInputKinds: ["array", "image"],
        optionalInputKinds: ["array", "image"],
        outputKinds: ["image"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Iterates over an image collection so one downstream image or video subgraph can run once per uploaded image.",
      commonUseCases: [
        "Map a scene-generation subgraph over uploaded character images",
        "Fan out an image collection into repeated downstream model runs",
      ],
      planningHints: ["prefer_for_image_iterator", "prefer_for_map", "prefer_for_foreach", "prefer_for_fanout"],
    },
  },
  {
    match: {
      definitionIds: ["video_iterator"],
      displayNames: ["Video Iterator"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12343281-iterators",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["video-iterator", "collection-iterator", "fanout", "foreach", "map"],
      ioProfile: {
        summary: "array -> video",
        requiredInputKinds: [],
        acceptedInputKinds: ["array", "video"],
        optionalInputKinds: ["array", "video"],
        outputKinds: ["video"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Iterates over a video collection so one downstream video-processing subgraph can run once per clip.",
      commonUseCases: [
        "Map a video-processing subgraph over uploaded clips",
        "Fan out a video collection into repeated downstream runs",
      ],
      planningHints: ["prefer_for_video_iterator", "prefer_for_map", "prefer_for_foreach", "prefer_for_fanout"],
    },
  },
  {
    match: {
      definitionIds: ["comparison"],
      displayNames: ["Compare"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers-overview",
    ],
    capabilities: {
      functionalRole: "utility",
      taskTags: ["compare-utility", "comparison", "media-compare", "pass-through"],
      ioProfile: {
        summary: "any+any -> any",
        requiredInputKinds: [],
        acceptedInputKinds: ["any", "image", "video"],
        optionalInputKinds: ["any", "image", "video"],
        outputKinds: ["any"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Pairs two media inputs into a reusable comparison utility with pass-through outputs for side-by-side or slider-based app experiences.",
      commonUseCases: [
        "Compare two generated images in one workflow",
        "Compare two videos or media variants before exporting results",
      ],
      planningHints: ["prefer_for_compare_utility"],
    },
  },
  {
    match: {
      definitionIds: ["kling_element"],
      displayNames: ["Kling Element"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "utility",
      taskTags: ["kling-element", "reference-set", "structured-image-bundle"],
      ioProfile: {
        summary: "image+image -> object",
        requiredInputKinds: ["image", "image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: ["image"],
        outputKinds: ["object"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Packages one frontal image plus up to three reference images into the structured element object expected by Kling workflows.",
      commonUseCases: [
        "Prepare reference image bundles for Kling model inputs",
        "Represent a character or subject reference set as one structured artifact",
      ],
      planningHints: ["prefer_for_kling_element_bundle"],
    },
  },
  {
    match: {
      definitionIds: ["levels"],
      displayNames: ["Levels"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268186-editing-tools",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-levels", "image-adjust", "image-transform"],
      ioProfile: {
        summary: "image -> image",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["image"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Applies levels-style tonal adjustments to an image and returns a transformed image output.",
      commonUseCases: [
        "Adjust image brightness or contrast using level controls",
        "Refine tonal balance before export or composition",
      ],
      planningHints: ["prefer_for_image_levels_adjustment"],
    },
  },
  {
    match: {
      definitionIds: ["compv3"],
      displayNames: ["Compositor"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268300-helpers-overview",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["image-compositor", "image-compose", "image-overlay", "layer-compose"],
      ioProfile: {
        summary: "image+image -> image",
        requiredInputKinds: [],
        acceptedInputKinds: ["image"],
        optionalInputKinds: ["image"],
        outputKinds: ["image"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Composes a background image with one or more image layers into a single flattened image result.",
      commonUseCases: [
        "Overlay a foreground image on a background image",
        "Compose multiple image layers into one result before export",
      ],
      planningHints: ["prefer_for_image_compositor"],
    },
  },
  {
    match: {
      definitionIds: ["3kL0yZNd7MU09zE9GQmp"],
      displayNames: ["Video to Audio"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "generate",
      taskTags: ["generate-audio", "text-to-speech", "video-to-audio"],
      ioProfile: {
        summary: "text+video -> audio",
        requiredInputKinds: [],
        acceptedInputKinds: ["text", "video"],
        optionalInputKinds: ["text", "video"],
        outputKinds: ["audio"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Generates audio from a text prompt, with optional video conditioning when the request asks for video-to-audio synthesis.",
      commonUseCases: [
        "Generate a standalone voiceover audio clip from a script",
        "Synthesize audio from a prompt or from an existing video",
      ],
      planningHints: ["prefer_for_text_to_speech", "prefer_for_generate_audio", "requires_text_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["612b7096-9fec-47b2-9df5-e75b69d346c0"],
      displayNames: ["Merge Audio and Video"],
    },
    docs: [
      "https://help.weavy.ai/en/collections/15247921-nodes-and-models-documentations",
    ],
    capabilities: {
      functionalRole: "transform",
      taskTags: ["merge-audio-video", "audio-video-compose"],
      ioProfile: {
        summary: "audio+video -> video",
        requiredInputKinds: ["audio", "video"],
        acceptedInputKinds: ["audio", "video"],
        optionalInputKinds: [],
        outputKinds: ["video"],
      },
      dependencyComplexity: "moderate",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Combines one audio track with one video track and returns a single video output with embedded audio.",
      commonUseCases: [
        "Attach a generated voiceover track to a video",
        "Merge narration and visual output into one delivery clip",
      ],
      planningHints: ["prefer_for_merge_audio_video"],
    },
  },
  {
    match: {
      definitionIds: ["QmgEhPkxIT2o0R769yvK"],
      displayNames: ["Image Describer"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268282-text-tools",
    ],
    capabilities: {
      functionalRole: "analyze",
      taskTags: ["caption-extract", "image-describe", "prompt-authoring", "asset-description"],
      ioProfile: {
        summary: "image -> text",
        requiredInputKinds: ["image"],
        acceptedInputKinds: ["image"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Describes an image and returns text that can be used as a caption or analysis result.",
      commonUseCases: [
        "Extract a caption-like description from an image",
        "Generate text context from an uploaded reference image",
      ],
      planningHints: ["prefer_for_caption_extract", "prefer_for_asset_to_prompt"],
    },
  },
  {
    match: {
      definitionIds: ["0eadf99d-a5b8-404c-8d7d-508883d6bd22"],
      displayNames: ["Video Describer"],
    },
    docs: [
      "https://help.weavy.ai/en/articles/12268282-text-tools",
    ],
    capabilities: {
      functionalRole: "analyze",
      taskTags: ["caption-extract", "transcript-extract", "video-describe", "prompt-authoring", "asset-description"],
      ioProfile: {
        summary: "video -> text",
        requiredInputKinds: ["video"],
        acceptedInputKinds: ["video"],
        optionalInputKinds: [],
        outputKinds: ["text"],
      },
      dependencyComplexity: "simple",
      hiddenDependencies: [],
      bridgeSuitability: "none",
      naturalLanguageDescription:
        "Analyzes a video and returns descriptive text that can serve as a caption or transcript-like summary.",
      commonUseCases: [
        "Extract descriptive text from a video",
        "Approximate transcript or caption output for downstream prompt composition",
      ],
      planningHints: ["prefer_for_caption_extract", "prefer_for_transcript_extract", "prefer_for_asset_to_prompt"],
    },
  },
];
