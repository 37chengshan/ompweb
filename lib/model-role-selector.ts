/**
 * Model-role selector parsing/serialization helpers.
 *
 * config.yml `modelRoles.<role>` values are OMP model selectors. In omp's own
 * config they are plain `provider/modelId` or bare `modelId` (provider inferred
 * from the active set). omp-web's role editor composes them from the runtime
 * model list, which reports *provider-qualified* models (`provider/modelId`),
 * and a `:effort` suffix for the supported reasoning level.
 *
 * The naive composition `selectedModel + ":" + effort` corrupts any model id
 * that itself contains a slash beyond the first (e.g. a custom provider whose
 * model ids are `org/name`): it appends the effort after the LAST slash,
 * turning `new-provider/poolside/laguna-s-2.1-free` into
 * `new-provider/poolside/laguna-s-2.1-free:xhigh` — which omp cannot resolve
 * (it parses the selector from the right). Splitting on the LAST `:` of the
 * *full* value (not of the raw role string) is what keeps these valid, and it
 * is exactly what these helpers do.
 */

/** Canonical model key used by the editor's runtime list: `provider/modelId`
 * (model ids may themselves contain slashes — only the FIRST slash splits). */
export function splitModelKey(key: string): { provider: string; id: string } | null {
  const slash = key.indexOf("/");
  if (slash <= 0 || slash === key.length - 1) return null;
  return { provider: key.slice(0, slash), id: key.slice(slash + 1) };
}

/** Strip a trailing `:<effort>` (one of omp's known levels) from a selector. */
export function splitEffort(selector: string): { model: string; effort: string } {
  const colon = selector.lastIndexOf(":");
  if (colon <= 0) return { model: selector, effort: "" };
  const effort = selector.slice(colon + 1);
  if (!EFFORT_LEVELS.has(effort)) return { model: selector, effort: "" };
  return { model: selector.slice(0, colon), effort };
}

export const EFFORT_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export interface RoleSelectorParts {
  /** Provider-qualified model key (`provider/modelId`) for the editor's
   * model dropdown; may be empty when the role has no override. */
  modelKey: string;
  /** Reasoning effort without the leading colon; "" = model default. */
  effort: string;
}

/** Parse a persisted role selector into editor parts. Unknown extra segments
 * (third+ slash or a non-effort suffix) are preserved in `modelKey` so a
 * selector omp-web did not write is not silently mangled on the next save. */
export function parseRoleSelector(selector: string | undefined): RoleSelectorParts {
  if (!selector) return { modelKey: "", effort: "" };
  const { model, effort } = splitEffort(selector);
  return { modelKey: model, effort };
}

/** Serialize editor parts back to a persisted selector. Empty model = no
 * override (the role entry is cleared). The effort is only appended when the
 * model is set — never `:effort` on an empty model. */
export function buildRoleSelector(modelKey: string, effort: string): string {
  if (!modelKey) return "";
  return effort ? `${modelKey}:${effort}` : modelKey;
}

/** Whether a persisted role selector still resolves against the live model
 * list (provider/id prefix, model id allows extra slashes). */
export function roleSelectorKnown(selector: string | undefined, knownKeys: ReadonlySet<string>): boolean {
  if (!selector) return true;
  const { model } = splitEffort(selector);
  if (!model) return true;
  return knownKeys.has(model);
}
