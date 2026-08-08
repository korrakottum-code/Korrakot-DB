import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAdName,
  getBranchMap,
  getProgramMap,
  getSubMap,
  getTestBranchCodes,
  getTestBranchNames,
  primeParserMaps,
  PROGRAM_MAP,
} from "../lib/parser.ts";

// ล้าง cache หลังทุก test — กัน state รั่วไปไฟล์ test อื่น
function withDbConfig(data: Parameters<typeof primeParserMaps>[0], fn: () => void) {
  primeParserMaps(data);
  try {
    fn();
  } finally {
    primeParserMaps(null);
  }
}

test("parser falls back to hardcoded maps when DB config is not primed", () => {
  primeParserMaps(null);
  assert.equal(getProgramMap().F, PROGRAM_MAP.F);
  assert.ok(getBranchMap().KKC);
});

test("primed DB config overrides program and sub names in parseAdName", () => {
  withDbConfig(
    {
      branches: { KKC: { name: "กังสดาล", isTest: false } },
      // รหัสหมวดย่อยใน DB เก็บแบบเดียวกับ ad name จริง (เลข 2 หลัก เช่น F02, B02)
      programs: { F: "ฟิลเลอร์พรีเมียม", B: "โบท็อกซ์", X: "โปรแกรมใหม่" },
      subs: { F02: "ริมฝีปาก", B02: "กราม" },
    },
    () => {
      const parsed = parseAdName("KKC PF02-0368");
      assert.equal(parsed.program, "ฟิลเลอร์พรีเมียม");
      assert.equal(parsed.sub, "ริมฝีปาก");

      const jaw = parseAdName("KKC PB02-0166");
      assert.equal(jaw.sub, "กราม");

      // โปรแกรมใหม่ที่ไม่เคยมีใน hardcode ก็ต้องรู้จัก
      const newProg = parseAdName("KKC PX01-0001");
      assert.equal(newProg.program, "โปรแกรมใหม่");
    }
  );
});

test("legacy unpadded DB sub keys still resolve (B2 matches ad code PB02)", () => {
  withDbConfig(
    {
      branches: { KKC: { name: "กังสดาล", isTest: false } },
      programs: {},
      subs: { B2: "กราม" },
    },
    () => {
      assert.equal(parseAdName("KKC PB02-0166").sub, "กราม");
    }
  );
});

test("primed DB branches replace file/hardcoded branches entirely", () => {
  withDbConfig(
    {
      branches: {
        ZZZ: { name: "สาขาใหม่จาก DB", isTest: false },
        TST: { name: "สาขาเทส", isTest: true },
      },
      programs: {},
      subs: {},
    },
    () => {
      const map = getBranchMap();
      assert.equal(map.ZZZ, "สาขาใหม่จาก DB");
      // สาขา hardcode เดิมต้องหายไป เพราะ DB เป็นแหล่งความจริง (ลบได้จริง)
      assert.equal(map.KKC, undefined);
      assert.ok(getTestBranchCodes().has("TST"));
      assert.ok(getTestBranchNames().has("สาขาเทส"));

      const parsed = parseAdName("ZZZ PF02-0368");
      assert.equal(parsed.branch, "สาขาใหม่จาก DB");
    }
  );
});

test("empty DB maps fall back per-map (branches from DB, programs from hardcode)", () => {
  withDbConfig(
    { branches: { KKC: { name: "กังสดาล", isTest: false } }, programs: {}, subs: {} },
    () => {
      // programs ว่าง → ใช้ hardcode
      assert.equal(getProgramMap().F, PROGRAM_MAP.F);
      assert.equal(getSubMap().F2, "ปาก");
      // คีย์ hardcode เป็นแบบไม่มีศูนย์ แต่ ad จริงเขียน PF02 — ต้องเจอชื่อได้
      assert.equal(parseAdName("KKC PF02-0368").sub, "ปาก");
    }
  );
});

test("normalizeSubCode pads to two digits matching real ad codes", async () => {
  const { normalizeSubCode } = await import("../lib/parser-config-store.ts");
  assert.equal(normalizeSubCode("B2"), "B02");
  assert.equal(normalizeSubCode("b02"), "B02");
  assert.equal(normalizeSubCode("ALL3"), "ALL03");
  assert.equal(normalizeSubCode("ALL10"), "ALL10");
  assert.equal(normalizeSubCode("F"), "F"); // ไม่มีเลข — คืนตามเดิม
});
