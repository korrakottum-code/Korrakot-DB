-- บันทึกข้อผิดพลาดจากงานเบื้องหลังทั้งหมด (sync, กวาดชื่อแอด ฯลฯ) ลงถาวร
-- เพราะงานพวกนี้รันหลังส่งคำตอบไปแล้ว ไม่มีหน้าจอให้แสดง error — ถ้าไม่เก็บจะหายเงียบ
-- ดูย้อนหลัง: เปิด /api/sync-errors ในเบราว์เซอร์ หรือ npm run sync-errors
create table if not exists sync_error_log (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  source       text not null,
  account_id   text,
  account_name text,
  message      text not null
);

create index if not exists sync_error_log_occurred_idx on sync_error_log (occurred_at desc);
