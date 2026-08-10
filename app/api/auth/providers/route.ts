import { type OmpLoginProvider, runUtilityCommand } from "@/lib/omp/rpc-utility";

export const dynamic = "force-dynamic";

// Login-capable providers via the omp RPC get_login_providers command. This is
// omp's own /login list (OAuth subscriptions plus key-creation flows), so no
// hardcoded exclusions or display-name overrides are needed anymore.
export async function GET() {
  try {
    const { providers } = await runUtilityCommand<{ providers: OmpLoginProvider[] }>(
      { type: "get_login_providers" },
      30_000,
    );
    const result = providers
      .filter((p) => p.available !== false)
      .map((p) => ({
        id: p.id,
        name: p.name,
        usesCallbackServer: false,
        loggedIn: p.authenticated,
      }));
    return Response.json({ providers: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ providers: [], error: message }, { status: 500 });
  }
}
