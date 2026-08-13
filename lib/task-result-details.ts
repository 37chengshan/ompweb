import { asNumber, asString, isRecord } from "./type-guards";

/** Settled cost rides `usage.cost` on SingleResult; top-level `cost` is absent.
 * Shared by session-reader (bounded history details) and subagent-history
 * (on-disk roster recovery) — the two copies had drifted on the NaN edge case. */
export function taskResultUsageCost(usage: unknown): number | undefined {
  if (!isRecord(usage)) return undefined;
  const cost = isRecord(usage.cost) ? usage.cost : undefined;
  if (!cost) return undefined;
  const total = asNumber(cost.total);
  if (total !== undefined) return total;
  const input = asNumber(cost.input);
  const output = asNumber(cost.output);
  if (input !== undefined && output !== undefined) return input + output;
  return undefined;
}

/** Retry telemetry: both fields must be present, or the shape is ignored. */
export function taskResultRetryFailure(
  value: unknown,
  truncate?: (text: string) => string,
): { attempt: number; errorMessage: string } | undefined {
  if (!isRecord(value)) return undefined;
  const attempt = asNumber(value.attempt);
  const errorMessage = asString(value.errorMessage);
  if (attempt === undefined || errorMessage === undefined) return undefined;
  return { attempt, errorMessage: truncate ? truncate(errorMessage) : errorMessage };
}

/** Project a `structuredOutput` payload to its documented UI fields only —
 * `data` is arbitrary upstream payload and must never ride bounded responses. */
export function taskResultStructuredOutput(
  value: unknown,
  truncate?: (text: string) => string,
): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const key of ["source", "mode", "status", "error"] as const) {
    const str = asString(value[key]);
    if (str !== undefined) out[key] = truncate ? truncate(str) : str;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
