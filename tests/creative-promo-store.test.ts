import assert from "node:assert/strict";
import test from "node:test";

// ทดสอบเฉพาะ pure logic ที่ไม่ต้องต่อ Postgres จริง — การ query จริงถูกคุมด้วย
// isPromoGroupWritable() (ตรวจ POSTGRES_URL) ซึ่ง route ใช้ตัดสินใจ อ่าน/เขียนได้ไหม
import { isPromoGroupWritable } from "../lib/creative-promo-store.ts";

test("isPromoGroupWritable reflects POSTGRES_URL presence", () => {
  const original = process.env.POSTGRES_URL;
  try {
    delete process.env.POSTGRES_URL;
    assert.equal(isPromoGroupWritable(), false);
    process.env.POSTGRES_URL = "postgres://example";
    assert.equal(isPromoGroupWritable(), true);
  } finally {
    if (original === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = original;
  }
});
