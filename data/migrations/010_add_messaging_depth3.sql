-- เพิ่มคอลัมน์ depth3 ให้ ad_daily_metrics — เก็บ Meta action type
-- onsite_conversion.messaging_user_depth_3_message_send (ลูกค้าส่งข้อความครบ 3 ครั้งในเธรด)
--
-- ใช้แยก "ทักแล้วเงียบ/บอทตอบเอง" (มี inbox แต่ไม่มี depth3) ออกจาก "คุยจริง"
-- ดึงจาก actions field เดียวกับที่ใช้ดึง inbox อยู่แล้ว ไม่ต้องยิง Meta เพิ่ม (ดู lib/meta.ts)
ALTER TABLE ad_daily_metrics ADD COLUMN IF NOT EXISTS depth3 integer NOT NULL DEFAULT 0;
