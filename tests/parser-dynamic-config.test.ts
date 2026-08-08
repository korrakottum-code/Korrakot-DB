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
      programs: { F: "ฟิลเลอร์พรีเมียม", X: "โปรแกรมใหม่" },
      subs: { F2: "ริมฝีปาก" },
    },
    () => {
      const parsed = parseAdName("KKC PF02-0368");
      assert.equal(parsed.program, "ฟิลเลอร์พรีเมียม");
      assert.equal(parsed.sub, "ริมฝีปาก");

      // โปรแกรมใหม่ที่ไม่เคยมีใน hardcode ก็ต้องรู้จัก
      const newProg = parseAdName("KKC PX01-0001");
      assert.equal(newProg.program, "โปรแกรมใหม่");
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
    }
  );
});
