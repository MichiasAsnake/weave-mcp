import { NextResponse } from "next/server";
import assetStoreModule from "../../../../src/asset-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const { readStoredAsset } = assetStoreModule;

export async function GET(_request, context) {
  try {
    const { id } = context.params;
    const asset = await readStoredAsset(String(id));

    return new NextResponse(asset.buffer, {
      status: 200,
      headers: {
        "Content-Type": asset.metadata.contentType,
        "Content-Length": String(asset.metadata.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `inline; filename="${asset.metadata.originalName}"`,
      },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Asset not found.",
      },
      {
        status: 404,
      },
    );
  }
}
