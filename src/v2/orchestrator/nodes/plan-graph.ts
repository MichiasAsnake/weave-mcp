// @ts-nocheck
import { OrchestratorStateSchema, type OrchestratorRuntime, type OrchestratorState } from "../types.ts";
import {
  appendCheckpoint,
  appendMessage,
  constrainPlanStepDefinitionIds,
  persistState,
  runPlanModel,
} from "./shared.ts";
import { getBridgeDefinitionIdsForKinds } from "../../registry/capabilities.ts";

export async function planGraphNode(
  state: OrchestratorState,
  runtime: OrchestratorRuntime,
): Promise<OrchestratorState> {
  console.log("[node]", "plan_graph");
  if (!state.registrySnapshot) {
    throw new Error("plan_graph requires registrySnapshot to be loaded.");
  }

  const plan = await runPlanModel(state, state.registrySnapshot, runtime);
  const knownDefinitionIds = new Set(
    state.registrySnapshot.nodeSpecs.map((nodeSpec) => nodeSpec.source.definitionId),
  );
  const unknownDefinitionIds: Array<{ stepId: string; ids: string[] }> = [];
  const constrainedDefinitionIds: Array<{ stepId: string; reason: string; ids: string[] }> = [];
  const sanitizedPlan = {
    ...plan,
    steps: plan.steps.map((step) => {
      const validDefinitionIds = step.nodeDefinitionIds.filter((definitionId) =>
        knownDefinitionIds.has(definitionId)
      );
      const invalidDefinitionIds = step.nodeDefinitionIds.filter((definitionId) =>
        !knownDefinitionIds.has(definitionId)
      );

      if (invalidDefinitionIds.length > 0) {
        unknownDefinitionIds.push({ stepId: step.stepId, ids: invalidDefinitionIds });
      }

      const constrainedStep = constrainPlanStepDefinitionIds(
        {
          ...step,
          nodeDefinitionIds: validDefinitionIds,
        },
        state.registrySnapshot,
        {
          requestText: state.userRequest,
        },
      );

      if (
        constrainedStep.replacementReason
        && constrainedStep.nodeDefinitionIds.join(",") !== validDefinitionIds.join(",")
      ) {
        constrainedDefinitionIds.push({
          stepId: step.stepId,
          reason: constrainedStep.replacementReason,
          ids: constrainedStep.nodeDefinitionIds,
        });
      }

      return {
        ...step,
        nodeDefinitionIds: constrainedStep.nodeDefinitionIds,
      };
    }),
  };
  const bridgeInsertions: Array<{ fromStepId: string; toStepId: string; ids: string[] }> = [];
  const bridgedPlan = {
    ...sanitizedPlan,
    steps: injectBridgeSteps(sanitizedPlan.steps, state.registrySnapshot, bridgeInsertions),
  };

  const unknownDefinitionSummary = unknownDefinitionIds.length > 0
    ? ` Removed ${unknownDefinitionIds.length} step(s) with unknown definitionId(s): ${unknownDefinitionIds
        .map(({ stepId, ids }) => `${stepId}=[${ids.join(", ")}]`)
        .join("; ")}.`
    : "";
  const constrainedDefinitionSummary = constrainedDefinitionIds.length > 0
    ? ` Replaced ${constrainedDefinitionIds.length} step definition selection(s): ${constrainedDefinitionIds
        .map(({ stepId, reason, ids }) => `${stepId}=[${ids.join(", ")}] (${reason})`)
        .join("; ")}.`
    : "";
  const bridgeInsertionSummary = bridgeInsertions.length > 0
    ? ` Inserted ${bridgeInsertions.length} bridge step(s): ${bridgeInsertions
        .map(({ fromStepId, toStepId, ids }) => `${fromStepId}->${toStepId}=[${ids.join(", ")}]`)
        .join("; ")}.`
    : "";

  const nextState = OrchestratorStateSchema.parse({
    ...state,
    plan: bridgedPlan,
    status: "draft_graph",
    messages: appendMessage(
      state,
      {
        nodeName: "plan_graph",
        role: "assistant",
        content: `Planned ${bridgedPlan.steps.length} graph step(s) with ${bridgedPlan.appModePlan.exposureStrategy} App Mode exposure.${unknownDefinitionSummary}${constrainedDefinitionSummary}${bridgeInsertionSummary}`,
      },
      runtime,
    ),
    checkpoints: appendCheckpoint(
      state,
      {
        nodeName: "plan_graph",
        note: "Graph build plan recorded.",
      },
      runtime,
    ),
  });

  await persistState(runtime, nextState);
  return nextState;
}

function injectBridgeSteps(
  steps: Array<{ stepId: string; summary: string; nodeDefinitionIds: string[]; expectedOutputs: string[] }>,
  registrySnapshot: OrchestratorState["registrySnapshot"],
  bridgeInsertions: Array<{ fromStepId: string; toStepId: string; ids: string[] }>,
): Array<{ stepId: string; summary: string; nodeDefinitionIds: string[]; expectedOutputs: string[] }> {
  if (!registrySnapshot) {
    return steps;
  }

  const nodeSpecByDefinitionId = new Map(
    registrySnapshot.nodeSpecs.map((nodeSpec) => [nodeSpec.source.definitionId, nodeSpec]),
  );
  const bridgedSteps: Array<{ stepId: string; summary: string; nodeDefinitionIds: string[]; expectedOutputs: string[] }> = [];
  let availableKinds = new Set<string>();

  for (const step of steps) {
    const requiredKinds = getStepRequiredKinds(step.nodeDefinitionIds, nodeSpecByDefinitionId);

    if (
      availableKinds.size > 0
      && requiredKinds.length > 0
      && !requiredKinds.includes("any")
      && !requiredKinds.some((kind) => availableKinds.has(kind))
    ) {
      const bridge = findBridgeForKinds(registrySnapshot, availableKinds, requiredKinds);
      if (bridge.length > 0) {
        bridgeInsertions.push({
          fromStepId: bridgedSteps[bridgedSteps.length - 1]?.stepId || "start",
          toStepId: step.stepId,
          ids: bridge,
        });
        bridgedSteps.push({
          stepId: `${step.stepId}-bridge-${bridgeInsertions.length}`,
          summary: `Convert ${Array.from(availableKinds).join("/")} into ${requiredKinds.join("/")} for ${step.summary}`,
          nodeDefinitionIds: bridge,
          expectedOutputs: requiredKinds,
        });
        availableKinds = getStepOutputKinds(bridge, nodeSpecByDefinitionId);
      }
    }

    bridgedSteps.push(step);
    const outputKinds = getStepOutputKinds(step.nodeDefinitionIds, nodeSpecByDefinitionId);
    if (outputKinds.size > 0) {
      availableKinds = outputKinds;
    }
  }

  return bridgedSteps;
}

function findBridgeForKinds(
  registrySnapshot: OrchestratorState["registrySnapshot"],
  fromKinds: Set<string>,
  requiredKinds: string[],
): string[] {
  if (!registrySnapshot) {
    return [];
  }

  for (const fromKind of fromKinds) {
    for (const toKind of requiredKinds) {
      const bridgeIds = getBridgeDefinitionIdsForKinds(registrySnapshot, fromKind as any, toKind as any, 1);
      if (bridgeIds.length > 0) {
        return bridgeIds;
      }
    }
  }

  return [];
}

function getStepRequiredKinds(
  definitionIds: string[],
  nodeSpecByDefinitionId: Map<string, any>,
): string[] {
  return Array.from(new Set(
    definitionIds.flatMap((definitionId) => nodeSpecByDefinitionId.get(definitionId)?.capabilities?.ioProfile?.requiredInputKinds || []),
  ));
}

function getStepOutputKinds(
  definitionIds: string[],
  nodeSpecByDefinitionId: Map<string, any>,
): Set<string> {
  return new Set(
    definitionIds.flatMap((definitionId) => nodeSpecByDefinitionId.get(definitionId)?.capabilities?.ioProfile?.outputKinds || []),
  );
}
