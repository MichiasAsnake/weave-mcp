import { z } from "zod";
import { openai } from "@ai-sdk/openai";

import { createOrchestratorGraph } from "../../../../src/v2/orchestrator/graph.ts";
import type { OrchestratorState } from "../../../../src/v2/orchestrator/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RequestBodySchema = z.object({
  userRequest: z.string().min(1),
  sessionId: z.string().min(1).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured.");
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured.");
    }

    const body = RequestBodySchema.parse(await request.json());
    const modelName =
      process.env.ORCHESTRATOR_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4o";

    const { graph } = await createOrchestratorGraph({
      model: openai(modelName),
    });
    const runnableGraph = graph as {
      invoke: (
        input: {
          userRequest: string;
          sessionId?: string;
          maxRevisionCount: number;
        },
        options: {
          configurable: {
            thread_id: string;
          };
        },
      ) => Promise<OrchestratorState>;
    };

    const finalState = await runnableGraph.invoke(
      {
        userRequest: body.userRequest,
        sessionId: body.sessionId,
        maxRevisionCount: 3,
      },
      {
        configurable: {
          thread_id: body.sessionId || `api-v2-agent-${Date.now()}`,
        },
      },
    );

    return Response.json({
      ok: true,
      data: {
        status: finalState.status,
        requestMode: finalState.requestMode ?? null,
        revisionCount: finalState.revisionCount,
        validationResult: finalState.validationResult ?? null,
        workingGraphNodeTypes: (finalState.workingGraph?.nodes || []).map((node) => node.nodeType),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack || "" : "";
    const failedAtMatch = stack.match(/src\/v2\/orchestrator\/nodes\/([a-z-]+)\.ts/);

    return Response.json(
      {
        ok: false,
        failedAtNode: failedAtMatch ? failedAtMatch[1] : null,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
