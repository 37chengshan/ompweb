import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const OMP_WEB_SESSION_COOKIE = "omp_web_session";
export const OMP_WEB_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function hash(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function equal(left: string, right: string): boolean {
  return timingSafeEqual(hash(left), hash(right));
}

export function isWebPasswordEnabled(password: string | undefined = process.env.OMP_WEB_PASSWORD): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidWebPassword(candidate: string, password = process.env.OMP_WEB_PASSWORD): boolean {
  return isWebPasswordEnabled(password) && equal(candidate, password);
}

export function createWebSession(password: string, now = Date.now()): string {
  const expiresAt = now + OMP_WEB_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `v1.${expiresAt}.${randomBytes(16).toString("base64url")}`;
  const signature = createHmac("sha256", password).update(payload, "utf8").digest("base64url");
  return `${payload}.${signature}`;
}

export function isValidWebSession(session: string | undefined, password = process.env.OMP_WEB_PASSWORD, now = Date.now()): boolean {
  if (!isWebPasswordEnabled(password) || !session) return false;
  const match = /^v1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(session);
  if (!match) return false;

  const expiresAt = Number(match[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const payload = session.slice(0, session.lastIndexOf("."));
  const expected = createHmac("sha256", password).update(payload, "utf8").digest("base64url");
  return equal(match[3], expected);
}
