import { randomUUID } from "node:crypto";
import { z } from "zod";
import { openai } from "@ai-sdk/openai";

import { createOrchestratorGraph } from "../../../../src/v2/orchestrator/graph.ts";
import type { OrchestratorState } from "../../../../src/v2/orchestrator/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RequestBodySchema = z.object({
  userRequest: z.string().min(1),
  sessionId: z.string().min(1).optional(),
});

export async function POST(request: Request): Promise<Response> {
  try {
    console.log("[agent] starting orchestrator turn");

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
          data: {
            userRequest: string;
            sessionId?: string;
            maxRevisionCount: number;
          };
        },
        options: {
          recursionLimit?: number;
          configurable: {
            thread_id: string;
          };
        },
      ) => Promise<{ data: OrchestratorState }>;
    };

    const result = await runnableGraph.invoke(
      {
        data: {
          userRequest: body.userRequest,
          sessionId: body.sessionId,
          maxRevisionCount: 3,
        },
      },
      {
        recursionLimit: 50,
        configurable: {
          thread_id: randomUUID(),
        },
      },
    );
    const finalState = result.data;

    console.log("[agent] orchestrator complete", finalState.status);

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
    console.log("[agent] orchestrator failed", failedAtMatch ? failedAtMatch[1] : null, message);

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
