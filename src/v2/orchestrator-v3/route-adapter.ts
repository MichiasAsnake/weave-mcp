import { validateGraph } from "../validate/index.ts";
import { compileWorkflowFromRequest } from "../compiler/graph-compiler.ts";
import type { NormalizedRegistrySnapshot } from "../registry/types.ts";

export function runCompilerRouteTurn(args: {
  userRequest: string;
  registry: NormalizedRegistrySnapshot;
}) {
  const result = compileWorkflowFromRequest(args.userRequest, {
    registry: args.registry,
  });

  if (result.ok === false) {
    const error = result.error;
    return {
      ok: false as const,
      status: 500,
      body: {
        ok: false,
        failedAtNode: "compiler",
        error: error.message,
        data: {
          mode: "compiler",
          intent: result.intent,
          error,
          trace: result.trace,
        },
      },
    };
  }

  const validation = validateGraph(result.graph, args.registry);

  return {
    ok: true as const,
    status: 200,
    body: {
      ok: true,
      data: {
        mode: "compiler",
        status: validation.ok ? "complete" : "failed",
        intent: result.intent,
        plan: result.plan,
        validationResult: validation,
        workingGraphNodeTypes: result.graph.nodes.map((node) => node.nodeType),
        trace: result.trace,
      },
    },
  };
}
