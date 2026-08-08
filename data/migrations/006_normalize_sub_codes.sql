-- แปลงรหัสหมวดย่อยแบบเลขหลักเดียว (B2) เป็นแบบ 2 หลักตรงกับ ad name จริง (B02)
-- idempotent: รันซ้ำได้ ไม่มีผลกับแถวที่ถูกต้องแล้ว
-- (โค้ดใน lib/parser-config-store.ts ก็รันชุดเดียวกันนี้ตอน ensureSchema เผื่อไม่ได้รัน migration มือ)
DELETE FROM parser_config p
WHERE kind = 'sub' AND code ~ '^[A-Z]+[0-9]$'
  AND EXISTS (
    SELECT 1 FROM parser_config q
    WHERE q.kind = 'sub' AND q.code = regexp_replace(p.code, '^([A-Z]+)([0-9])$', '\10\2')
  );

UPDATE parser_config SET code = regexp_replace(code, '^([A-Z]+)([0-9])$', '\10\2')
WHERE kind = 'sub' AND code ~ '^[A-Z]+[0-9]$';
