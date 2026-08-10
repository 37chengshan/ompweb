export interface ModelConfigDraft {
  id?: unknown;
}

export interface ProviderConfigDraft {
  models?: ModelConfigDraft[];
}

export interface ModelsConfigDraft {
  providers?: Record<string, ProviderConfigDraft>;
}

function isUntouchedModelDraft(model: ModelConfigDraft): boolean {
  return Object.entries(model).every(([key, value]) =>
    key === "id" ? typeof value === "string" && value.trim() === "" : value === undefined,
  );
}

/** Excludes only the empty row created by the editor's Add model control. */
export function omitUntouchedModelDrafts<T extends ModelsConfigDraft>(config: T): T {
  if (!config.providers) return config;

  let changed = false;
  const providers: Record<string, ProviderConfigDraft> = {};
  for (const [name, provider] of Object.entries(config.providers)) {
    const models = provider.models;
    if (!models?.some(isUntouchedModelDraft)) {
      providers[name] = provider;
      continue;
    }
    changed = true;
    const completeModels = models.filter((model) => !isUntouchedModelDraft(model));
    providers[name] = { ...provider, models: completeModels.length > 0 ? completeModels : undefined };
  }

  return changed ? { ...config, providers } as T : config;
}
