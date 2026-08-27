import { NextResponse } from "next/server";
import { readFileSync, statSync } from "fs";
import { resolveSessionPathOr404, apiErrorResponse } from "@/lib/api-utils";
import { resolvePlanArtifact } from "@/lib/plan-reader";

export const dynamic = "force-dynamic";

const MAX_PLAN_BYTES = 256 * 1024;

/**
 * GET /api/sessions/[id]/plan
 * Returns the session's omp plan artifact: whether it ran in plan mode and the
 * canonical plan markdown (bounded) if one exists.
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
      try {
        if (statSync(artifact.planPath).size > MAX_PLAN_BYTES) {
          plan = readFileSync(artifact.planPath, "utf8").slice(0, MAX_PLAN_BYTES);
          truncated = true;
        } else {
          plan = readFileSync(artifact.planPath, "utf8");
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
