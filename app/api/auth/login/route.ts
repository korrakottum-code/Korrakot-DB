import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_SESSION_COOKIE,
  INTERNAL_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  readInternalAuthConfig,
  safeRedirectPath,
  verifyPassword,
} from "@/lib/internal-auth";
import { getRequestIp, loginRateLimiter } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function jsonError(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "private, no-store", ...headers } }
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.url, request.headers.get("origin"), request.headers.get("host"))) {
    return jsonError("คำขอไม่ถูกต้อง", 403);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError("Content-Type ต้องเป็น application/json", 415);
  }

  const auth = readInternalAuthConfig();
  if (!auth.ok) return jsonError("ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า", 503);

  const ip = getRequestIp(request.headers);
  const rateKey = `login:${ip}`;
  const rate = loginRateLimiter.consume(rateKey, MAX_ATTEMPTS, WINDOW_MS);
  if (!rate.allowed) {
    return jsonError("ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่", 429, {
      "Retry-After": String(rate.retryAfterSeconds),
    });
  }

  let body: { password?: unknown; next?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("ข้อมูลไม่ถูกต้อง", 400);
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length > 256 || !verifyPassword(password, auth.config.password)) {
    return jsonError("รหัสผ่านไม่ถูกต้อง", 401);
  }

  loginRateLimiter.reset(rateKey);
  const response = NextResponse.json({
    ok: true,
    redirectTo: safeRedirectPath(body.next),
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set({
    name: INTERNAL_SESSION_COOKIE,
    value: createSessionToken(auth.config),
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: INTERNAL_SESSION_MAX_AGE_SECONDS,
    priority: "high",
  });
  return response;
}
