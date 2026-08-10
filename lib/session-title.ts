/**
 * Session title derivation. omp auto-generates titles itself (persisted in the
 * fixed-width title slot), so unlike pi-web there is no in-process LLM title
 * run here — the auto-name endpoint returns the stored/live title when one
 * exists and otherwise derives a fallback from the first user message.
 */

const MAX_DERIVED_TITLE_LENGTH = 60;

/** First-line, control-character-free, whitespace-collapsed view of a title. */
export function sanitizeSessionTitle(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const firstLine = value.split(/\r?\n/)[0] ?? "";
  const stripped = firstLine.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  return stripped.length > 0 ? stripped : undefined;
}

/**
 * Derive a fallback title from a session's first user message: first line,
 * truncated to ~60 characters by code points. Returns null when the message
 * has no usable text (e.g. "(no messages)").
 */
export function deriveSessionTitleFromFirstMessage(firstMessage: string | undefined): string | null {
  if (!firstMessage || firstMessage === "(no messages)") return null;
  const sanitized = sanitizeSessionTitle(firstMessage);
  if (!sanitized || !/[\p{L}\p{N}]/u.test(sanitized)) return null;

  const characters = Array.from(sanitized);
  if (characters.length <= MAX_DERIVED_TITLE_LENGTH) return sanitized;
  return `${characters.slice(0, MAX_DERIVED_TITLE_LENGTH).join("").trimEnd()}…`;
}
