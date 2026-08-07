/**
 * สรุปสถิติ "ข้อมูลวันอายุ N วัน ยังถูก Meta ปรับย้อนหลังจริงบ่อยแค่ไหน"
 * (เก็บอัตโนมัติทุกครั้งที่ sync ช่วง recent — ดู lib/insights-store.ts)
 *
 * ใช้ตัดสินใจหด SETTLING_WINDOW_DAYS: ถ้าวันอายุเกิน N วันแทบไม่เปลี่ยน (< 1%)
 * ก็ลดค่าใน lib/insights-store.ts ลงมาที่ N ได้อย่างมีหลักฐาน
 *
 * Run: npm run sync-change-stats
 */
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

async function main() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error("POSTGRES_URL is not set — add it to .env.local first (see README.md).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  try {
    const { rows } = await pool.query<{ age_days: number; observed: string; changed: string; last_observed_at: Date }>(
      `select age_days, observed, changed, last_observed_at from sync_change_stats order by age_days`
    );
    if (rows.length === 0) {
      console.log("ยังไม่มีสถิติ — จะเริ่มสะสมเองทุกครั้งที่ระบบ sync ช่วง 7 วันล่าสุด");
      return;
    }
    console.log("อายุ(วัน) | สังเกต(ครั้ง) | เปลี่ยนจริง | % เปลี่ยน");
    console.log("---------|--------------|------------|----------");
    for (const r of rows) {
      const observed = Number(r.observed);
      const changed = Number(r.changed);
      const pct = observed > 0 ? ((changed / observed) * 100).toFixed(1) : "-";
      console.log(
        `${String(r.age_days).padStart(8)} | ${String(observed).padStart(12)} | ${String(changed).padStart(10)} | ${String(pct).padStart(7)}%`
      );
    }
    console.log(
      "\nถ้าวันอายุเกิน N วันเปลี่ยน < 1% ติดต่อกันหลายพันการสังเกต → ลด SETTLING_WINDOW_DAYS ใน lib/insights-store.ts เหลือ N ได้"
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
