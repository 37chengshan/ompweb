import { NextResponse } from "next/server";
import { invalidateModelsCache } from "@/lib/models-cache";
import { disposeUtilityRpc } from "@/lib/omp/rpc-utility";
import { readNativeSettings, writeNativeSettings, type NativeSettings } from "@/lib/omp/settings-config";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(readNativeSettings());
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { settings?: NativeSettings };
    if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
      return NextResponse.json({ error: "settings must be an object" }, { status: 400 });
    }
    writeNativeSettings(body.settings);
    if (body.settings.enabledModels !== undefined || body.settings.disabledProviders !== undefined || body.settings.modelProviderOrder !== undefined) {
      invalidateModelsCache();
      disposeUtilityRpc();
    }
    return NextResponse.json({ success: true, settings: readNativeSettings().settings });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 400 });
  }
}
