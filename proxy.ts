import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  INTERNAL_SESSION_COOKIE,
  readInternalAuthConfig,
  verifySessionToken,
} from "@/lib/internal-auth";

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);
// เส้นทางที่มีระบบยืนยันตัวตนของตัวเอง (Bearer key ไม่ใช่ session คุกกี้ทีมงาน) —
// ให้ผ่าน middleware นี้ไปตรวจสิทธิ์ในตัว route เอง ดู lib/external-auth.ts
const EXTERNAL_API_PREFIX = "/api/external/";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

function apiError(message: string, status: number): NextResponse {
  return noStore(NextResponse.json({ error: message }, { status }));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith(EXTERNAL_API_PREFIX)) return noStore(NextResponse.next());

  const auth = readInternalAuthConfig();
  if (!auth.ok) {
    if (pathname.startsWith("/api/")) {
      return apiError("ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า", 503);
    }
    return noStore(new NextResponse("ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแล", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }));
  }

  const session = request.cookies.get(INTERNAL_SESSION_COOKIE)?.value;
  if (!verifySessionToken(session, auth.config)) {
    if (pathname.startsWith("/api/")) {
      return apiError("กรุณาเข้าสู่ระบบ", 401);
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return noStore(NextResponse.redirect(loginUrl));
  }

  return noStore(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
