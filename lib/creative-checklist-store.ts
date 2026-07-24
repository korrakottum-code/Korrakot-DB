import fs from "fs";
import path from "path";
import type { ChecklistConfig } from "@/lib/creative-checklist";

const CONFIG_PATH = path.join(process.cwd(), "data", "creative-checklist.json");

// Server-only reader. The checklist is intentionally read-only at runtime;
// updates must go through data/creative-checklist.json via a reviewed Pull Request.
export function readChecklistConfig(): ChecklistConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ChecklistConfig;
  } catch {
    return null;
  }
}
