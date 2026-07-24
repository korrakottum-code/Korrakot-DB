import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireInternalApiAuth } from "@/lib/api-auth";
import type { ChecklistConfig } from "@/lib/creative-checklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_PATH = path.join(process.cwd(), "data", "creative-checklist.json");

function readConfig(): ChecklistConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ChecklistConfig;
  } catch {
    return null;
  }
}

// GET /api/creative-checklist — return the current checklist criteria.
// Read only: criteria updates go through data/creative-checklist.json via Pull Request,
// re-derived every 1-2 weeks from the top-performing creatives on /ads.
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const config = readConfig();
  if (!config) {
    return NextResponse.json({ error: "ไม่พบไฟล์ checklist" }, { status: 500 });
  }
  return NextResponse.json(config);
}
