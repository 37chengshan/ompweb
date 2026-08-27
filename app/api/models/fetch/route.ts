import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const { apiKey, headers = {} } = body;
    let { baseUrl } = body;

    if (!baseUrl || typeof baseUrl !== "string") {
      return NextResponse.json({ error: "Missing or invalid baseUrl" }, { status: 400 });
    }

    // Normalize baseUrl: remove trailing slashes
    baseUrl = baseUrl.trim().replace(/\/+$/, "");

    // Prepare candidate endpoints to probe
    const candidateUrls = [
      `${baseUrl}/models`,
      `${baseUrl}/v1/models`,
      `${baseUrl}/api/v1/models`,
      `${baseUrl}/api/tags`, // Ollama
    ];

    const requestHeaders: Record<string, string> = {
      "User-Agent": "ompweb/0.3.5",
      Accept: "application/json",
      ...headers,
    };

    if (apiKey && typeof apiKey === "string" && apiKey.trim()) {
      requestHeaders["Authorization"] = `Bearer ${apiKey.trim()}`;
    }

    let rawData: { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> } | null = null;
    let successfulUrl = "";

    for (const url of candidateUrls) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: requestHeaders,
          signal: AbortSignal.timeout(6000),
        });

        if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json && (Array.isArray(json.data) || Array.isArray(json.models) || Array.isArray(json))) {
            rawData = json;
            successfulUrl = url;
            break;
          }
        }
      } catch {
        // try next endpoint candidate
      }
    }

    if (!rawData) {
      return NextResponse.json({
        error: `Failed to fetch models from ${baseUrl}. Please check baseUrl, apiKey, and network proxy.`,
      }, { status: 502 });
    }

    // Parse model items from various API formats (OpenAI, Ollama, OpenRouter, etc.)
    const models: Array<{ id: string; name?: string; contextWindow?: number; maxTokens?: number }> = [];

    if (Array.isArray(rawData.data)) {
      // OpenAI / OpenRouter format: { data: [ { id: "gpt-4o", ... } ] }
      for (const item of rawData.data) {
        if (item && item.id && typeof item.id === "string") {
          models.push({
            id: item.id,
            name: typeof item.name === "string" ? item.name : item.id,
            contextWindow: typeof item.context_length === "number" ? item.context_length : (typeof item.contextWindow === "number" ? item.contextWindow : undefined),
            maxTokens: typeof item.max_tokens === "number" ? item.max_tokens : (typeof item.maxTokens === "number" ? item.maxTokens : undefined),
          });
        }
      }
    } else if (Array.isArray(rawData.models)) {
      // Ollama format: { models: [ { name: "llama3:latest", ... } ] }
      for (const item of rawData.models) {
        const id = item.name || item.model || item.id;
        if (id && typeof id === "string") {
          models.push({
            id,
            name: id,
          });
        }
      }
    } else if (Array.isArray(rawData)) {
      for (const item of rawData) {
        const id = typeof item === "string" ? item : item?.id || item?.name;
        if (id && typeof id === "string") {
          models.push({
            id,
            name: id,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      endpoint: successfulUrl,
      count: models.length,
      models,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
