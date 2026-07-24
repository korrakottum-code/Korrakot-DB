import fs from "fs";
import path from "path";
import type { ChecklistConfig } from "@/lib/creative-checklist";

const CONFIG_PATH = path.join(process.cwd(), "data", "creative-checklist.json");

function mondayOnOrBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getTime() + offset * 24 * 60 * 60 * 1000);
  return monday.toISOString().slice(0, 10);
}

// Server-only reader. The checklist is intentionally read-only at runtime;
// updates must go through data/creative-checklist.json via a reviewed Pull Request.
// The checklist refreshes weekly on Mondays, so `lastUpdated` and `version`
// are normalized to the Monday of the update week.
export function readChecklistConfig(): ChecklistConfig | null {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as ChecklistConfig;
    const m = raw.version.match(/^(\d{4}-\d{2}-\d{2})(\.\S+)?$/);
    if (m) {
      const monday = mondayOnOrBefore(m[1]);
      const suffix = m[2] ?? ".v1";
      raw.lastUpdated = monday;
      raw.version = `${monday}${suffix}`;
    }
    return raw;
  } catch {
    return null;
  }
}
