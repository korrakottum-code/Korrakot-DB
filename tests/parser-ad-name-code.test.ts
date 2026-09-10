import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAdName,
  primeParserMaps,
  INVALID_CODE_LABEL,
  NOT_CODED_LABEL,
} from "../lib/parser.ts";

/**
 * กติกาตั้งชื่อแอด: [รหัสสาขา] วรรค [ASSET][PROGRAM][SUB 2 หลัก]-[NO 4 หลัก]
 *  ASSET   = P โปรโมชั่น | C เคสรีวิว | R รีวิว | A awareness
 *  PROGRAM = 1 ตัวอักษร ยกเว้น ALL
 *  SUB     = 2 หลักเท่านั้น
 *  NO      = 4 หลักเท่านั้น
 */

// เทสต์ชุดนี้ใช้ map ที่ hardcode ไว้ (ไม่ prime DB config)
test.beforeEach(() => primeParserMaps(null));

test("ชื่อตรงกติกาอ่านครบทุกส่วน", () => {
  const p = parseAdName("CLS PW01-0228");
  assert.equal(p.status, "ok");
  assert.equal(p.isParsed, true);
  assert.equal(p.isCanonicalName, true);
  assert.equal(p.branch, "เพจหลัก");
  assert.equal(p.asset, "โปรโมชั่น");
  assert.equal(p.program, "กำจัดขน");
  assert.equal(p.sub, "รักแร้");
  assert.equal(p.serviceCode, "W01");
  assert.equal(p.creativeId, "0228");
  assert.equal(p.isSubRegistered, true);
});

test("A = awareness เป็นรหัสประเภทเนื้อหาที่ถูกต้อง", () => {
  const p = parseAdName("CLS AALL00-0017");
  assert.equal(p.status, "ok");
  assert.equal(p.assetCode, "A");
  assert.equal(p.asset, "Awareness");
  assert.equal(p.program, "โปรรวม");

  const filler = parseAdName("CLS AF02-0007");
  assert.equal(filler.status, "ok");
  assert.equal(filler.asset, "Awareness");
  assert.equal(filler.program, "ฟิลเลอร์");
  assert.equal(filler.sub, "ปาก");
});

test("รหัสประเภทเนื้อหามีแค่ P C R A", () => {
  for (const code of ["P", "C", "R", "A"]) {
    assert.equal(parseAdName(`CLS ${code}B00-0001`).status, "ok", code);
  }
  // X ไม่ใช่รหัสประเภทเนื้อหา
  assert.equal(parseAdName("CLS XB00-0001").status, "invalid_code");
});

test("pagelike ถูกจัดเป็นโปรแกรม Pagelike ไม่ใช่ AGELIKE", () => {
  const p = parseAdName("CLS pagelike");
  assert.equal(p.status, "special");
  assert.equal(p.program, "Pagelike");
  assert.equal(p.branch, "เพจหลัก");
  assert.notEqual(p.program, "AGELIKE");

  // มีคำนำหน้าก่อนรหัสสาขาก็ยังต้องได้ Pagelike
  const withPrefix = parseAdName("Page Like / Nara NMA pagelike");
  assert.equal(withPrefix.program, "Pagelike");
  assert.equal(withPrefix.branch, "โคราช");
});

test("แอด HR ถูกจัดเป็นทรัพยากรบุคคล ไม่ใช่ LASS", () => {
  const p = parseAdName("HR Class");
  assert.equal(p.status, "special");
  assert.equal(p.program, "ทรัพยากรบุคคล");
  assert.notEqual(p.program, "LASS");

  assert.equal(parseAdName("HR Class - บัญชี").program, "ทรัพยากรบุคคล");
});

test("หน้าบ้าน กับ IG ยังอ่านได้เหมือนเดิม", () => {
  assert.equal(parseAdName("IG").program, "IG");
  assert.equal(parseAdName("CLS หน้าบ้าน").program, "หน้าบ้าน");
  assert.equal(parseAdName("CLS หน้าบ้าน").branch, "เพจหลัก");
});

test("รหัสโปรแกรมต้องเป็น 1 ตัวอักษรหรือ ALL เท่านั้น", () => {
  for (const name of ["KKG PALLB01-0956", "SNK PALLK01-0190", "BWN PKK01-0190"]) {
    const p = parseAdName(name);
    assert.equal(p.status, "invalid_code", name);
    assert.equal(p.program, INVALID_CODE_LABEL, name);
    // ห้ามสร้างรหัสโปรแกรมปลอมไปโผล่ในตัวกรอง
    assert.equal(p.programCode, "", name);
  }
});

test("เลขคอนเทนต์ต้อง 4 หลัก และหมวดย่อยต้อง 2 หลัก", () => {
  assert.equal(parseAdName("CLS PK01-200").status, "invalid_code");
  assert.equal(parseAdName("UDN PO00-00010").status, "invalid_code");
  assert.equal(parseAdName("CLS PW1-0228").status, "invalid_code");
  assert.equal(parseAdName("CLS PW001-0228").status, "invalid_code");
});

test("รหัสโปรแกรมที่ยังไม่ลงทะเบียนถูกรวมเป็นรหัสไม่ถูก", () => {
  const p = parseAdName("SRN PP00-0005");
  assert.equal(p.status, "invalid_code");
  assert.equal(p.program, INVALID_CODE_LABEL);
});

test("ชื่ออิสระที่ไม่เคยลงรหัสแยกออกจากรหัสผิด", () => {
  for (const name of ["Hifu 990", "Meso fat Red", "Promotion opening - 2"]) {
    const p = parseAdName(name);
    assert.equal(p.status, "not_coded", name);
    assert.equal(p.program, NOT_CODED_LABEL, name);
    assert.equal(p.programCode, "", name);
  }
});

test("ชื่อที่มีคำนำหน้ายังอ่านโปรแกรมได้ แต่ไม่นับว่าตรงกติกา", () => {
  const p = parseAdName("Acne – 30Aug NMA PA00-0026");
  assert.equal(p.status, "ok");
  assert.equal(p.program, "สิว");
  assert.equal(p.branch, "โคราช");
  assert.equal(p.isCanonicalName, false);
});

test("ความถูกต้องของรหัสสาขาวัดจากตารางตั้งค่า ไม่ได้บังคับ 3 ตัวอักษรตายตัว", () => {
  // สาขาที่ลงทะเบียนไว้สั้นกว่า 3 ตัวก็ยังใช้ได้ (HR ใช้งานจริง 157 แอด)
  assert.equal(parseAdName("HR PB00-0001").branch, "ทรัพยากรบุคคล");

  // รหัสยาวกว่า 3 ตัวที่ลงทะเบียนไว้ก็ต้องอ่านออก
  primeParserMaps({
    branches: { KKCX: { name: "สาขาทดสอบ", isTest: false } },
    programs: { F: "ฟิลเลอร์" },
    subs: { F02: "ปาก" },
  });
  try {
    const p = parseAdName("KKCX PF02-0284");
    assert.equal(p.status, "ok");
    assert.equal(p.branch, "สาขาทดสอบ");
    assert.equal(p.isCanonicalName, true);
  } finally {
    primeParserMaps(null);
  }
});

test("หมวดย่อยที่ยังไม่ลงทะเบียนถูกทำเครื่องหมายไว้ แต่ยังรู้ว่าเป็นโปรแกรมอะไร", () => {
  const p = parseAdName("LEI PA01-0197");
  assert.equal(p.status, "ok");
  assert.equal(p.program, "สิว");
  assert.equal(p.isSubRegistered, false);
});

test("แอดที่อ่านรหัสไม่ได้ต้องไม่สร้างชื่อโปรแกรมจากตัวอักษรดิบ", () => {
  const names = ["CLS pagelike", "HR Class", "KKG PALLB01-0956", "Hifu 990"];
  const invented = ["AGELIKE", "LASS", "ALLB", "IFU"];
  for (const name of names) {
    const p = parseAdName(name);
    assert.ok(!invented.includes(p.program), `${name} -> ${p.program}`);
    assert.ok(!invented.includes(p.programCode), `${name} -> ${p.programCode}`);
  }
});

test("โปรแกรมที่เพิ่มจากหน้าตั้งค่ามีผลกับการตรวจรหัส", () => {
  primeParserMaps({
    branches: { CLS: { name: "เพจหลัก", isTest: false } },
    programs: { Y: "โปรแกรมใหม่" },
    subs: { Y00: "รวม" },
  });
  try {
    const p = parseAdName("CLS PY00-0001");
    assert.equal(p.status, "ok");
    assert.equal(p.program, "โปรแกรมใหม่");
    // โปรแกรมเดิมที่ไม่ได้อยู่ในชุดใหม่ ถือว่ายังไม่ลงทะเบียน
    assert.equal(parseAdName("CLS PB00-0001").status, "invalid_code");
  } finally {
    primeParserMaps(null);
  }
});

test("รหัสสาขาเก่า N-BPG ถูกยุบเป็น BPG และถูกทำเครื่องหมายให้ตามไปแก้ชื่อ", () => {
  const p = parseAdName("N-BPG PF02-0284");
  assert.equal(p.status, "ok");
  assert.equal(p.branchCode, "BPG");
  assert.equal(p.branch, "Class Go บางพลี");
  assert.equal(p.program, "ฟิลเลอร์");
  // ชื่อยังใช้รหัสเก่า จึงยังไม่นับว่าตรงกติกา
  assert.equal(p.isCanonicalName, false);

  // รหัสปัจจุบันต้องผ่านเต็ม
  const current = parseAdName("BPG PF02-0284");
  assert.equal(current.branchCode, "BPG");
  assert.equal(current.isCanonicalName, true);
});

test("การยุบรหัสสาขาเก่าทำงานแม้รหัสเก่ายังค้างในตารางตั้งค่า", () => {
  primeParserMaps({
    branches: {
      BPG: { name: "Class Go บางพลี", isTest: false },
      "N-BPG": { name: "Class Go บางพลี", isTest: false },
    },
    programs: { F: "ฟิลเลอร์" },
    subs: { F02: "ปาก" },
  });
  try {
    const p = parseAdName("N-BPG PF02-0284");
    assert.equal(p.branchCode, "BPG");
    assert.equal(p.isCanonicalName, false);
  } finally {
    primeParserMaps(null);
  }
});
