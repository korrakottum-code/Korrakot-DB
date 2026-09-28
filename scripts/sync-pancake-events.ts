/**
 * รัน sync เหตุการณ์ตอบแชท Pancake ด้วยมือ (เหมือน endpoint /api/cron/pancake-sync ที่ Vercel
 * Cron เรียกอัตโนมัติทุกวัน) — ใช้ทดสอบ หรือรันเสริมระหว่างวันถ้าอยากได้ข้อมูลถี่กว่ารอบ cron
 *
 * รันได้จากเครื่อง local (อ่าน PANCAKE_ACCESS_TOKEN, POSTGRES_URL จาก .env.local อัตโนมัติ):
 *   npm run sync-pancake-events
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { syncAllPancakeEvents } from "../lib/pancake-store";

async function main() {
  const token = process.env.PANCAKE_ACCESS_TOKEN;
  if (!token) {
    console.error("PANCAKE_ACCESS_TOKEN ไม่ได้ตั้งค่า — เพิ่มใน .env.local ก่อน");
    process.exit(1);
  }
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL ไม่ได้ตั้งค่า — รัน `npm run migrate-insights-db` ก่อน (ดู README.md)");
    process.exit(1);
  }

  console.log("Syncing Pancake response events...");
  const result = await syncAllPancakeEvents(token);
  console.log(`pages ok: ${result.pagesOk}, failed: ${result.pagesFailed.length}, events upserted: ${result.eventsUpserted}`);
  for (const f of result.pagesFailed) {
    console.warn(`  failed: ${f.name} (${f.pageId}): ${f.message}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
