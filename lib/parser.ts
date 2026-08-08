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
  "N-BPG": "Class Go บางพลี",
  LEI: "เลย",
  HB: "หน้าบ้าน",
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

// Asset (campaign type) codes
export const ASSET_MAP: Record<string, string> = {
  P: "โปรโมชั่น",
  R: "รีวิว",
  C: "เคสรีวิว",
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
export const SPECIAL_AW_MAP: Record<string, string> = {
  "หน้าบ้าน": "หน้าบ้าน",
  "IG": "IG",
};

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
}

export function parseAdName(adName: string): ParsedAdName {
  const raw = adName.trim();
  const branchMap = getBranchMap();

  // Find branch code anywhere in the tokens (not necessarily first)
  const parts = raw.split(" ");
  let branchCode = "";
  let branchIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    if (branchMap[parts[i].toUpperCase()]) {
      branchCode = parts[i].toUpperCase();
      branchIndex = i;
      break;
    }
  }
  // fallback: use first token as branch code even if not in map
  if (!branchCode) {
    branchCode = parts[0] || "";
    branchIndex = 0;
  }
  const branch = branchMap[branchCode] || branchCode;

  // AW code = everything after branch token
  const awCode = parts.slice(branchIndex + 1).join(" ").trim();

  let assetCode = "";
  let programCode = "";
  let subCode = "";
  let creativeId = "";
  let isParsed = false;

  // Check if the entire ad name (no branch prefix) is a special label e.g. "IG"
  const specialLabelFull = SPECIAL_AW_MAP[raw];
  if (specialLabelFull) {
    return {
      branch: specialLabelFull, branchCode: raw,
      asset: specialLabelFull, assetCode: raw,
      program: specialLabelFull, programCode: raw,
      sub: "", subCode: "",
      service: specialLabelFull, serviceCode: raw,
      campaignType: specialLabelFull, campaignTypeCode: raw,
      creativeId: "", awCode: raw,
      isParsed: true,
    };
  }

  // Check special freeform AW codes first (หน้าบ้าน, IG, etc.)
  const specialLabel = SPECIAL_AW_MAP[awCode];
  if (specialLabel) {
    return {
      branch, branchCode,
      asset: specialLabel, assetCode: awCode,
      program: specialLabel, programCode: awCode,
      sub: "", subCode: "",
      service: specialLabel, serviceCode: awCode,
      campaignType: specialLabel, campaignTypeCode: awCode,
      creativeId: "", awCode,
      isParsed: true,
    };
  }

  // AW format: [ASSET][PROGRAM][SUB]-[CREATIVE_ID]
  // ASSET = P|R|C (1 char)
  // PROGRAM = 1+ uppercase letters (B, F, ALL, etc.)
  // SUB = 1-2 digits
  // CREATIVE_ID = 4 digits after dash
  const awMatch = awCode.match(/^([PRC])([A-Z]+)(\d{1,2})-(\d+)$/i);

  if (awMatch) {
    assetCode = awMatch[1].toUpperCase();
    programCode = awMatch[2].toUpperCase();
    subCode = awMatch[3];
    creativeId = awMatch[4];
    isParsed = true;
  } else {
    // fallback — not recognized
    assetCode = awCode.charAt(0).toUpperCase();
    programCode = awCode.slice(1).replace(/\d.*$/, "").toUpperCase();
    subCode = awCode.match(/([A-Z]+)(\d+)-/i)?.[2] || "0";
    creativeId = awCode.match(/-(\d+)$/)?.[1] || "";
  }

  const asset = ASSET_MAP[assetCode] || assetCode;
  const program = getProgramMap()[programCode] || programCode;
  // ad จริงเขียนเลขหมวดแบบมีศูนย์นำหน้า (PF02) แต่คีย์ใน SUB_MAP เป็นแบบไม่มีศูนย์ (F2)
  // — lookup ทั้งสองแบบ ไม่งั้นชื่อหมวดย่อยไม่เคยเจอ
  const subMap = getSubMap();
  const subKey = `${programCode}${subCode}`;
  const subKeyUnpadded = `${programCode}${String(parseInt(subCode, 10) || 0)}`;
  const sub = subMap[subKey] || subMap[subKeyUnpadded] || subCode;

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
    isParsed,
  };
}
