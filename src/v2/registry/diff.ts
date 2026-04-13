import type { NodeSpec, ParamSpec, PortSpec, NormalizedRegistrySnapshot } from "./types.ts";

import type { VersionBumpLevel } from "../shared/versioning.ts";

export interface RegistryNodeSpecDiff {
  definitionId: string;
  nodeType: string;
  changeLevel: VersionBumpLevel;
  reasons: string[];
}

export interface RegistrySnapshotDiff {
  baseSyncId: string;
  headSyncId: string;
  versionBump: VersionBumpLevel;
  addedDefinitionIds: string[];
  removedDefinitionIds: string[];
  changedDefinitions: RegistryNodeSpecDiff[];
}

export function diffRegistrySnapshots(
  baseSnapshot: NormalizedRegistrySnapshot,
  headSnapshot: NormalizedRegistrySnapshot,
): RegistrySnapshotDiff {
  const baseByDefinitionId = new Map(baseSnapshot.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]));
  const headByDefinitionId = new Map(headSnapshot.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]));

  const addedDefinitionIds = Array.from(headByDefinitionId.keys())
    .filter((definitionId) => !baseByDefinitionId.has(definitionId))
    .sort();
  const removedDefinitionIds = Array.from(baseByDefinitionId.keys())
    .filter((definitionId) => !headByDefinitionId.has(definitionId))
    .sort();

  const changedDefinitions: RegistryNodeSpecDiff[] = [];

  for (const [definitionId, headNodeSpec] of headByDefinitionId.entries()) {
    const baseNodeSpec = baseByDefinitionId.get(definitionId);
    if (!baseNodeSpec) {
      continue;
    }

    const nodeDiff = diffNodeSpecs(baseNodeSpec, headNodeSpec);
    if (nodeDiff) {
      changedDefinitions.push(nodeDiff);
    }
  }

  const levels: VersionBumpLevel[] = [
    addedDefinitionIds.length > 0 ? "minor" : "patch",
    removedDefinitionIds.length > 0 ? "major" : "patch",
    ...changedDefinitions.map((change) => change.changeLevel),
  ];

  return {
    baseSyncId: baseSnapshot.syncId,
    headSyncId: headSnapshot.syncId,
    versionBump: maxVersionBump(levels),
    addedDefinitionIds,
    removedDefinitionIds,
    changedDefinitions: changedDefinitions.sort((left, right) =>
      left.definitionId.localeCompare(right.definitionId),
    ),
  };
}

function diffNodeSpecs(baseNodeSpec: NodeSpec, headNodeSpec: NodeSpec): RegistryNodeSpecDiff | null {
  const reasons: string[] = [];
  const levels: VersionBumpLevel[] = [];

  if (baseNodeSpec.nodeType !== headNodeSpec.nodeType) {
    reasons.push(`nodeType changed: ${baseNodeSpec.nodeType} -> ${headNodeSpec.nodeType}`);
    levels.push("major");
  }

  if (baseNodeSpec.displayName !== headNodeSpec.displayName) {
    reasons.push(`displayName changed: ${baseNodeSpec.displayName} -> ${headNodeSpec.displayName}`);
    levels.push("patch");
  }

  if ((baseNodeSpec.category || "") !== (headNodeSpec.category || "")) {
    reasons.push(`category changed: ${baseNodeSpec.category || "<missing>"} -> ${headNodeSpec.category || "<missing>"}`);
    levels.push("patch");
  }

  if ((baseNodeSpec.subtype || "") !== (headNodeSpec.subtype || "")) {
    reasons.push(`subtype changed: ${baseNodeSpec.subtype || "<missing>"} -> ${headNodeSpec.subtype || "<missing>"}`);
    levels.push("patch");
  }

  if ((baseNodeSpec.model?.name || "") !== (headNodeSpec.model?.name || "")) {
    reasons.push(`model changed: ${baseNodeSpec.model?.name || "<missing>"} -> ${headNodeSpec.model?.name || "<missing>"}`);
    levels.push("major");
  }

  if (!sameUnknown(baseNodeSpec.capabilities, headNodeSpec.capabilities)) {
    reasons.push("capabilities changed");
    levels.push("patch");
  }

  diffPorts(baseNodeSpec.ports, headNodeSpec.ports, reasons, levels);
  diffParams(baseNodeSpec.params, headNodeSpec.params, reasons, levels);

  if (reasons.length === 0) {
    return null;
  }

  return {
    definitionId: headNodeSpec.source.definitionId,
    nodeType: headNodeSpec.nodeType,
    changeLevel: maxVersionBump(levels),
    reasons,
  };
}

function diffPorts(
  basePorts: PortSpec[],
  headPorts: PortSpec[],
  reasons: string[],
  levels: VersionBumpLevel[],
): void {
  const baseByKey = new Map(basePorts.map((port) => [`${port.direction}:${port.key}`, port]));
  const headByKey = new Map(headPorts.map((port) => [`${port.direction}:${port.key}`, port]));
  const keys = new Set([...baseByKey.keys(), ...headByKey.keys()]);

  for (const key of keys) {
    const basePort = baseByKey.get(key);
    const headPort = headByKey.get(key);
    if (!basePort && headPort) {
      reasons.push(`port added: ${key}`);
      levels.push(headPort.direction === "input" && headPort.required ? "major" : "minor");
      continue;
    }

    if (basePort && !headPort) {
      reasons.push(`port removed: ${key}`);
      levels.push("major");
      continue;
    }

    if (!basePort || !headPort) {
      continue;
    }

    if (basePort.kind !== headPort.kind) {
      reasons.push(`port kind changed for ${key}: ${basePort.kind} -> ${headPort.kind}`);
      levels.push("major");
    }

    if (basePort.required !== headPort.required) {
      reasons.push(`port required changed for ${key}: ${basePort.required} -> ${headPort.required}`);
      levels.push(headPort.required ? "major" : "minor");
    }

    if (basePort.multi !== headPort.multi) {
      reasons.push(`port multi changed for ${key}: ${basePort.multi} -> ${headPort.multi}`);
      levels.push("minor");
    }
  }
}

function diffParams(
  baseParams: ParamSpec[],
  headParams: ParamSpec[],
  reasons: string[],
  levels: VersionBumpLevel[],
): void {
  const baseByKey = new Map(baseParams.map((param) => [param.key, param]));
  const headByKey = new Map(headParams.map((param) => [param.key, param]));
  const keys = new Set([...baseByKey.keys(), ...headByKey.keys()]);

  for (const key of keys) {
    const baseParam = baseByKey.get(key);
    const headParam = headByKey.get(key);
    if (!baseParam && headParam) {
      reasons.push(`param added: ${key}`);
      levels.push(headParam.required ? "major" : "minor");
      continue;
    }

    if (baseParam && !headParam) {
      reasons.push(`param removed: ${key}`);
      levels.push("major");
      continue;
    }

    if (!baseParam || !headParam) {
      continue;
    }

    if (baseParam.kind !== headParam.kind) {
      reasons.push(`param kind changed for ${key}: ${baseParam.kind} -> ${headParam.kind}`);
      levels.push("major");
    }

    if (baseParam.required !== headParam.required) {
      reasons.push(`param required changed for ${key}: ${baseParam.required} -> ${headParam.required}`);
      levels.push(headParam.required ? "major" : "minor");
    }

    if (!sameStringArray(baseParam.enumValues, headParam.enumValues)) {
      const removedEnumValues = (baseParam.enumValues || []).filter((value) => !(headParam.enumValues || []).includes(value));
      reasons.push(`param enum changed for ${key}`);
      levels.push(removedEnumValues.length > 0 ? "major" : "minor");
    }

    if (!sameNumber(baseParam.min, headParam.min) || !sameNumber(baseParam.max, headParam.max)) {
      reasons.push(`param bounds changed for ${key}`);
      levels.push("major");
    }

    if (!sameUnknown(baseParam.defaultValue, headParam.defaultValue)) {
      reasons.push(`param default changed for ${key}`);
      levels.push("patch");
    }
  }
}

function sameStringArray(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = left || [];
  const normalizedRight = right || [];
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function sameNumber(left: number | undefined, right: number | undefined): boolean {
  return left === right;
}

function sameUnknown(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function maxVersionBump(levels: VersionBumpLevel[]): VersionBumpLevel {
  if (levels.includes("major")) {
    return "major";
  }

  if (levels.includes("minor")) {
    return "minor";
  }

  return "patch";
}
