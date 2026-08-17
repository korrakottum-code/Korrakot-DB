-- แท็กกลุ่มโปรโมชั่นต่อ "ชิ้นครีเอทีฟ" (เช่น PF02-0368) — ใช้แยกแอดในหมวดบริการเดียวกัน
-- (เช่น ฟิลเลอร์) ตามราคา/แคมเปญโปรโมชั่นจริงที่ทีมตั้งเอง (เช่น "2990", "11990", "1990")
-- เพราะราคาไม่ได้ถูกเข้ารหัสไว้ในชื่อแอด ต้องให้ทีมติดแท็กเอง
CREATE TABLE IF NOT EXISTS creative_promo_group (
  group_key TEXT PRIMARY KEY,
  promo_group TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
