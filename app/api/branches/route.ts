import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireInternalApiAuth } from "@/lib/api-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG_PATH = path.join(process.cwd(), "data", "branch-config.json");

interface BranchEntry {
  name: string;
  isTest: boolean;
}

interface BranchConfig {
  branches: Record<string, BranchEntry>;
}

function readConfig(): BranchConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { branches: {} };
  }
}

// GET /api/branches — return all branches. Branches are intentionally read-only
// in the deployed app; updates must go through a reviewed Pull Request.
export async function GET(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  const config = readConfig();
  return NextResponse.json({ ...config, writable: false });
}

// POST /api/branches — disabled in read-only mode.
export async function POST(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  return NextResponse.json(
    { error: "ระบบนี้เป็น Read only — กรุณาแก้ data/branch-config.json ผ่าน Pull Request" },
    { status: 405 }
  );
}

// DELETE /api/branches?code=XXX — disabled in read-only mode.
export async function DELETE(req: NextRequest) {
  const denied = requireInternalApiAuth(req);
  if (denied) return denied;

  return NextResponse.json(
    { error: "ระบบนี้เป็น Read only — กรุณาแก้ data/branch-config.json ผ่าน Pull Request" },
    { status: 405 }
  );
}
