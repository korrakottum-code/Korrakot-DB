-- ตารางตั้งค่า mapping ของ parser (สาขา / โปรแกรม / หมวดย่อย)
-- แก้ไขได้จากหน้า /settings — แทนที่การแก้ hardcode ใน lib/parser.ts ผ่าน PR
CREATE TABLE IF NOT EXISTS parser_config (
  kind TEXT NOT NULL CHECK (kind IN ('branch', 'program', 'sub')),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, code)
);
