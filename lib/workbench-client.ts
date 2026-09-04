import { formatApiError } from "@/lib/i18n/api-error";
import type { AgentMessage } from "@/lib/types";

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
  if (!response.ok) throw Object.assign(new Error(body.error || body.code ? formatApiError(body) : `HTTP ${response.status}`), { code: body.code });
  return body as T;
}

export async function createTemporarySession(cwd: string): Promise<string> {
  const response = await fetch("/api/agent/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cwd, type: "ensure_session" }) });
  const data = await readJson<{ sessionId?: string }>(response);
  if (!data.sessionId) throw new Error("Temporary OMP did not return a session id");
  return data.sessionId;
}

export async function fetchBrowserPreview(url: string): Promise<{ html: string; finalUrl?: string }> {
  const response = await fetch("/api/browser-proxy?url=" + encodeURIComponent(url));
  return readJson<{ html: string; finalUrl?: string }>(response);
}

export async function fetchSubagentTranscript(sessionId: string, subagentId: string): Promise<{ messages: AgentMessage[] }> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(subagentId)}?fromByte=0`);
  return readJson<{ messages: AgentMessage[] }>(response);
}
