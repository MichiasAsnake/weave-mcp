import { NextResponse } from "next/server";
import assetStoreModule from "../../../src/asset-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { saveUploadedAsset } = assetStoreModule;

export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json(
        {
          ok: false,
          error: "A file field named `file` is required.",
        },
        {
          status: 400,
        },
      );
    }

    const stored = await saveUploadedAsset(file, {
      origin: request.nextUrl.origin,
    });

    return NextResponse.json({
      ok: true,
      data: stored,
    });
  } catch (error) {
    return NextResponse.json(
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
