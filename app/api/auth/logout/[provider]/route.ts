import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// omp has no logout RPC command (modes/rpc/rpc-types.ts) and no non-interactive
// CLI logout subcommand (cli-commands.ts) — credential removal only exists as
// the interactive /logout selector in omp's own TUI, backed by the SQLite
// credential store omp-web must never write.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  return NextResponse.json(
    {
      error:
        `omp-web cannot disconnect "${provider}": omp exposes no logout command outside its own UI. ` +
        "Run `omp` in a terminal and use /logout to remove the credential.",
      code: "logout_unsupported",
    },
    { status: 501 },
  );
}
