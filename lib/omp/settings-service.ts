// SettingsService contract + OMP CLI adapter (5.0 doc 07).
//
// Adapter priority (doc 07): 1. Settings Schema RPC (future, feature probe)
//                             2. `omp config ... --json` CLI (OMP ≥18)
//                             3. legacy surgical YAML adapter
//                             4. unsupported (surfaced, never guessed)
//
// Semantics pinned here:
// - CLI runs are argv-array `execFile` — never shell strings;
// - `list` output is schema-driven upstream: value/type/description come from
//   OMP itself, configured credentials are redacted by OMP and MUST NOT be
//   echoed back through this service (redacted ≠ a string value);
// - `reset` writes the OMP schema default (UI label: "Reset to OMP Default");
// - missing metadata stays `unknown` — never inferred.

import { execFile } from "child_process";
import { promisify } from "util";
import { resolveOmpBin } from "./omp-cli";
import { readNativeSettings, type NativeSettings } from "./settings-config";

const execFileAsync = promisify(execFile);

export type SettingsSchemaSource = "rpc" | "cli" | "legacy-yaml" | "unsupported";

export interface SettingsCapability {
  schemaSource: SettingsSchemaSource;
  readable: boolean;
  writable: boolean;
  /** What a reset does; UI must label "Reset to OMP Default" when omp-default. */
  reset: "omp-default" | "none" | "unknown";
  detail?: string;
}

export interface SettingDefinition {
  key: string;
  type: "boolean" | "number" | "string" | "array" | "object" | "unknown";
  description?: string;
  /** True when OMP reports the configured value as a credential. */
  redacted?: true;
  /** Raw upstream entry — never contains a credential value (see parse). */
  source: SettingsSchemaSource;
}

export type OmpConfigListRunner = (file: string, args: string[]) => Promise<{ stdout: string }>;

/** Default CLI runner: argv-array execFile, no shell, 10s cap. */
export const defaultConfigListRunner: OmpConfigListRunner = async (file, args) =>
  execFileAsync(file, args, { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });

/** Test/integration adapters supply their own runner and therefore do not
 * need an omp executable on the current machine. Keep the production runner
 * strict so a missing binary remains a visible capability state. */
function resolveRunnerBin(runner: OmpConfigListRunner): string | null {
  if (runner !== defaultConfigListRunner) return process.env.OMP_WEB_OMP_BIN || "omp";
  return resolveOmpBin();
}

/**
 * Parse `omp config list --json` output. Upstream entries look like
 * `{ "<key>": { "value": ..., "type": "...", "description": "..." , "redacted": true } }`
 * but the parser is tolerant: non-object entries degrade to `unknown` type.
 * Credential values are stripped — only the redacted marker survives.
 */
export function parseOmpConfigList(jsonText: string): { definitions: SettingDefinition[]; redactedKeys: string[] } {
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  const definitions: SettingDefinition[] = [];
  const redactedKeys: string[] = [];
  for (const [key, entry] of Object.entries(parsed)) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const record = entry as Record<string, unknown>;
      const redacted = record.redacted === true;
      const type = normalizeType(record.type);
      definitions.push({
        key,
        type,
        ...(typeof record.description === "string" ? { description: record.description } : {}),
        ...(redacted ? { redacted: true } : {}),
        source: "cli",
      });
      if (redacted) {
        redactedKeys.push(key);
        // Defensive: a credential entry must never carry a value downstream.
        delete (record as { value?: unknown }).value;
      }
      continue;
    }
    definitions.push({ key, type: "unknown", source: "cli" });
  }
  definitions.sort((a, b) => a.key.localeCompare(b.key));
  return { definitions, redactedKeys };
}

function normalizeType(raw: unknown): SettingDefinition["type"] {
  switch (raw) {
    case "boolean":
    case "bool":
      return "boolean";
    case "number":
    case "int":
    case "float":
      return "number";
    case "string":
    case "string_enum":
      return "string";
    case "array":
      return "array";
    case "object":
    case "map":
      return "object";
    default:
      return "unknown";
  }
}

/** Probe the CLI adapter; falls back to the legacy YAML source on failure. */
export async function probeSettingsCapability(runner: OmpConfigListRunner = defaultConfigListRunner): Promise<SettingsCapability> {
  const bin = resolveRunnerBin(runner);
  if (!bin) {
    return { schemaSource: "legacy-yaml", readable: true, writable: true, reset: "none", detail: "omp binary not found — legacy YAML adapter active" };
  }
  try {
    await runner(bin, ["config", "list", "--json"]);
    return { schemaSource: "cli", readable: true, writable: true, reset: "omp-default" };
  } catch (error) {
    return {
      schemaSource: "legacy-yaml",
      readable: true,
      writable: true,
      reset: "none",
      detail: `omp config list failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Normalized registry via the best available adapter (doc 07 priority). */
export async function listSettings(runner: OmpConfigListRunner = defaultConfigListRunner): Promise<{ capability: SettingsCapability; definitions: SettingDefinition[] }> {
  const capability = await probeSettingsCapability(runner);
  if (capability.schemaSource === "cli") {
    const bin = resolveRunnerBin(runner)!;
    try {
      const { stdout } = await runner(bin, ["config", "list", "--json"]);
      const { definitions } = parseOmpConfigList(stdout);
      return { capability, definitions };
    } catch {
      // fall through to legacy
    }
  }
  // Legacy YAML adapter: the curated hand-maintained subset.
  const { settings } = readNativeSettings();
  return { capability, definitions: legacyDefinitions(settings) };
}

function legacyDefinitions(settings: NativeSettings): SettingDefinition[] {
  return Object.entries(settings).map(([key, value]) => ({
    key,
    type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : typeof value === "string" ? "string" : "unknown",
    source: "legacy-yaml" as const,
  }));
}

/**
 * Write through the CLI adapter (argv-array; OMP applies schema defaults on
 * reset). Returns the argv used — call sites must not shell-wrap it.
 */
export async function setOmpSetting(key: string, value: string, runner: OmpConfigListRunner = defaultConfigListRunner): Promise<void> {
  const bin = resolveRunnerBin(runner);
  if (!bin) throw new Error("omp binary not found");
  await runner(bin, ["config", "set", key, value]);
}

export async function resetOmpSetting(key: string, runner: OmpConfigListRunner = defaultConfigListRunner): Promise<void> {
  // OMP `reset` writes the schema default — UI must label "Reset to OMP Default".
  const bin = resolveRunnerBin(runner);
  if (!bin) throw new Error("omp binary not found");
  await runner(bin, ["config", "reset", key]);
}
