import { NextResponse } from "next/server";
import { loadSessionFile } from "@/lib/omp/session-files";
import { buildSessionContext } from "@/lib/session-reader";
import { apiErrorResponse, resolveSessionPathOr404 } from "@/lib/api-utils";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const leafId = url.searchParams.get("leafId") ?? undefined;
  const deferThinking = url.searchParams.has("deferThinking");
  const deferToolResultImages = url.searchParams.has("deferMedia");

  try {
    const resolved = await resolveSessionPathOr404(id);
    if ("response" in resolved) return resolved.response;
    const filePath = resolved.filePath;

    const { header, entries, error: loadError } = loadSessionFile(filePath, {
      resolveBlobs: true,
      skipToolResultImages: deferToolResultImages,
    });
    if (loadError === "too_large") {
      return NextResponse.json(
        { error: "Session file is too large to open in omp-web", code: "session_file_too_large" },
        { status: 413 },
      );
    }
    if (!header) {
      return NextResponse.json({ error: "Session file is missing or malformed", code: "session_file_malformed" }, { status: 404 });
    }
    const context = buildSessionContext(entries, leafId, {
      deferThinking,
      deferToolResultImages,
    });

    return NextResponse.json({ context });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
