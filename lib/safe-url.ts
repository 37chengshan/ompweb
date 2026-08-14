export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || raw.startsWith("//")) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}
