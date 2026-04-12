import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  return handleRequest(request, context);
}

export async function POST(request, context) {
  return handleRequest(request, context);
}

export async function PUT(request, context) {
  return handleRequest(request, context);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

async function handleRequest(request, context) {
  try {
    const apiRouterModule = await import("../../../src/api-router.js");
    const { routeApiRequest } = apiRouterModule.default || apiRouterModule;
    const params = await context.params;
    const slug = params?.slug || [];
    const pathname = `/${slug.join("/")}`;
    const body =
      request.method === "POST" || request.method === "PUT"
        ? await readJsonBody(request)
        : {};

    const payload = await routeApiRequest(request.method, pathname, body);
    return NextResponse.json(payload, {
      status: 200,
      headers: corsHeaders(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error.message,
        details: error.details || null,
      },
      {
        status: error.statusCode || 400,
        headers: corsHeaders(),
      },
    );
  }
}

async function readJsonBody(request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  };
}
