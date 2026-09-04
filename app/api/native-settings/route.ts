import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { resolveOmpBin } from "@/lib/omp/omp-cli";
import { hostClient, rustBackendActive } from "@/lib/omp/host-client";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

/**
 * Schema-driven FULL native settings surface (5.1): `omp config list --json`
 * exposes every OMP setting (481 keys) with type/description/redacted and the
 * configured value where one exists. The web UI renders this as a dynamic
 * form (NativeSettingsPanel) and writes through `omp config set/reset` — the
 * OMP CLI stays the single authority, so comment-preserving YAML edits and
 * schema validation never move into omp-web.
 *
 * This is intentionally separate from app/api/omp-settings (the curated YAML
 * subset used by the Settings tab): that surface edits config.yml directly
 * for the fields omp-web surfaces natively; this surface proxies OMP itself.
 */

type RawEntry = { value?: unknown; type?: string; description?: string; redacted?: boolean };

/** Run the omp CLI with an argv array (no shell). Resolves the binary through
 *  the same probe the rest of omp-web uses; a missing binary is a 500 with a
 *  remediation hint instead of a silent empty page. */
async function runOmp(args: string[]): Promise<string> {
  const bin = resolveOmpBin();
  if (!bin) throw new Error("omp binary not found — install omp or set OMP_WEB_OMP_BIN");
  const { stdout } = await execFileAsync(bin, args, {
    timeout: 15_000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

/** Normalize a raw value for the JSON response (redacted values never leak). */
function safeValue(raw: RawEntry): unknown {
  if (raw.redacted === true) return null;
  return raw.value;
}

export async function GET() {
  try {
    const stdout = rustBackendActive()
      ? JSON.stringify(await hostClient.settings.list())
      : await runOmp(["config", "list", "--json"]);
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    const settings: Array<{
      key: string;
      value: unknown;
      type: string;
      description?: string;
      redacted?: boolean;
    }> = [];
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry !== "object" || entry === null) continue;
      const raw = entry as RawEntry;
      settings.push({
        key,
        value: safeValue(raw),
        type: raw.type ?? "unknown",
        ...(typeof raw.description === "string" ? { description: raw.description } : {}),
        ...(raw.redacted === true ? { redacted: true } : {}),
      });
    }
    settings.sort((a, b) => a.key.localeCompare(b.key));
    const path = rustBackendActive()
      ? await hostClient.settings.path().catch(() => null)
      : await ompConfigPath().catch(() => null);
    return NextResponse.json({ settings, path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message, remediation: "Install omp or set OMP_WEB_OMP_BIN, then retry." },
      { status: 500 },
    );
  }
}

/** Write one setting via `omp config set` (value serialized by type). */
export async function PUT(request: Request) {
  try {
    const body = await request.json() as { key?: unknown; value?: unknown };
    if (typeof body.key !== "string" || !body.key.trim() || !/^[A-Za-z0-9._-]+$/.test(body.key)) {
      return NextResponse.json({ error: "Invalid setting key", code: "invalid_key" }, { status: 400 });
    }
    // Strings arrive as-is; booleans/numbers/arrays serialize to their JSON
    // literal (omp config set accepts JSON-encoded values for typed keys).
    const value = body.value;
    const serialized = typeof value === "string"
      ? value
      : value === null
        ? "null"
        : JSON.stringify(value);
    if (rustBackendActive()) {
      const result = await hostClient.settings.set(body.key, serialized);
      return NextResponse.json({ ok: true, output: result.output });
    }
    const stdout = await runOmp(["config", "set", body.key, serialized]);
    return NextResponse.json({ ok: true, output: stdout.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, code: "native_settings_write_failed" }, { status: 500 });
  }
}

/** Reset one setting to OMP's schema default. */
export async function POST(request: Request) {
  try {
    const body = await request.json() as { key?: unknown };
    if (typeof body.key !== "string" || !body.key.trim() || !/^[A-Za-z0-9._-]+$/.test(body.key)) {
      return NextResponse.json({ error: "Invalid setting key", code: "invalid_key" }, { status: 400 });
    }
    if (rustBackendActive()) {
      const result = await hostClient.settings.reset(body.key);
      return NextResponse.json({ ok: true, output: result.output });
    }
    const stdout = await runOmp(["config", "reset", body.key]);
    return NextResponse.json({ ok: true, output: stdout.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, code: "native_settings_reset_failed" }, { status: 500 });
  }
}

async function ompConfigPath(): Promise<string | null> {
  try {
    return (await runOmp(["config", "path"])).trim() || null;
  } catch {
    return null;
  }
}
