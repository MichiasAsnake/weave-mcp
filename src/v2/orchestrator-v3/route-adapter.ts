import { validateGraph } from "../validate/index.ts";
import { compileWorkflowFromRequest } from "../compiler/graph-compiler.ts";
import type { NormalizedRegistrySnapshot } from "../registry/types.ts";

export function runCompilerRouteTurn(args: {
  userRequest: string;
  registry: NormalizedRegistrySnapshot;
}) {
  return runCompilerRouteTurnAsync(args);
}

export async function runCompilerRouteTurnAsync(args: {
  userRequest: string;
  registry: NormalizedRegistrySnapshot;
}) {
  const result = await compileWorkflowFromRequest(args.userRequest, {
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
          status: result.status,
          intent: result.intent,
          error,
          questions: result.questions,
          promptDraft: result.promptDraft,
          trace: result.trace,
        },
      },
    };
  }

  const validation = result.graph ? validateGraph(result.graph, args.registry) : null;

  return {
    ok: true as const,
    status: 200,
    body: {
      ok: true,
      data: {
        mode: "compiler",
        status: result.status,
        intent: result.intent,
        plan: result.plan,
        compiledGraph: result.graph,
        promptDraft: result.promptDraft,
        questions: result.questions,
        explanation: result.explanation,
        validationResult: validation,
        workingGraphNodeTypes: result.graph ? result.graph.nodes.map((node) => node.nodeType) : [],
        trace: result.trace,
      },
    },
  };
}
