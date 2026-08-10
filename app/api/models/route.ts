import { loadModelsWithCache, withModelRuntimeError, type ModelsData } from "@/lib/models-cache";
import { type OmpModel, runUtilityCommand } from "@/lib/omp/rpc-utility";
import { readDisabledProviders } from "@/lib/omp/model-roles";

export const dynamic = "force-dynamic";

// The omp model registry (auth + models.yml) is global, not per-cwd, so one
// cache entry serves every request. The ?cwd= query parameter is still
// accepted for client compatibility but no longer affects the result.
const MODELS_CACHE_KEY = "global";

const modelNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelEntries(
  a: { id: string; name: string; provider: string },
  b: { id: string; name: string; provider: string }
): number {
  return modelNameCollator.compare(a.name || a.id, b.name || b.id)
    || modelNameCollator.compare(a.provider, b.provider)
    || modelNameCollator.compare(a.id, b.id);
}

// "off" is always a valid selector; the concrete efforts come from the model's
// baked thinking metadata (omp: getSupportedEfforts = reasoning ? efforts : []).
function thinkingLevelsFor(model: OmpModel): string[] {
  if (!model.reasoning) return ["off"];
  return ["off", ...(model.thinking?.efforts ?? [])];
}

// OMP's /fast maps to a priority service tier. These are the provider families
// OMP currently resolves for that control (ModelControls.setFastMode).
function supportsFastMode(model: OmpModel): boolean {
  return model.provider === "anthropic" || model.provider === "openai" || model.provider === "google";
}

async function loadModels(): Promise<ModelsData> {
  const { models: available } = await runUtilityCommand<{ models: OmpModel[] }>(
    { type: "get_available_models" },
    120_000,
  );

  const nameMap = new Map<string, string>();
  const thinkingLevels: Record<string, string[]> = {};
  const modelList = available
    .map((m) => ({ id: m.id, name: m.name, provider: m.provider, thinkingLevels: thinkingLevelsFor(m), supportsFastMode: supportsFastMode(m) }))
    .sort(compareModelEntries);
  const { providers: loginProviders } = await runUtilityCommand<{ providers: Array<{ id: string; name: string; authenticated: boolean }> }>(
    { type: "get_login_providers" },
    30_000,
  );
  const disabledProviders = readDisabledProviders();
  const connectedProviders = loginProviders
    .filter((provider) => provider.authenticated)
    .map((provider) => ({ id: provider.id, name: provider.name, disabled: disabledProviders.has(provider.id) }));
  for (const m of available) {
    const key = `${m.provider}:${m.id}`;
    nameMap.set(key, m.name);
    thinkingLevels[key] = thinkingLevelsFor(m);
  }

  // omp resolves the default model at session start; a --no-session utility
  // process reports it via get_state.
  let defaultModel: { provider: string; modelId: string } | null = null;
  try {
    const state = await runUtilityCommand<{ model?: { provider?: string; id?: string } }>(
      { type: "get_state" },
      30_000,
    );
    const provider = state.model?.provider;
    const modelId = state.model?.id;
    if (provider && modelId && available.some((m) => m.provider === provider && m.id === modelId)) {
      defaultModel = { provider, modelId };
    }
  } catch {
    // Default model is cosmetic — the models list is still useful without it.
  }

  return withModelRuntimeError(
    { models: Object.fromEntries(nameMap), modelList, defaultModel, thinkingLevels, connectedProviders },
    undefined,
  );
}

const EMPTY_MODELS: ModelsData = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
};

export async function GET() {
  try {
    return Response.json(await loadModelsWithCache(MODELS_CACHE_KEY, () => loadModels()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(withModelRuntimeError(EMPTY_MODELS, message));
  }
}
