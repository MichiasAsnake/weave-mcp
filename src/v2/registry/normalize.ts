import type {
  NodeSpec,
  NormalizedRegistrySnapshot,
  ParamSpec,
  PortSpec,
  RawRegistrySnapshot,
  RegistryNormalizationWarning,
  RegistrySourceKind,
  RegistrySourceSummary,
  ValueKind,
} from "./types.ts";

import { inferNodeCapabilities } from "./capabilities.ts";
import { sha256 } from "./hash.ts";

const OPTIONAL_INPUT_KEYS = new Set(["negative_prompt", "reference_image", "system_prompt"]);

export function normalizeRegistrySnapshot(
  rawSnapshot: RawRegistrySnapshot,
  options: {
    registryVersion: string;
  },
): NormalizedRegistrySnapshot {
  const warnings: RegistryNormalizationWarning[] = [];
  const modelPriceLookup = buildModelPriceLookup(rawSnapshot.sources.modelPrices);

  const publicDefinitions = normalizeDefinitionList(rawSnapshot.sources.public);
  const userDefinitions = normalizeDefinitionList(rawSnapshot.sources.user);

  const publicNodeSpecs = publicDefinitions.map((definition) =>
    normalizeNodeDefinition({
      definition,
      sourceKind: "public",
      syncId: rawSnapshot.syncId,
      fetchedAt: rawSnapshot.fetchedAt,
      registryVersion: options.registryVersion,
      modelPriceLookup,
      warnings,
    }),
  );
  const userNodeSpecs = userDefinitions.map((definition) =>
    normalizeNodeDefinition({
      definition,
      sourceKind: "user",
      syncId: rawSnapshot.syncId,
      fetchedAt: rawSnapshot.fetchedAt,
      registryVersion: options.registryVersion,
      modelPriceLookup,
      warnings,
    }),
  );

  const nodeSpecs = dedupeNodeSpecs([...publicNodeSpecs, ...userNodeSpecs]);
  const sourceSummaries: RegistrySourceSummary[] = [
    {
      sourceKind: "public",
      fetchedCount: publicDefinitions.length,
      normalizedCount: publicNodeSpecs.length,
    },
    {
      sourceKind: "user",
      fetchedCount: userDefinitions.length,
      normalizedCount: userNodeSpecs.length,
    },
  ];

  return {
    syncId: rawSnapshot.syncId,
    fetchedAt: rawSnapshot.fetchedAt,
    registryVersion: options.registryVersion,
    apiBaseUrl: rawSnapshot.apiBaseUrl,
    authSource: rawSnapshot.authSource,
    sourceSummaries,
    nodeSpecs,
    warnings,
  };
}

function normalizeNodeDefinition(args: {
  definition: unknown;
  sourceKind: RegistrySourceKind;
  syncId: string;
  fetchedAt: string;
  registryVersion: string;
  modelPriceLookup: Map<string, unknown>;
  warnings: RegistryNormalizationWarning[];
}): NodeSpec {
  const definition = asRecord(args.definition);
  const data = asRecord(definition.data);
  const kindRecord = asRecord(data.kind);

  // ASSUMPTION: live node definitions expose a stable `id` and `type`; if one is absent,
  // we fall back to the other before hashing the raw definition as a last resort.
  const definitionId =
    firstString(definition.id, definition.definitionId, definition.type) || `definition-${sha256(definition)}`;
  const nodeType = firstString(definition.type, definition.id, definition.definitionId) || definitionId;
  const displayName =
    // ASSUMPTION: menu metadata mirrors the shape hinted by `src/fallbacks.js`.
    firstString(
      data.menu && asRecord(data.menu).displayName,
      data.name,
      definition.name,
      nodeType,
    ) || nodeType;
  const category = firstString(data.color, data.dark_color, data.color_dark, data.border_color);
  const subtype = firstString(kindRecord.type);

  const baseInputHandles = normalizeHandleMap(data.handles && asRecord(data.handles).input, "input");
  const baseOutputHandles = normalizeHandleMap(data.handles && asRecord(data.handles).output, "output");
  const kindInputHandles = normalizeKindHandleList(kindRecord.inputs, "input");
  const kindOutputHandles = normalizeKindHandleList(kindRecord.outputs, "output");
  const inputHandles = mergePorts(baseInputHandles, kindInputHandles);
  const outputHandles = mergePorts(baseOutputHandles, kindOutputHandles);
  const inputPortKeys = new Set(inputHandles.map((handle) => handle.key));
  const outputPortKeys = new Set(outputHandles.map((handle) => handle.key));

  const kindParameterMetadata = normalizeKindParameterMetadata(kindRecord.parameters);
  const schemaRecord = mergeSchemaRecords(asRecord(data.schema), kindParameterMetadata.schemaByKey);
  const params = normalizeParams({
    schemaRecord,
    data,
    kindDefaultByKey: kindParameterMetadata.defaultByKey,
    inputPortKeys,
    outputPortKeys,
  });

  const ports = [...inputHandles, ...outputHandles];
  const acceptsKinds = uniqueValueKinds(ports.filter((port) => port.direction === "input").map((port) => port.kind));
  const producesKinds = uniqueValueKinds(
    ports.filter((port) => port.direction === "output").map((port) => port.kind),
  );
  const model = normalizeModelSpec(definition, data, args.modelPriceLookup);
  const isGenerative = inferIsGenerative({
    ports,
    params,
    modelName: model?.name,
  });
  const appMode = inferAppMode({
    ports,
    params,
    nodeType,
  });
  const capabilities = inferNodeCapabilities({
    definitionId,
    nodeType,
    displayName,
    category,
    subtype,
    isGenerative,
    model,
    ports,
    params,
  });

  if (!firstString(definition.id, definition.definitionId, definition.type)) {
    args.warnings.push({
      code: "definition-id-fallback",
      message: "Definition was missing an explicit id/type and required a hash-based fallback id.",
      sourceKind: args.sourceKind,
      definitionId,
      nodeType,
    });
  }

  return {
    registryVersion: args.registryVersion,
    syncId: args.syncId,
    source: {
      definitionId,
      fetchedAt: args.fetchedAt,
      sourceKind: args.sourceKind,
      rawHash: sha256(definition),
    },
    nodeType,
    displayName,
    category,
    subtype,
    isGenerative,
    spendBehavior: model?.matchedPriceCredits != null ? "credits" : model?.name ? "unknown" : "free",
    model,
    ports,
    params,
    compatibility: {
      acceptsKinds,
      producesKinds,
      requiresAllMandatoryInputs: ports.some((port) => port.direction === "input" && port.required),
    },
    appMode,
    capabilities,
    raw: definition,
  };
}

function normalizeParams(args: {
  schemaRecord: Record<string, unknown>;
  data: Record<string, unknown>;
  kindDefaultByKey: Record<string, unknown>;
  inputPortKeys: Set<string>;
  outputPortKeys: Set<string>;
}): ParamSpec[] {
  const params: ParamSpec[] = [];
  const inputDefaults = asRecord(args.data.input);

  for (const [key, rawSchema] of Object.entries(args.schemaRecord)) {
    if (args.inputPortKeys.has(key) || args.outputPortKeys.has(key)) {
      continue;
    }

    const schema = asRecord(rawSchema);
    const enumValues = normalizeEnumValues(schema);
    const kindDefault = args.kindDefaultByKey[key];
    const defaultValue = extractDefaultValue(schema, kindDefault, inputDefaults[key]);
    const kind = inferParamKind(schema, defaultValue, enumValues);

    // ASSUMPTION: schema.required mirrors common JSON-schema style; if omitted, a field is optional.
    const required = schema.required === true;

    params.push({
      key,
      kind,
      required,
      defaultValue,
      enumValues,
      min: asNumber(schema.minimum ?? schema.min),
      max: asNumber(schema.maximum ?? schema.max),
      step: asNumber(schema.step),
      ui: inferParamUi(schema, kind, enumValues),
      appMode: inferParamAppMode(schema, kind),
      raw: rawSchema,
    });
  }

  return params.sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeHandleMap(rawHandles: unknown, direction: "input" | "output"): PortSpec[] {
  if (Array.isArray(rawHandles)) {
    return rawHandles
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
      .map((key) => ({
        key,
        direction,
        kind: inferHandleKind(key, {}),
        // ASSUMPTION: array-style handles do not expose explicit required metadata; for inputs we
        // conservatively treat known optional keys from the existing codebase as optional.
        required: direction === "input" ? !OPTIONAL_INPUT_KEYS.has(key) : false,
        // ASSUMPTION: Weave edges appear singular per handle in the current recipe payloads, so default false.
        multi: false,
        raw: key,
      }));
  }

  const handleRecord = asRecord(rawHandles);
  return Object.entries(handleRecord)
    .map(([key, rawHandle]) => {
      const handle = asRecord(rawHandle);
      const kind = inferHandleKind(key, handle);
      const required =
        direction === "input"
          ? handle.required !== false && !OPTIONAL_INPUT_KEYS.has(key)
          : false;
      const compatibleKinds = normalizeCompatibleKinds(handle.validTypes, kind);

      return {
        key,
        direction,
        kind,
        required,
        // ASSUMPTION: if a handle metadata object declares list/array semantics, the port can fan in/out.
        multi: handle.multi === true || handle.list === true || handle.array === true,
        accepts: direction === "input" ? compatibleKinds : undefined,
        produces: direction === "output" ? compatibleKinds : undefined,
        raw: rawHandle,
      };
    })
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeKindHandleList(rawHandles: unknown, direction: "input" | "output"): PortSpec[] {
  if (!Array.isArray(rawHandles)) {
    return [];
  }

  const ports: PortSpec[] = [];

  for (const rawHandle of rawHandles) {
    const descriptor = asRecord(Array.isArray(rawHandle) ? rawHandle[0] : rawHandle);
    const key = firstString(descriptor.id, descriptor.key, descriptor.name, descriptor.title);
    if (!key) {
      continue;
    }

    const kind = inferHandleKind(key, descriptor);
    const compatibleKinds = normalizeCompatibleKinds(descriptor.validTypes, kind);

    ports.push({
      key,
      direction,
      kind,
      required:
        direction === "input"
          ? descriptor.required === true || !OPTIONAL_INPUT_KEYS.has(key)
          : false,
      multi: descriptor.multi === true || descriptor.list === true || descriptor.array === true,
      accepts: direction === "input" ? compatibleKinds : undefined,
      produces: direction === "output" ? compatibleKinds : undefined,
      raw: rawHandle,
    });
  }

  return ports.sort((left, right) => left.key.localeCompare(right.key));
}

function mergePorts(primaryPorts: PortSpec[], fallbackPorts: PortSpec[]): PortSpec[] {
  const byKey = new Map<string, PortSpec>();

  for (const port of fallbackPorts) {
    byKey.set(port.key, port);
  }

  for (const port of primaryPorts) {
    const existing = byKey.get(port.key);
    if (!existing) {
      byKey.set(port.key, port);
      continue;
    }

    byKey.set(port.key, {
      key: port.key,
      direction: port.direction,
      kind: pickPreferredKind(port.kind, existing.kind),
      required: port.required || existing.required,
      multi: port.multi || existing.multi,
      accepts: chooseCompatibleKinds(port.accepts, existing.accepts),
      produces: chooseCompatibleKinds(port.produces, existing.produces),
      raw: {
        primary: port.raw,
        fallback: existing.raw,
      },
    });
  }

  return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key));
}

function chooseCompatibleKinds(
  primary: ValueKind[] | undefined,
  fallback: ValueKind[] | undefined,
): ValueKind[] | undefined {
  if (primary && primary.length > 0) {
    return primary;
  }

  if (fallback && fallback.length > 0) {
    return fallback;
  }

  return undefined;
}

function pickPreferredKind(primary: ValueKind, fallback: ValueKind): ValueKind {
  if (primary === "unknown" && fallback !== "unknown") {
    return fallback;
  }

  if (primary === "any" && fallback !== "unknown") {
    return fallback;
  }

  return primary;
}

function inferHandleKind(key: string, handle: Record<string, unknown>): ValueKind {
  const normalizedKey = key.toLowerCase();
  const tokens = [
    firstString(handle.type),
    firstString(handle.format),
    ...(Array.isArray(handle.validTypes) ? handle.validTypes.map((value) => String(value)) : []),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (normalizedKey === "workflow") {
    // ASSUMPTION: `workflow` appears as a structural/internal payload edge in the live snapshot;
    // keep it intentionally unknown until the API surface clarifies how it should validate.
    return "unknown";
  }

  if (normalizedKey === "in" || normalizedKey === "out") {
    // ASSUMPTION: generic router pass-through handles do not expose enough metadata in the
    // live snapshot to infer a stable kind from the key name alone.
    return "unknown";
  }

  if (normalizedKey === "option") {
    // ASSUMPTION: `option` behaves like a structured option bag in the live snapshot; map it
    // to `object` until Weave exposes a stronger contract for the payload shape.
    return "object";
  }

  if (normalizedKey === "results") {
    // ASSUMPTION: `results` is a collection-valued output in the live snapshot; map it to
    // `array` until the element type is exposed directly by the API.
    return "array";
  }

  if (normalizedKey === "subject") {
    // ASSUMPTION: `subject` is image-like in the current live definitions that expose it;
    // this should be re-verified if Weave starts surfacing non-image subject inputs.
    return "image";
  }

  if (
    normalizedKey === "lora" ||
    normalizedKey === "lora_url" ||
    normalizedKey === "lora_links" ||
    normalizedKey === "lora_weights" ||
    normalizedKey === "lora_urls" ||
    normalizedKey === "lora_links"
  ) {
    // ASSUMPTION: LoRA-related ports carry asset references rather than inline scalar values;
    // normalize them as `file` until Weave exposes a dedicated LoRA asset kind.
    return "file";
  }

  if (normalizedKey === "number") {
    return "number";
  }

  if (normalizedKey === "weight") {
    return "number";
  }

  if (normalizedKey === "back" || normalizedKey === "front") {
    // ASSUMPTION: `comp` exposes `back` and `front` as unlabeled layer/image inputs and
    // produces an image output, so these ports are normalized as image-like.
    return "image";
  }

  if (normalizedKey === "layer1") {
    // ASSUMPTION: `painter` exposes `image` and `layer1` as paired inputs and emits `mask`
    // plus `all`; treat `layer1` as image-like until Weave exposes a dedicated layer kind.
    return "image";
  }

  if (normalizedKey === "all") {
    // ASSUMPTION: `painter.all` remains intentionally unknown because the raw definition only
    // exposes the key name and does not clarify whether this is a flattened image or a layer bundle.
    return "unknown";
  }

  if (normalizedKey === "image_with_alpha" || normalizedKey === "alpha_image") {
    return "image";
  }

  if (normalizedKey === "psd_file" || normalizedKey === "file" || /(^|_)(file|files)$/.test(normalizedKey)) {
    return "file";
  }

  if (normalizedKey === "array") {
    return "array";
  }

  if (normalizedKey === "object") {
    return "object";
  }

  if (normalizedKey === "seed") {
    return "number";
  }

  if (
    normalizedKey === "style_image" ||
    normalizedKey === "start_frame" ||
    normalizedKey === "end_frame" ||
    normalizedKey.startsWith("prompt") ||
    normalizedKey.endsWith("_image") ||
    normalizedKey.includes("image")
  ) {
    return "image";
  }

  if (
    normalizedKey === "positive_prompt" ||
    normalizedKey.startsWith("prompt") ||
    normalizedKey.endsWith("_prompt") ||
    normalizedKey.includes("_prompt_")
  ) {
    return "text";
  }

  const tokenKinds = tokens
    .map((token) => mapValueKindToken(token))
    .filter((value): value is ValueKind => value != null && value !== "unknown");
  const distinctTokenKinds = Array.from(new Set(tokenKinds));

  if (distinctTokenKinds.length === 1) {
    return distinctTokenKinds[0];
  }

  if (distinctTokenKinds.length > 1) {
    return "any";
  }

  if (/^(prompt|text|negative_prompt|system_prompt)$/.test(normalizedKey)) {
    return "text";
  }

  if (/^(image|image_\d+|input_image|reference_image|result|control_image)$/.test(normalizedKey)) {
    return "image";
  }

  if (/video/.test(normalizedKey)) {
    return "video";
  }

  if (/audio|voice/.test(normalizedKey)) {
    return "audio";
  }

  if (/mask/.test(normalizedKey)) {
    return "mask";
  }

  if (/3d|mesh|model/.test(normalizedKey)) {
    return "3d";
  }

  if (/array/.test(normalizedKey)) {
    return "array";
  }

  if (/object|map/.test(normalizedKey)) {
    return "object";
  }

  // ASSUMPTION: any remaining unmatched handles are genuinely unknown in the current
  // reverse-engineered snapshot and should stay visible for follow-up mapping work.
  return "unknown";
}

function inferParamKind(
  schema: Record<string, unknown>,
  defaultValue: unknown,
  enumValues: string[] | undefined,
): ValueKind {
  const schemaType = firstString(schema.type, schema.format)?.toLowerCase() || "";

  if (enumValues && enumValues.length > 0) {
    return "enum";
  }

  if (
    schemaType === "number" ||
    schemaType === "integer" ||
    schemaType === "seed" ||
    schemaType === "input" ||
    schemaType === "input-number" ||
    schemaType === "input-integer" ||
    schemaType === "integer_with_limits"
  ) {
    return "number";
  }

  if (schemaType === "boolean") {
    return "boolean";
  }

  if (schemaType === "string" || schemaType === "text") {
    return "text";
  }

  if (schemaType === "array") {
    return "array";
  }

  if (schemaType === "object" || schemaType === "json") {
    return "object";
  }

  const tokenKind = mapValueKindToken(schemaType);
  if (tokenKind && tokenKind !== "unknown") {
    return tokenKind;
  }

  if (typeof defaultValue === "boolean") {
    return "boolean";
  }

  if (typeof defaultValue === "number") {
    return "number";
  }

  if (typeof defaultValue === "string") {
    return "text";
  }

  if (Array.isArray(defaultValue)) {
    return "array";
  }

  if (defaultValue && typeof defaultValue === "object") {
    return "object";
  }

  return "unknown";
}

function inferParamUi(
  schema: Record<string, unknown>,
  kind: ValueKind,
  enumValues: string[] | undefined,
): ParamSpec["ui"] {
  const label =
    // ASSUMPTION: a human label may exist as `title`, `label`, or nested UI metadata.
    firstString(schema.title, schema.label, schema.ui && asRecord(schema.ui).label) || undefined;

  const hidden = schema.hidden === true;
  let control: "textbox" | "textarea" | "slider" | "toggle" | "select" | "file" | undefined;

  if (enumValues && enumValues.length > 0) {
    control = "select";
  } else if (kind === "boolean") {
    control = "toggle";
  } else if (kind === "number") {
    control = schema.minimum != null || schema.min != null || schema.maximum != null || schema.max != null ? "slider" : "textbox";
  } else if (kind === "file" || kind === "image" || kind === "video" || kind === "audio") {
    control = "file";
  } else if (kind === "text") {
    control = String(schema.widget || "").toLowerCase() === "textarea" ? "textarea" : "textbox";
  }

  if (!label && control == null && !hidden) {
    return undefined;
  }

  return {
    control,
    label,
    // ASSUMPTION: group/order may exist in ad hoc UI metadata if Weave surfaces them.
    group: firstString(schema.group, schema.section, schema.ui && asRecord(schema.ui).group) || undefined,
    order: asInteger(schema.order ?? (schema.ui && asRecord(schema.ui).order)),
    hidden,
  };
}

function inferParamAppMode(schema: Record<string, unknown>, kind: ValueKind): ParamSpec["appMode"] {
  const simpleKinds = new Set<ValueKind>(["text", "number", "boolean", "enum", "image", "video", "audio", "file"]);
  const exposable = simpleKinds.has(kind) && schema.hidden !== true;

  if (!exposable) {
    return {
      exposable: false,
      defaultExposed: false,
      lockable: false,
    };
  }

  return {
    exposable: true,
    // ASSUMPTION: params are not exposed by default unless explicit design-app metadata later opts them in.
    defaultExposed: false,
    lockable: true,
  };
}

function inferAppMode(args: {
  ports: PortSpec[];
  params: ParamSpec[];
  nodeType: string;
}): NodeSpec["appMode"] {
  const exposableParams = args.params.filter((param) => param.appMode?.exposable).map((param) => param.key);
  const exposablePorts = args.ports
    .filter((port) => port.direction === "input" && port.kind !== "unknown")
    .map((port) => port.key);

  return {
    // ASSUMPTION: output-like node types are named with `output` or `export`, matching current recipes.
    supportsOutputNode: /output|export/i.test(args.nodeType),
    exposableParams,
    exposablePorts,
  };
}

function inferIsGenerative(args: {
  ports: PortSpec[];
  params: ParamSpec[];
  modelName?: string;
}): boolean {
  if (args.modelName) {
    return true;
  }

  const outputKinds = new Set(args.ports.filter((port) => port.direction === "output").map((port) => port.kind));
  const inputKinds = new Set(args.ports.filter((port) => port.direction === "input").map((port) => port.kind));

  return (
    (outputKinds.has("image") || outputKinds.has("video") || outputKinds.has("audio") || outputKinds.has("3d")) &&
    (inputKinds.has("text") || args.params.some((param) => param.kind === "text" || param.kind === "enum"))
  );
}

function normalizeModelSpec(
  definition: Record<string, unknown>,
  data: Record<string, unknown>,
  modelPriceLookup: Map<string, unknown>,
): NodeSpec["model"] | undefined {
  // ASSUMPTION: model identity may live directly on `data.model.name` or under `data.kind.model.name`.
  const kindRecord = asRecord(data.kind);
  const modelName = firstString(
    data.model && asRecord(data.model).name,
    kindRecord.model && asRecord(kindRecord.model).name,
  );

  if (!modelName) {
    return undefined;
  }

  const matchedPrice = modelPriceLookup.get(modelName) || modelPriceLookup.get(firstString(definition.type) || "");
  const matchedPriceRecord = asRecord(matchedPrice);

  return {
    provider: modelName.includes("/") ? modelName.split("/")[0] : undefined,
    name: modelName,
    pricingKey: firstString(matchedPriceRecord.modelName, matchedPriceRecord.modelType, matchedPriceRecord.name) || undefined,
    matchedPriceCredits: asNumber(matchedPriceRecord.credits) ?? null,
  };
}

function normalizeEnumValues(schema: Record<string, unknown>): string[] | undefined {
  const values = Array.isArray(schema.enum)
    ? schema.enum
    : Array.isArray(schema.options)
      ? schema.options
      : null;

  if (!values) {
    return undefined;
  }

  const normalized = values.map((entry) => String(entry)).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function extractDefaultValue(schema: Record<string, unknown>, kindDefault: unknown, inputDefault: unknown): unknown {
  // ASSUMPTION: defaults can live in `schema.default`, in `data.kind.parameters[*].defaultValue`,
  // or in the node definition's `data.input` block.
  return schema.default ?? kindDefault ?? inputDefault;
}

function buildModelPriceLookup(payload: unknown): Map<string, unknown> {
  const lookup = new Map<string, unknown>();
  const entries = normalizePriceEntries(payload);

  for (const entry of entries) {
    const record = asRecord(entry);
    for (const key of [record.modelName, record.modelType, record.name]) {
      const normalized = firstString(key);
      if (normalized && !lookup.has(normalized)) {
        lookup.set(normalized, entry);
      }
    }
  }

  return lookup;
}

function normalizeDefinitionList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);

  // ASSUMPTION: the reverse-engineered payload may wrap definitions under `nodeDefinitions` or `items`,
  // matching the normalization logic already present in `src/fallbacks.js`.
  if (Array.isArray(record.nodeDefinitions)) {
    return record.nodeDefinitions;
  }

  if (Array.isArray(record.items)) {
    return record.items;
  }

  return [];
}

function normalizePriceEntries(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (Array.isArray(record.prices)) {
    return record.prices;
  }

  return [];
}

function dedupeNodeSpecs(nodeSpecs: NodeSpec[]): NodeSpec[] {
  const byDefinitionId = new Map<string, NodeSpec>();

  for (const nodeSpec of nodeSpecs) {
    const existing = byDefinitionId.get(nodeSpec.source.definitionId);
    if (!existing) {
      byDefinitionId.set(nodeSpec.source.definitionId, nodeSpec);
      continue;
    }

    if (nodeSpec.source.sourceKind === "user" && existing.source.sourceKind === "public") {
      byDefinitionId.set(nodeSpec.source.definitionId, nodeSpec);
    }
  }

  return Array.from(byDefinitionId.values()).sort((left, right) =>
    left.source.definitionId.localeCompare(right.source.definitionId),
  );
}

function uniqueValueKinds(values: ValueKind[]): ValueKind[] {
  return Array.from(new Set(values.filter((value) => value !== "unknown"))).sort();
}

function normalizeKindParameterMetadata(rawParameters: unknown): {
  schemaByKey: Record<string, unknown>;
  defaultByKey: Record<string, unknown>;
} {
  const schemaByKey: Record<string, unknown> = {};
  const defaultByKey: Record<string, unknown> = {};

  if (!Array.isArray(rawParameters)) {
    return {
      schemaByKey,
      defaultByKey,
    };
  }

  for (const rawParameter of rawParameters) {
    const pair = Array.isArray(rawParameter) ? rawParameter : [rawParameter, null];
    const descriptor = asRecord(pair[0]);
    const key = firstString(descriptor.id, descriptor.key, descriptor.name, descriptor.title);
    if (!key) {
      continue;
    }

    const constraint = asRecord(descriptor.constraint);
    const schemaLike: Record<string, unknown> = {
      title: firstString(descriptor.title, descriptor.label),
      description: firstString(descriptor.description),
      required: descriptor.required === true ? true : undefined,
      type: normalizeConstraintType(constraint),
      options: Array.isArray(constraint.options) ? constraint.options : undefined,
      min: asNumber(constraint.min),
      max: asNumber(constraint.max),
      step: asNumber(constraint.step),
      default: extractTypedValue(descriptor.defaultValue),
    };

    schemaByKey[key] = schemaLike;

    const runtimeDefault = extractTypedValue(pair[1]);
    const descriptorDefault = extractTypedValue(descriptor.defaultValue);
    if (runtimeDefault !== undefined) {
      defaultByKey[key] = runtimeDefault;
    } else if (descriptorDefault !== undefined) {
      defaultByKey[key] = descriptorDefault;
    }
  }

  return {
    schemaByKey,
    defaultByKey,
  };
}

function mergeSchemaRecords(baseSchema: Record<string, unknown>, kindSchema: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(kindSchema), ...Object.keys(baseSchema)]);

  for (const key of keys) {
    const base = asRecord(baseSchema[key]);
    const kind = asRecord(kindSchema[key]);
    merged[key] = {
      ...kind,
      ...base,
      default: base.default ?? kind.default,
      options: Array.isArray(base.options) ? base.options : kind.options,
    };
  }

  return merged;
}

function normalizeConstraintType(constraint: Record<string, unknown>): string | undefined {
  const rawType = firstString(constraint.type)?.toLowerCase();
  if (!rawType) {
    return undefined;
  }

  if (rawType === "integer_with_limits") {
    return "integer";
  }

  if (rawType === "image_size") {
    return "fal_image_size";
  }

  return rawType;
}

function extractTypedValue(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractTypedValue(entry));
  }

  if (typeof value !== "object") {
    return value;
  }

  const record = asRecord(value);
  if ("data" in record) {
    return extractTypedValue(record.data);
  }

  if ("value" in record) {
    if (record.type === "seed" && record.value && typeof record.value === "object") {
      return asNumber(asRecord(record.value).seed) ?? record.value;
    }

    return extractTypedValue(record.value);
  }

  return value;
}

function normalizeCompatibleKinds(rawKinds: unknown, fallbackKind: ValueKind): ValueKind[] | undefined {
  if (!Array.isArray(rawKinds)) {
    return fallbackKind !== "unknown" ? [fallbackKind] : undefined;
  }

  const mapped = Array.from(
    new Set(
      rawKinds
        .map((value) => mapValueKindToken(String(value)))
        .filter((value): value is ValueKind => value != null && value !== "unknown"),
    ),
  ).sort();

  if (mapped.length > 0) {
    return mapped;
  }

  return fallbackKind !== "unknown" ? [fallbackKind] : undefined;
}

function mapValueKindToken(token: string): ValueKind | undefined {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "any") {
    return "any";
  }

  if (normalized === "seed") {
    return "number";
  }

  if (normalized === "array") {
    return "array";
  }

  if (normalized === "object" || normalized === "json") {
    return "object";
  }

  if (normalized === "3d" || normalized.includes("3d")) {
    return "3d";
  }

  if (normalized === "boolean") {
    return "boolean";
  }

  if (normalized === "number" || normalized === "integer") {
    return "number";
  }

  if (normalized === "text" || normalized === "string") {
    return "text";
  }

  if (normalized === "mask" || normalized.includes("mask")) {
    return "mask";
  }

  if (normalized === "audio" || normalized.includes("audio")) {
    return "audio";
  }

  if (normalized === "video" || normalized.includes("video")) {
    return "video";
  }

  if (
    normalized === "image" ||
    normalized === "uri" ||
    normalized.includes("image") ||
    normalized.includes("alpha")
  ) {
    return "image";
  }

  if (normalized === "file" || normalized.includes("file") || normalized.includes("psd")) {
    return "file";
  }

  if (normalized === "workflow") {
    return "unknown";
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
