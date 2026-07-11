import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const INTERNAL_SESSION_COOKIE = "korrakot_internal_session";
export const INTERNAL_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const SESSION_VERSION = "v1";

export interface InternalAuthConfig {
  password: string;
  secret: string;
}

export type InternalAuthConfigResult =
  | { ok: true; config: InternalAuthConfig }
  | { ok: false; error: string };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function secureEqual(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function passwordFingerprint(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex").slice(0, 16);
}

export function readInternalAuthConfig(
  env: Record<string, string | undefined> = process.env
): InternalAuthConfigResult {
  const password = env.INTERNAL_DASHBOARD_PASSWORD || "";
  const secret = env.INTERNAL_DASHBOARD_SECRET || "";

  if (password.length < 12) {
    return { ok: false, error: "INTERNAL_DASHBOARD_PASSWORD ต้องมีอย่างน้อย 12 ตัวอักษร" };
  }
  if (secret.length < 32) {
    return { ok: false, error: "INTERNAL_DASHBOARD_SECRET ต้องมีอย่างน้อย 32 ตัวอักษร" };
  }

  return { ok: true, config: { password, secret } };
}

export function verifyPassword(input: string, expected: string): boolean {
  return secureEqual(input, expected);
}

export function createSessionToken(
  config: InternalAuthConfig,
  nowMs = Date.now(),
  maxAgeSeconds = INTERNAL_SESSION_MAX_AGE_SECONDS
): string {
  const expiresAt = Math.floor(nowMs / 1000) + maxAgeSeconds;
  const payload = `${SESSION_VERSION}.${expiresAt}.${passwordFingerprint(config.password)}`;
  const signature = createHmac("sha256", config.secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySessionToken(
  token: string | undefined,
  config: InternalAuthConfig,
  nowMs = Date.now()
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== SESSION_VERSION) return false;

  const [, expiresRaw, fingerprint, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return false;
  if (!secureEqual(fingerprint, passwordFingerprint(config.password))) return false;

  const payload = `${SESSION_VERSION}.${expiresRaw}.${fingerprint}`;
  const expected = createHmac("sha256", config.secret).update(payload).digest("base64url");
  return secureEqual(signature, expected);
}

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.trim();
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/login")) return "/";
  if (path.includes("\\")) return "/";
  if (path.includes("\r") || path.includes("\n")) return "/";
  return path;
}
