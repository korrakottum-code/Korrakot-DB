import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

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

function writeConfig(config: BranchConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

// GET /api/branches — return all branches
export async function GET() {
  const config = readConfig();
  return NextResponse.json(config);
}

// POST /api/branches — add or update a branch
// Body: { code: string, name: string, isTest?: boolean }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { code, name, isTest } = body as { code?: string; name?: string; isTest?: boolean };

    if (!code || !name) {
      return NextResponse.json({ error: "ต้องระบุ code และ name" }, { status: 400 });
    }

    const upperCode = code.toUpperCase().trim();
    if (!upperCode) {
      return NextResponse.json({ error: "code ไม่ถูกต้อง" }, { status: 400 });
    }

    const config = readConfig();
    config.branches[upperCode] = {
      name: name.trim(),
      isTest: isTest ?? config.branches[upperCode]?.isTest ?? false,
    };
    writeConfig(config);

    return NextResponse.json({ success: true, branches: config.branches });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/branches?code=XXX — delete a branch
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.toUpperCase().trim();

  if (!code) {
    return NextResponse.json({ error: "ต้องระบุ code" }, { status: 400 });
  }

  const config = readConfig();
  if (!config.branches[code]) {
    return NextResponse.json({ error: `ไม่พบสาขา ${code}` }, { status: 404 });
  }

  delete config.branches[code];
  writeConfig(config);

  return NextResponse.json({ success: true, branches: config.branches });
}
