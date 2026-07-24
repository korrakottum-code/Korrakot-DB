import { NextRequest, NextResponse } from "next/server";
import { requireInternalApiAuth } from "@/lib/api-auth";
import { readChecklistConfig } from "@/lib/creative-checklist-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/creative-checklist — return the current checklist criteria.
// Read only: criteria updates go through data/creative-checklist.json via Pull Request,
// re-derived every Monday (weekly) from the top-performing creatives on /ads.
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const config = readChecklistConfig();
  if (!config) {
    return NextResponse.json({ error: "ไม่พบไฟล์ checklist" }, { status: 500 });
  }
  return NextResponse.json(config);
}
