/** Minimal model-scope guard for native `enabledModels` settings. */

export interface ModelScopeCandidate {
  provider: string;
  id: string;
}

const THINKING_LEVEL_SUFFIXES = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function hasGlob(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

function exactMatches(pattern: string, models: readonly ModelScopeCandidate[]): ModelScopeCandidate[] {
  const normalized = pattern.toLocaleLowerCase();
  const qualified = models.filter((model) => `${model.provider}/${model.id}`.toLocaleLowerCase() === normalized);
  return qualified.length > 0 ? qualified : models.filter((model) => model.id.toLocaleLowerCase() === normalized);
}

/** Reject bare exact selectors that could resolve to different providers. */
export function assertNoAmbiguousModelScopes(
  patterns: readonly string[] | undefined,
  models: readonly ModelScopeCandidate[],
): void {
  if (!Array.isArray(patterns)) return;
  for (const rawPattern of patterns) {
    if (typeof rawPattern !== "string") continue;
    const pattern = rawPattern.trim();
    if (!pattern || hasGlob(pattern)) continue;
    let matches = exactMatches(pattern, models);
    const colonIndex = pattern.lastIndexOf(":");
    const suffix = colonIndex >= 0 ? pattern.slice(colonIndex + 1) : "";
    if (matches.length === 0 && colonIndex >= 0 && THINKING_LEVEL_SUFFIXES.has(suffix)) {
      matches = exactMatches(pattern.slice(0, colonIndex), models);
    }
    if (matches.length <= 1) continue;
    const references = matches
      .map((model) => `${model.provider}/${model.id}`)
      .sort()
      .join(", ");
    throw new Error(
      `Ambiguous enabledModels entry "${pattern}" matches multiple models: ${references}. Use provider/modelId.`,
    );
  }
}
