// Hardcoded fallback branch map
export const BRANCH_MAP: Record<string, string> = {
  KKC: "กังสดาล",
  UDN: "อุดร",
  NMA: "โคราช",
  UBN: "อุบล",
  MKM: "มหาสารคาม",
  BRM: "บุรีรัมย์",
  BSN: "บางแสน",
  RET: "ร้อยเอ็ด",
  KKU: "หอกาญ",
  CPM: "ชัยภูมิ",
  SSK: "ศรีสะเกษ",
  AMT: "อมตะ",
  SRN: "สุรินทร์",
  CCO: "ฉะเชิงเทรา",
  NPM: "นครพนม",
  CTI: "จันทบุรี",
  RYG: "ระยอง",
  CLS: "เพจหลัก",
  SPC: "สหพัฒน์",
  SNK: "สกลนคร",
  KSN: "กาฬสินธุ์",
  NKI: "หนองคาย",
  BWN: "บ่อวิน",
  CRI: "เชียงราย",
  KKG: "Class Go กัง",
  LAD: "ลาดกระบัง",
  CHG: "Class Go ชุมแพ",
  BPG: "Class Go บางพลี",
  LEI: "เลย",
  HR: "ทรัพยากรบุคคล",
};

/* ─── Dynamic branch config from JSON file ─── */

interface BranchEntry {
  name: string;
  isTest: boolean;
}

interface BranchConfig {
  branches: Record<string, BranchEntry>;
}

/* ─── Dynamic config from Postgres (แก้ได้จากหน้า /settings) ─── */

export interface ParserConfigData {
  branches: Record<string, BranchEntry>;
  programs: Record<string, string>;
  subs: Record<string, string>;
}

// cache ที่ hydrateParserConfig() (lib/parser-config-store) เติมให้ฝั่ง server
// — เมื่อมีข้อมูลจาก DB จะใช้เป็นแหล่งความจริงแทน hardcode/JSON ทั้งชุด
// (จึงลบรายการที่เคย hardcode ได้จริง) ฝั่ง client cache เป็น null เสมอ → ใช้ fallback เดิม
let dbParserConfig: ParserConfigData | null = null;

/** เติม/ล้าง cache config จาก DB — เรียกจาก lib/parser-config-store เท่านั้น */
export function primeParserMaps(data: ParserConfigData | null): void {
  dbParserConfig = data;
}

// parseAdName (via getBranchMap) can run on every row of a wide historical
// read — tens of thousands of times per request once insights are served
// from the persistent store instead of bounded by a live Meta fetch. A
// synchronous disk read on every call doesn't scale to that, so cache the
// parsed config for a short window; branch-config.json only changes via a
// PR + redeploy anyway, which starts a fresh process (and fresh cache).
const BRANCH_CONFIG_CACHE_MS = 60_000;
let branchConfigCache: { value: BranchConfig; expiresAt: number } | null = null;

function readBranchConfig(): BranchConfig {
  // Only run on server side
  if (typeof window !== "undefined") return { branches: {} };
  if (branchConfigCache && branchConfigCache.expiresAt > Date.now()) {
    return branchConfigCache.value;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    const configPath = path.join(process.cwd(), "data", "branch-config.json");
    const raw = fs.readFileSync(configPath, "utf-8");
    const value = JSON.parse(raw);
    branchConfigCache = { value, expiresAt: Date.now() + BRANCH_CONFIG_CACHE_MS };
    return value;
  } catch {
    return { branches: {} };
  }
}

/** อ่าน branch-config.json ตรงๆ (ไว้ให้ parser-config-store ใช้ seed ข้อมูลรอบแรก) */
export function readBranchConfigFile(): BranchConfig {
  return readBranchConfig();
}

/** branch map ที่มีผลจริง: DB (ถ้า hydrate แล้ว) > JSON > hardcode */
function effectiveBranchEntries(): Record<string, BranchEntry> {
  if (dbParserConfig && Object.keys(dbParserConfig.branches).length > 0) {
    return dbParserConfig.branches;
  }
  const config = readBranchConfig();
  const merged: Record<string, BranchEntry> = {};
  for (const [code, name] of Object.entries(BRANCH_MAP)) merged[code] = { name, isTest: false };
  for (const [code, entry] of Object.entries(config.branches)) merged[code] = entry;
  return merged;
}

/**
 * Returns the effective branch map (DB config > JSON config > hardcoded).
 */
export function getBranchMap(): Record<string, string> {
  const entries = effectiveBranchEntries();
  const map: Record<string, string> = {};
  for (const [code, entry] of Object.entries(entries)) map[code] = entry.name;
  return map;
}

/**
 * Returns a Set of branch codes that are marked as test branches.
 */
export function getTestBranchCodes(): Set<string> {
  const testCodes = new Set<string>();
  for (const [code, entry] of Object.entries(effectiveBranchEntries())) {
    if (entry.isTest) testCodes.add(code);
  }
  return testCodes;
}

/**
 * Returns a Set of branch names that are marked as test branches.
 */
export function getTestBranchNames(): Set<string> {
  const testNames = new Set<string>();
  for (const [, entry] of Object.entries(effectiveBranchEntries())) {
    if (entry.isTest) testNames.add(entry.name);
  }
  return testNames;
}

/** program map ที่มีผลจริง: DB (ถ้า hydrate แล้ว) > hardcode */
export function getProgramMap(): Record<string, string> {
  if (dbParserConfig && Object.keys(dbParserConfig.programs).length > 0) {
    return dbParserConfig.programs;
  }
  return PROGRAM_MAP;
}

/** sub map ที่มีผลจริง: DB (ถ้า hydrate แล้ว) > hardcode */
export function getSubMap(): Record<string, string> {
  if (dbParserConfig && Object.keys(dbParserConfig.subs).length > 0) {
    return dbParserConfig.subs;
  }
  return SUB_MAP;
}

// Asset (campaign type) codes — มีแค่ 4 ตัวนี้เท่านั้นตามกติกาตั้งชื่อ
export const ASSET_MAP: Record<string, string> = {
  P: "โปรโมชั่น",
  R: "รีวิว",
  C: "เคสรีวิว",
  A: "Awareness",
};

// Program codes
export const PROGRAM_MAP: Record<string, string> = {
  B: "โบท็อกซ์",
  F: "ฟิลเลอร์",
  A: "สิว",
  M: "แฟต/หน้าใส",
  H: "ไฮฟุ",
  S: "ผิว",
  W: "กำจัดขน",
  ALL: "โปรรวม",
  T: "ทรีทเม้นท์",
  N: "จมูก",
  L: "ร้อยไหม",
  K: "Pico",
  U: "Ultrafomer",
  I: "Biostimulator",
  V: "Wegovy",
  O: "BioActive",
  Z: "Volumizer Lip",
  G: "Mulkwang",
};

// Special freeform AW codes that don't follow [ASSET][PROGRAM][SUB]-[ID] pattern
// (คีย์เทียบแบบไม่สนตัวพิมพ์ — ชื่อจริงเขียน "pagelike" ตัวเล็ก)
export const SPECIAL_AW_MAP: Record<string, string> = {
  "หน้าบ้าน": "หน้าบ้าน",
  "IG": "IG",
  "pagelike": "Pagelike",
};

/**
 * รหัสสาขาที่จริงๆ ไม่ใช่สาขาขายบริการ — แอดใต้รหัสพวกนี้ไม่มีรหัสโปรแกรม
 * จึงจัดเป็นหมวดของตัวเองแทนที่จะถูกนับเป็น "ยังไม่ลงรหัส"
 * เช่น "HR Class" = แอดรับสมัครงานของฝ่ายทรัพยากรบุคคล
 */
export const NON_SERVICE_BRANCH_PROGRAM: Record<string, string> = {
  HR: "ทรัพยากรบุคคล",
};

/**
 * รหัสสาขาเก่าที่เลิกใช้แล้ว → รหัสที่ถูกต้อง
 * ชื่อแอดเดิมใน Meta ยังเขียนรหัสเก่าอยู่ จึงต้องยุบให้เองตอนอ่าน
 * ไม่งั้นยอดของสาขานั้นจะหลุดไปเป็น "สาขาไม่รู้จัก"
 * แอดที่ยังใช้รหัสเก่าจะถูกทำเครื่องหมาย usesObsoleteBranchCode = true ไว้ให้ตามไปแก้ชื่อ
 */
export const BRANCH_ALIASES: Record<string, string> = {
  "N-BPG": "BPG",
};

/** ป้ายกำกับกลุ่มแอดที่ "พยายามลงรหัสแล้วแต่รหัสผิดกติกา" — รวมเป็นก้อนเดียว ไม่แตกเป็นโปรแกรมปลอม */
export const INVALID_CODE_LABEL = "รหัสไม่ถูก";
/** ป้ายกำกับกลุ่มแอดที่ยังไม่ได้ลงรหัสเลย (ชื่ออิสระ) */
export const NOT_CODED_LABEL = "ยังไม่ลงรหัส";

/**
 * กติกาตั้งชื่อ AW: [ASSET][PROGRAM][SUB 2 หลัก]-[NO 4 หลัก]
 *  - ASSET   = P โปรโมชั่น | C เคสรีวิว | R รีวิว | A awareness (มีแค่ 4 ตัวนี้)
 *  - PROGRAM = 1 ตัวอักษร ยกเว้น ALL (โปรแกรมรวม) ที่เป็น 3 ตัวอักษร
 *  - SUB     = เลขหมวดโปรแกรม 2 หลักเท่านั้น
 *  - NO      = ลำดับคอนเทนต์ในโปรแกรม 4 หลักเท่านั้น
 */
const AW_CODE_PATTERN = /^([PRCA])(ALL|[A-Z])(\d{2})-(\d{4})$/i;

/**
 * "เหมือนจะพยายามลงรหัส" — ใช้แยกแอดที่ลงรหัสผิด (รหัสไม่ถูก)
 * ออกจากแอดที่ไม่เคยลงรหัสเลย (ยังไม่ลงรหัส) เช่น "Hifu 990"
 */
const AW_ATTEMPT_PATTERN = /^[A-Za-z]+\d{1,3}-\d+$/;

/** สถานะการอ่านชื่อแอด */
export type AdNameStatus =
  | "ok"           // ตรงกติกาและรหัสลงทะเบียนครบ
  | "special"      // หมวดพิเศษ: หน้าบ้าน / IG / Pagelike / ทรัพยากรบุคคล
  | "invalid_code" // พยายามลงรหัสแล้วแต่ผิดกติกา หรือรหัสยังไม่ลงทะเบียน
  | "not_coded";   // ยังไม่ได้ลงรหัสเลย

// Sub codes: [PROGRAM][SUB_NUMBER] -> label
export const SUB_MAP: Record<string, string> = {
  B0: "รวม", B1: "ลิฟกรอบหน้า", B2: "กราม", B3: "ริ้วรอย",
  B4: "รักแร้ ลดเหงื่อ", B5: "น่อง", B6: "หน้าเรียว", B7: "หน้าผาก",
  F0: "รวม", F1: "ใต้ตา", F2: "ปาก", F3: "คาง",
  F4: "ล่องแก้ม", F5: "แก้มตอบ", F6: "ขมับ", F7: "หน้าผาก", F8: "จมูก",
  A0: "สิว",
  M0: "แฟต", M1: "หน้าใส",
  H0: "ไฮฟุ",
  S0: "ฉีด", S1: "ฝ้า",
  W0: "รวม", W1: "รักแร้", W2: "หนวด/เครา", W3: "Bikini/Hollywood",
  W4: "แขน", W5: "ขา", W6: "หน้า",
  ALL0: "อื่นๆ", ALL1: "Dday", ALL2: "เทศกาล", ALL3: "ผ่อน0%", ALL4: "Bundle",
  T0: "รวม", T1: "ยกกระชับใบหน้า", T2: "ลดเลือนริ้วรอย", T3: "ผิวหน้ากระจ่างใส",
  T4: "รักษาสิว", T5: "ลดรอยคล้ำใต้ตา", T6: "ให้ความชุ่มชื้น",
  N0: "รวม",
  L0: "รวม",
  K0: "รวม", K1: "หน้า", K2: "หลัง", K3: "รักแร้", K4: "รอยสัก/แผลเป็น",
  U0: "Ultrafomer",
  I0: "Biostimulator",
  V0: "Wegovy",
  O0: "BioActive",
  Z0: "Volumizer Lip",
  G0: "Mulkwang",
};

export interface ParsedAdName {
  branch: string;
  branchCode: string;
  asset: string;
  assetCode: string;
  program: string;
  programCode: string;
  sub: string;
  subCode: string;
  service: string;       // combined program + sub label e.g. "โบท็อกซ์ กราม"
  serviceCode: string;   // combined e.g. "B02"
  campaignType: string;  // alias for asset
  campaignTypeCode: string;
  creativeId: string;
  awCode: string;
  isParsed: boolean;     // false if format not recognized
  status: AdNameStatus;  // เหตุผลที่อ่านได้/ไม่ได้ ใช้แยกกลุ่มในหน้าเตือน
  /** ชื่อยังใช้รหัสสาขาเก่าที่เลิกใช้แล้ว (ดู BRANCH_ALIASES) — ควรตามไปแก้ชื่อใน Meta */
  usesObsoleteBranchCode: boolean;
  /** รหัสหมวดย่อย (เช่น F02) มีอยู่ในตารางตั้งค่าแล้วหรือยัง */
  isSubRegistered: boolean;
}

export function parseAdName(adName: string): ParsedAdName {
  const raw = adName.trim();
  const branchMap = getBranchMap();

  // รหัสจริงอยู่ท้ายชื่อเสมอ: [ข้อความโน้ตอะไรก็ได้] [รหัสสาขา] [รหัส AW]
  // ข้อความข้างหน้าเป็นโน้ตที่คนตั้งใจใส่ไว้กันลืมว่าแอดคืออะไร ไม่ใช่ความผิดพลาด
  // จึงไล่หารหัสสาขาจากท้ายมาหน้า ไม่ใช่จากหน้าไปท้าย — กันกรณีที่โน้ตข้างหน้า
  // มีรหัสสาขาปนอยู่ด้วย เช่น "30up BRM MKM PM00-0032" สาขาจริงคือ MKM ไม่ใช่ BRM
  const parts = raw.split(" ");
  let branchCode = "";
  let branchIndex = -1;
  let usedAlias = false;
  for (let i = parts.length - 1; i >= 0; i--) {
    const token = parts[i].toUpperCase();
    // รหัสเก่าที่เลิกใช้แล้วถูกยุบเป็นรหัสจริงก่อน แม้จะยังค้างอยู่ในตารางตั้งค่า
    const canonical = BRANCH_ALIASES[token] || token;
    if (branchMap[canonical]) {
      branchCode = canonical;
      branchIndex = i;
      usedAlias = canonical !== token;
      break;
    }
  }
  const branchFound = branchIndex >= 0;
  // fallback: use first token as branch code even if not in map
  if (!branchCode) {
    branchCode = parts[0] || "";
    branchIndex = 0;
  }
  const branch = branchMap[branchCode] || branchCode;

  // AW code = everything after branch token
  const awCode = parts.slice(branchIndex + 1).join(" ").trim();

  // ── หมวดพิเศษ: ทั้งชื่อคือป้ายพิเศษ เช่นแอดที่ชื่อว่า "IG" เฉยๆ ──
  const specialLabelFull = lookupSpecialLabel(raw);
  if (specialLabelFull) {
    return specialResult(specialLabelFull, specialLabelFull, raw, raw);
  }

  // ── หมวดพิเศษที่มีรหัสสาขานำหน้า เช่น "CLS หน้าบ้าน", "CLS pagelike" ──
  const specialLabel = lookupSpecialLabel(awCode);
  if (specialLabel) {
    return specialResult(branch, specialLabel, branchCode, awCode);
  }

  const awMatch = awCode.match(AW_CODE_PATTERN);

  if (awMatch) {
    const assetCode = awMatch[1].toUpperCase();
    const programCode = awMatch[2].toUpperCase();
    const subCode = awMatch[3];
    const creativeId = awMatch[4];

    // รหัสโปรแกรมต้องลงทะเบียนไว้แล้ว ไม่งั้นถือว่ารหัสผิด — ไม่ตั้งชื่อโปรแกรมเองจากตัวอักษรดิบ
    const programMap = getProgramMap();
    const program = programMap[programCode];
    if (!program) {
      return codelessResult(branch, branchCode, awCode, "invalid_code");
    }

    // รหัสหมวดย่อยมาตรฐาน = แบบเดียวกับใน ad name จริง คือเลข 2 หลัก (B02, ALL03)
    // ลอง lookup ตามลำดับ: แบบ 2 หลัก (มาตรฐานใน DB) → ตามที่เขียนมาจริง → แบบไม่มีศูนย์ (คีย์เก่าใน hardcode)
    const subMap = getSubMap();
    const subKeyPadded = `${programCode}${subCode.padStart(2, "0")}`;
    const subKeyRaw = `${programCode}${subCode}`;
    const subKeyUnpadded = `${programCode}${String(parseInt(subCode, 10) || 0)}`;
    const subLabel = subMap[subKeyPadded] || subMap[subKeyRaw] || subMap[subKeyUnpadded];
    const isSubRegistered = Boolean(subLabel);
    const sub = subLabel || subCode;

    const asset = ASSET_MAP[assetCode] || assetCode;
    const serviceCode = `${programCode}${subCode.padStart(2, "0")}`;
    const service = sub && sub !== "รวม" ? `${program} ${sub}` : program;

    return {
      branch,
      branchCode,
      asset,
      assetCode,
      program,
      programCode,
      sub,
      subCode,
      service,
      serviceCode,
      campaignType: asset,
      campaignTypeCode: assetCode,
      creativeId,
      awCode,
      isParsed: true,
      status: "ok",
      // ข้อความนำหน้าไม่ถือว่าผิด เหลือธงเดียวคือยังใช้รหัสสาขาเก่าอยู่หรือเปล่า
      usesObsoleteBranchCode: usedAlias,
      isSubRegistered,
    };
  }

  // ── รหัสสาขาที่ไม่ใช่สาขาขายบริการ (HR) และไม่มีรหัส AW ต่อท้าย ──
  const nonServiceLabel = NON_SERVICE_BRANCH_PROGRAM[branchCode];
  if (branchFound && nonServiceLabel) {
    return specialResult(branch, nonServiceLabel, branchCode, awCode);
  }

  // ── อ่านรหัสไม่ได้: แยกว่า "ลงรหัสผิด" หรือ "ยังไม่ลงรหัสเลย" ──
  const lastToken = parts[parts.length - 1] || "";
  const looksLikeAttempt =
    AW_ATTEMPT_PATTERN.test(awCode) || AW_ATTEMPT_PATTERN.test(lastToken);

  return codelessResult(
    branch,
    branchCode,
    awCode,
    looksLikeAttempt ? "invalid_code" : "not_coded"
  );
}

/** เทียบป้ายพิเศษแบบไม่สนตัวพิมพ์ใหญ่เล็ก */
function lookupSpecialLabel(value: string): string | undefined {
  if (!value) return undefined;
  const key = Object.keys(SPECIAL_AW_MAP).find(
    (k) => k.toLowerCase() === value.toLowerCase()
  );
  return key ? SPECIAL_AW_MAP[key] : undefined;
}

/** ผลลัพธ์ของหมวดพิเศษ (หน้าบ้าน / IG / Pagelike / ทรัพยากรบุคคล) */
function specialResult(
  branch: string,
  label: string,
  branchCode: string,
  awCode: string
): ParsedAdName {
  return {
    branch,
    branchCode,
    asset: label,
    assetCode: awCode,
    program: label,
    programCode: label,
    sub: "",
    subCode: "",
    service: label,
    serviceCode: awCode,
    campaignType: label,
    campaignTypeCode: awCode,
    creativeId: "",
    awCode,
    isParsed: true,
    status: "special",
    usesObsoleteBranchCode: false,
    isSubRegistered: true,
  };
}

/**
 * ผลลัพธ์ของแอดที่อ่านรหัสโปรแกรมไม่ได้
 * programCode ปล่อยว่างไว้ตั้งใจ เพื่อไม่ให้ไปโผล่เป็นตัวเลือกโปรแกรมปลอมในตัวกรอง
 * ทุกตัวจะถูกรวมเป็นก้อนเดียวใต้ป้าย "รหัสไม่ถูก" หรือ "ยังไม่ลงรหัส"
 */
function codelessResult(
  branch: string,
  branchCode: string,
  awCode: string,
  status: "invalid_code" | "not_coded"
): ParsedAdName {
  const label = status === "invalid_code" ? INVALID_CODE_LABEL : NOT_CODED_LABEL;
  return {
    branch,
    branchCode,
    asset: "",
    assetCode: "",
    program: label,
    programCode: "",
    sub: "",
    subCode: "",
    service: label,
    serviceCode: "",
    campaignType: "",
    campaignTypeCode: "",
    creativeId: "",
    awCode,
    isParsed: false,
    status,
    usesObsoleteBranchCode: false,
    isSubRegistered: true,
  };
}
