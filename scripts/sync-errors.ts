/**
 * ดู error log ของงานเบื้องหลังจาก terminal (อีกทางคือเปิด /api/sync-errors ในเบราว์เซอร์)
 * Run: npm run sync-errors
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { readSyncErrors } from "../lib/insights-store";

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL is not set — add it to .env.local first (see README.md).");
    process.exit(1);
  }

  const errors = await readSyncErrors(100);
  if (errors.length === 0) {
    console.log("ไม่มี error ในบันทึก — งานเบื้องหลังทั้งหมดผ่านเรียบร้อย");
    process.exit(0);
  }

  console.log(`${errors.length} รายการล่าสุด (เก็บย้อนหลัง 30 วัน):\n`);
  for (const e of errors) {
    const when = new Date(e.occurredAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
    const who = e.accountName || e.accountId || "-";
    console.log(`[${when}] ${e.source} · ${who}\n  ${e.message}\n`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
