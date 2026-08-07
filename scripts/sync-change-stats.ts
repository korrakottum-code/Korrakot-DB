/**
 * สรุปสถิติ "ข้อมูลวันอายุ N วัน ยังถูก Meta ปรับย้อนหลังจริงบ่อยแค่ไหน"
 * (เก็บอัตโนมัติทุกครั้งที่ sync — ดู lib/insights-store.ts)
 *
 * ไม่ต้องรันเพื่อปรับอะไรแล้ว: ระบบเลือกหน้าต่าง settling เองชั่วโมงละครั้ง
 * ผ่าน getEffectiveSettlingWindow() — สคริปต์นี้มีไว้ส่องดูข้อมูลดิบเฉยๆ
 *
 * Run: npm run sync-change-stats
 */
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";

loadEnvConfig(process.cwd());

import { pickSettlingWindow, SETTLING_WINDOW_DAYS } from "../lib/insights-store";

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
    const effective = pickSettlingWindow(
      rows.map((r) => ({ ageDays: r.age_days, observed: Number(r.observed), changed: Number(r.changed) }))
    );
    console.log(
      effective < SETTLING_WINDOW_DAYS
        ? `\nระบบหดหน้าต่างเองแล้ว: sync ซ้ำเฉพาะวันอายุไม่เกิน ${effective} วัน (เพดาน ${SETTLING_WINDOW_DAYS} วัน)`
        : `\nยังใช้หน้าต่างเต็ม ${SETTLING_WINDOW_DAYS} วัน — จะหดเองอัตโนมัติเมื่อสถิติสะสมพอ (สังเกต ≥ 300 ครั้ง/ช่วงอายุ และเปลี่ยน ≤ 1%)`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
