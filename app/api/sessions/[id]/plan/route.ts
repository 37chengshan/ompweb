import { NextResponse } from "next/server";
import { openSync, readSync, statSync, closeSync } from "fs";
import { dirname } from "path";
import { StringDecoder } from "string_decoder";
import { resolveSessionPathOr404, apiErrorResponse } from "@/lib/api-utils";
import { resolvePlanArtifact } from "@/lib/plan-reader";
import { allowFileRoot } from "@/lib/file-access";

export const dynamic = "force-dynamic";

const MAX_PLAN_BYTES = 256 * 1024;

/**
 * GET /api/sessions/[id]/plan
 * Returns the session's omp plan artifact: whether it ran in plan mode and the
 * canonical plan markdown (bounded) if one exists. Only the first
 * MAX_PLAN_BYTES of the file are read, cut on a UTF-8 character boundary.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const resolved = await resolveSessionPathOr404(id);
    if ("response" in resolved) return resolved.response;

    const artifact = resolvePlanArtifact(resolved.filePath);
    let plan: string | null = null;
    let truncated = false;
    if (artifact.planPath) {
      // The plan markdown lives in the session's local/ dir, outside the
      // normal file allowlist — authorize that directory so the sidebar file
      // viewer can open the .md directly (the canonical "open the document"
      // path the composer pill uses).
      allowFileRoot(dirname(artifact.planPath));
      try {
        const size = statSync(artifact.planPath).size;
        const fd = openSync(artifact.planPath, "r");
        try {
          const readLen = Math.min(size, MAX_PLAN_BYTES + 4);
          const buf = Buffer.alloc(readLen);
          const bytes = readSync(fd, buf, 0, readLen, 0);
          const decoder = new StringDecoder("utf8");
          plan = decoder.write(buf.subarray(0, bytes)) + decoder.end();
          truncated = size > MAX_PLAN_BYTES;
        } finally {
          closeSync(fd);
        }
      } catch {
        // Plan file vanished between discovery and read — return without it.
      }
    }

    return NextResponse.json({
      planModeActive: artifact.planModeActive,
      plan,
      planFile: artifact.planPath,
      truncated,
    });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
