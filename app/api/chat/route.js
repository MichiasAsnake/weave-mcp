export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  try {
    const payload = await request.json();
    const chatAgentModule = await import("../../../src/chat-agent.js");
    const { runWorkbenchChat } = chatAgentModule.default || chatAgentModule;
    const data = await runWorkbenchChat(payload || {});

    return Response.json({
      ok: true,
      data,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error.message,
      },
      {
        status: 400,
      },
    );
  }
}
