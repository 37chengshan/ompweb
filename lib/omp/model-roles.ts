import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { isMap, parseDocument, stringify } from "yaml";
import { getAgentDir } from "./paths";
import { isRecord } from "../type-guards";

export type ModelRoles = Record<string, string>;

function configPath(): string {
  return join(getAgentDir(), "config.yml");
}

/** Reads the native OMP role selectors from config.yml without touching other settings. */
export function readModelRoles(): { path: string; roles: ModelRoles } {
  const path = configPath();
  if (!existsSync(path)) return { path, roles: {} };
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  const data = doc.toJS();
  if (!isRecord(data) || !isRecord(data.modelRoles)) return { path, roles: {} };
  return {
    path,
    roles: Object.fromEntries(Object.entries(data.modelRoles).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
  };
}

/** Updates only modelRoles, preserving the user's remaining native OMP config. */
export function writeModelRoles(roles: ModelRoles): void {
  const path = configPath();
  const source = existsSync(path) ? readFileSync(path, "utf8") : "";
  const doc = parseDocument(source);
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  if (doc.contents === null) {
    writeFileSync(temp, stringify({ modelRoles: roles }), "utf8");
  } else {
    if (!isMap(doc.contents)) throw new Error(`${path} must contain a YAML mapping`);
    doc.set("modelRoles", roles);
    writeFileSync(temp, doc.toString(), "utf8");
  }
  renameSync(temp, path);
}

export function readDisabledProviders(): Set<string> {
  const path = configPath();
  if (!existsSync(path)) return new Set();
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  const data = doc.toJS();
  if (!isRecord(data) || !Array.isArray(data.disabledProviders)) return new Set();
  return new Set(data.disabledProviders.filter((provider): provider is string => typeof provider === "string"));
}

/**
 * Drop config.yml entries that reference a provider that no longer exists.
 *
 * Deleting a provider from models.yml leaves the runtime list clean (the
 * models PUT invalidates the cache and recycles the utility process), but
 * config.yml can keep pointing at it: `modelRoles.*` role selectors,
 * `retry.fallbackChains.*` model selectors and `providers.webSearchOrder`
 * entries. omp resolves a role selector by fuzzy-matching provider/model
 * names, so a dangling entry does not hard-fail — it silently resolves to an
 * unrelated model (or an unusable one) instead of the deleted provider's
 * models, which reads as "omp did not sync the deletion".
 *
 * Called after every models.yml provider removal with the full provider-name
 * list that remains. Only exact provider-name prefixes are pruned (a model id
 * like `org/model` under a still-live provider is never touched). Writes are
 * skipped when nothing changed so user files stay byte-identical.
 */
export function pruneConfigProviderRefs(remainingProviders: readonly string[]): void {
  const path = configPath();
  if (!existsSync(path)) return;
  const source = readFileSync(path, "utf8");
  const doc = parseDocument(source);
  if (doc.errors.length > 0 || !isMap(doc.contents)) return;
  const data = doc.toJS();
  if (!isRecord(data)) return;

  const live = new Set(remainingProviders);
  const refsDeletedProvider = (selector: string): boolean => {
    if (!selector) return false;
    const providerPart = selector.split("/")[0];
    if (!providerPart || live.has(providerPart)) return false;
    // Bare model selectors without a provider part are omp-inferred — keep.
    return providerPart !== selector || selector.includes("/");
  };

  let changed = false;
  const roles = isRecord(data.modelRoles) ? data.modelRoles : {};
  const roleEntries = Object.entries(roles).filter((entry): entry is [string, string] =>
    typeof entry[1] === "string" && entry[1].length > 0);
  const keptRoles = roleEntries.filter(([, selector]) => !refsDeletedProvider(selector));
  if (keptRoles.length !== roleEntries.length) {
    if (keptRoles.length === 0) doc.delete("modelRoles");
    else doc.set("modelRoles", Object.fromEntries(keptRoles));
    changed = true;
  }

  const retry = isRecord(data.retry) ? data.retry : {};
  if (isRecord(retry.fallbackChains)) {
    const chains = Object.entries(retry.fallbackChains).filter((entry): entry is [string, string[]] =>
      typeof entry[0] === "string" && Array.isArray(entry[1]) && entry[1].every((v): v is string => typeof v === "string"));
    let chainsChanged = false;
    const nextChains = Object.fromEntries(chains.map(([roleName, chain]) => {
      const next = chain.filter((selector) => !refsDeletedProvider(selector));
      if (next.length !== chain.length) chainsChanged = true;
      return [roleName, next];
    }));
    if (chainsChanged) {
      if (Object.keys(nextChains).length === 0) doc.deleteIn(["retry", "fallbackChains"]);
      else doc.setIn(["retry", "fallbackChains"], nextChains);
      changed = true;
    }
  }

  const providers = isRecord(data.providers) ? data.providers : {};
  if (Array.isArray(providers.webSearchOrder) && providers.webSearchOrder.length > 0) {
    const order = providers.webSearchOrder.filter((value): value is string => typeof value === "string");
    const next = order.filter((name) => live.has(name));
    if (next.length !== order.length) {
      if (next.length === 0) doc.deleteIn(["providers", "webSearchOrder"]);
      else doc.setIn(["providers", "webSearchOrder"], next);
      changed = true;
    }
  }

  if (!changed) return;
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, doc.toString(), "utf8");
  renameSync(temp, path);
}

/** Re-enable a provider after a successful native OMP login. */
export function enableProvider(provider: string): void {
  const path = configPath();
  if (!existsSync(path)) return;
  const doc = parseDocument(readFileSync(path, "utf8"));
  if (doc.errors.length > 0) throw new Error(`${path} is not valid YAML: ${doc.errors[0].message}`);
  if (!isMap(doc.contents)) throw new Error(`${path} must contain a YAML mapping`);
  const data = doc.toJS();
  const disabled = isRecord(data) && Array.isArray(data.disabledProviders)
    ? data.disabledProviders.filter((value): value is string => typeof value === "string")
    : [];
  const next = disabled.filter((value) => value !== provider);
  if (next.length === disabled.length) return;
  doc.set("disabledProviders", next);
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, doc.toString(), "utf8");
  renameSync(temp, path);
}
