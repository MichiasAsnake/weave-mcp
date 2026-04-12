const API_BASE_URL =
  process.env.WEAVY_API_BASE_URL || "https://api.weavy.ai/api";

const TEMPLATE_CATALOG = {
  "multi-views": {
    id: "w2XgD044RfY7I0RmzQiF",
    label: "Multi views",
    description:
      "Public Figma Weave example focused on generating multiple angles/views.",
    baselineEstimatedCost: 70,
    costNotes:
      "Observed around 70 credits for the public template cost estimate before extra repairs.",
    keywords: [
      "multi view",
      "angles",
      "angle",
      "front",
      "side",
      "45",
      "fashion",
      "product shot",
      "pose",
      "variant",
    ],
  },
  "design-app": {
    id: "XvULalxaRR01K0RA1T0Kqx",
    label: "Design App Example",
    description:
      "Public Figma Weave example with exposed inputs and a Design App setup.",
    baselineEstimatedCost: 13,
    costNotes:
      "Observed around 13 credits for a single reference-driven estimate, making it the cheapest verified public base so far.",
    keywords: [
      "design app",
      "reusable",
      "share",
      "template",
      "style",
      "workflow app",
      "prompt app",
      "brand",
    ],
  },
};

const PROMPTISH_NODE_TYPES = new Set([
  "promptV3",
  "promptV2",
  "prompt",
  "string",
  "prompt_concat",
  "anyllm",
]);

const MEDIA_IMPORT_NODE_TYPES = new Set([
  "import",
  "ImportLoRA",
  "multilora",
  "extract_video_frame",
]);

const STYLE_WORDS = [
  "minimalist",
  "luxury",
  "editorial",
  "cinematic",
  "playful",
  "organic",
  "gritty",
  "clean",
  "bold",
  "futuristic",
  "retro",
  "surreal",
  "photorealistic",
  "high-fashion",
  "high fashion",
];

const COLOR_WORDS = [
  "black",
  "white",
  "grey",
  "gray",
  "red",
  "blue",
  "green",
  "yellow",
  "orange",
  "purple",
  "pink",
  "brown",
  "beige",
  "cream",
  "gold",
  "silver",
  "olive",
  "lime",
];

const BODY_TYPE_WORDS = [
  "slim",
  "athletic",
  "muscular",
  "curvy",
  "petite",
  "tall",
  "plus-size",
  "plus size",
];

const ETHNICITY_WORDS = [
  "irish",
  "asian",
  "japanese",
  "korean",
  "chinese",
  "indian",
  "black",
  "white",
  "latina",
  "latino",
  "african",
  "arab",
  "middle eastern",
  "european",
  "scandinavian",
];

const FASHION_ITEM_WORDS = [
  "jacket",
  "coat",
  "trench coat",
  "hoodie",
  "dress",
  "shirt",
  "pants",
  "trousers",
  "skirt",
  "sweater",
  "blazer",
  "suit",
  "bag",
  "shoe",
  "sneaker",
  "boot",
  "hat",
  "glasses",
  "sunglasses",
];

function listTemplates() {
  return Object.entries(TEMPLATE_CATALOG).map(([alias, template]) => ({
    alias,
    ...template,
  }));
}

function resolveTemplate(aliasOrId) {
  if (TEMPLATE_CATALOG[aliasOrId]) {
    return {
      alias: aliasOrId,
      ...TEMPLATE_CATALOG[aliasOrId],
    };
  }

  return {
    alias: aliasOrId,
    id: aliasOrId,
    label: aliasOrId,
    description: "Direct recipe ID",
  };
}

function pickTemplateForGoal(goal) {
  const lowerGoal = String(goal || "").toLowerCase();
  const candidates = listTemplates().map((template) => ({
    ...template,
    score: template.keywords.reduce(
      (sum, keyword) => sum + (lowerGoal.includes(keyword) ? 1 : 0),
      0,
    ),
  }));

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];

  if (!best || best.score === 0) {
    return resolveTemplate("design-app");
  }

  return best;
}

module.exports = {
  API_BASE_URL,
  BODY_TYPE_WORDS,
  COLOR_WORDS,
  ETHNICITY_WORDS,
  FASHION_ITEM_WORDS,
  MEDIA_IMPORT_NODE_TYPES,
  PROMPTISH_NODE_TYPES,
  STYLE_WORDS,
  TEMPLATE_CATALOG,
  listTemplates,
  pickTemplateForGoal,
  resolveTemplate,
};
