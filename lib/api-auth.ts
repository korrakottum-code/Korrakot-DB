import { NextRequest, NextResponse } from "next/server";
import {
  INTERNAL_SESSION_COOKIE,
  readInternalAuthConfig,
  verifySessionToken,
} from "@/lib/internal-auth";

export function requireInternalApiAuth(request: NextRequest): NextResponse | null {
  const auth = readInternalAuthConfig();
  if (!auth.ok) {
    return NextResponse.json(
      { error: "ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const session = request.cookies.get(INTERNAL_SESSION_COOKIE)?.value;
  if (!verifySessionToken(session, auth.config)) {
    return NextResponse.json(
      { error: "กรุณาเข้าสู่ระบบ" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return null;
}
