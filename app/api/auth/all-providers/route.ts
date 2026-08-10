import { readModelsConfig } from "@/lib/omp/models-config";
import { type OmpLoginProvider, type OmpModel, runUtilityCommand } from "@/lib/omp/rpc-utility";

export const dynamic = "force-dynamic";

// omp exposes no "all known providers" query over RPC, and API keys live in
// its SQLite credential store which omp-web must not touch. What we CAN see is
// which providers currently resolve models (env keys, stored keys, models.yml)
// via get_available_models — so this endpoint lists configured providers only.
// Unconfigured API-key providers cannot be set up from the web UI (see the
// api-key route), so they are intentionally absent.
export async function GET() {
  try {
    const { models } = await runUtilityCommand<{ models: OmpModel[] }>(
      { type: "get_available_models" },
      120_000,
    );
    const { providers: loginProviders } = await runUtilityCommand<{ providers: OmpLoginProvider[] }>(
      { type: "get_login_providers" },
      30_000,
    );

    // OAuth-authenticated providers show in the subscription section instead;
    // custom models.yml providers are managed in the editor tree.
    const oauthAuthenticated = new Set(loginProviders.filter((p) => p.authenticated).map((p) => p.id));
    const loginNames = new Map(loginProviders.map((p) => [p.id, p.name]));
    const customProviders = new Set(Object.keys(readModelsConfig().providers ?? {}));

    const counts = new Map<string, number>();
    for (const model of models) {
      counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
    }

    const result: { id: string; displayName: string; configured: boolean; modelCount: number }[] = [];
    for (const [id, modelCount] of counts) {
      if (oauthAuthenticated.has(id) || customProviders.has(id)) continue;
      result.push({
        id,
        displayName: loginNames.get(id) ?? id,
        configured: true,
        modelCount,
      });
    }
    result.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return Response.json({ providers: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ providers: [], error: message }, { status: 500 });
  }
}
