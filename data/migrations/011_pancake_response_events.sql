-- เก็บ "เหตุการณ์ตอบแชท" ของ Pancake แบบถาวร — Pancake ไม่มี API ให้ query ตามช่วงวันที่
-- ตรงๆ มีแต่ "บทสนทนาล่าสุด N รายการ" ต่อเพจ ถ้าไม่บันทึกไว้เองตอนที่ข้อมูลยังอยู่ในหน้าต่างนั้น
-- ข้อมูลจะหายไปถาวรตามรอบ sync ถัดไป (ดู lib/pancake.ts extractResponseEvents,
-- app/api/cron/pancake-sync/route.ts, scripts/sync-pancake-events.ts)
--
-- primary key (page_id, conversation_id) — sync ซ้ำได้ปลอดภัย ถ้าบทสนทนาเดิมมีคนตอบเปลี่ยน
-- (หรือ Pancake แก้ seen_at ย้อนหลัง) แถวจะถูกอัปเดตทับ ไม่ใช่เพิ่มซ้ำ
create table if not exists pancake_response_events (
  page_id             text not null,
  page_name           text not null,
  conversation_id     text not null,
  admin_id            text not null,
  admin_name          text not null,
  gap_minutes         double precision not null,
  customer_message_at timestamptz not null,
  responded_at        timestamptz not null,
  synced_at           timestamptz not null default now(),
  primary key (page_id, conversation_id)
);

-- ใช้กรองตามช่วงวันที่ (Asia/Bangkok) ตอน query ย้อนหลัง
create index if not exists pancake_response_events_customer_msg_idx
  on pancake_response_events (customer_message_at);
