-- สถิติว่าข้อมูลวัน "อายุ N วัน" ยังถูก Meta ปรับย้อนหลังจริงบ่อยแค่ไหน
-- เก็บฟรีทุกครั้งที่ sync ทับช่วง recent (เทียบยอดรวมเก่า-ใหม่ต่อ (บัญชี, วัน))
-- ใช้เป็นหลักฐานตัดสินใจหด SETTLING_WINDOW_DAYS (7 วัน) ให้สั้นลงในอนาคต
-- ดูสรุปได้ด้วย: npm run sync-change-stats
create table if not exists sync_change_stats (
  age_days         integer primary key,
  observed         bigint not null default 0,
  changed          bigint not null default 0,
  last_observed_at timestamptz not null default now()
);
