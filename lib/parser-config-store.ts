import { getSharedPool } from "./insights-store";
import {
  BRANCH_MAP,
  PROGRAM_MAP,
  SUB_MAP,
  primeParserMaps,
  readBranchConfigFile,
  type ParserConfigData,
} from "./parser";

/**
 * ที่เก็บ mapping ของ parser (สาขา / โปรแกรม / หมวดย่อย) ใน Postgres
 * — แก้ไขได้จากหน้า /settings มีผลทันที (parser cache 60 วิ) ไม่ต้องผ่าน PR + deploy
 *
 * ครั้งแรกที่ตารางว่าง จะ seed จากค่าเดิมทั้งหมด (hardcode + branch-config.json)
 * เพื่อให้รายการในหน้า settings ครบตั้งแต่วันแรก และลบ/แก้ค่าเดิมได้จริง
 */

export type ConfigKind = "branch" | "program" | "sub";

/** รหัสหมวดย่อยมาตรฐาน = โปรแกรม + เลข 2 หลักแบบเดียวกับ ad name จริง (B2 → B02, ALL3 → ALL03) */
export function normalizeSubCode(code: string): string {
  const m = code.trim().toUpperCase().match(/^([A-Z]+)(\d{1,2})$/);
  if (!m) return code.trim().toUpperCase();
  return `${m[1]}${m[2].padStart(2, "0")}`;
}

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await getSharedPool().query(`
    CREATE TABLE IF NOT EXISTS parser_config (
      kind TEXT NOT NULL CHECK (kind IN ('branch', 'program', 'sub')),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      is_test BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, code)
    );
  `);
  schemaReady = true;
}

async function seedKindIfEmpty(kind: ConfigKind): Promise<void> {
  const pool = getSharedPool();
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM parser_config WHERE kind = $1`, [kind]);
  if (rows[0].n > 0) return;

  const entries: { code: string; name: string; isTest: boolean }[] = [];
  if (kind === "branch") {
    const fileConfig = readBranchConfigFile();
    const merged: Record<string, { name: string; isTest: boolean }> = {};
    for (const [code, name] of Object.entries(BRANCH_MAP)) merged[code] = { name, isTest: false };
    for (const [code, entry] of Object.entries(fileConfig.branches)) merged[code] = { name: entry.name, isTest: entry.isTest };
    for (const [code, entry] of Object.entries(merged)) entries.push({ code, name: entry.name, isTest: entry.isTest });
  } else if (kind === "program") {
    for (const [code, name] of Object.entries(PROGRAM_MAP)) entries.push({ code, name, isTest: false });
  } else {
    // คีย์ hardcode เดิมเป็นแบบไม่มีศูนย์ (B2) แต่มาตรฐานใน DB คือแบบเดียวกับ ad name จริง (B02)
    for (const [code, name] of Object.entries(SUB_MAP)) {
      entries.push({ code: normalizeSubCode(code), name, isTest: false });
    }
  }

  for (const entry of entries) {
    await pool.query(
      `INSERT INTO parser_config (kind, code, name, is_test) VALUES ($1, $2, $3, $4)
       ON CONFLICT (kind, code) DO NOTHING`,
      [kind, entry.code, entry.name, entry.isTest]
    );
  }
}

export function isParserConfigWritable(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

export async function readParserConfig(): Promise<ParserConfigData> {
  await ensureSchema();
  await Promise.all([seedKindIfEmpty("branch"), seedKindIfEmpty("program"), seedKindIfEmpty("sub")]);

  const { rows } = await getSharedPool().query(
    `SELECT kind, code, name, is_test FROM parser_config ORDER BY kind, code`
  );
  const data: ParserConfigData = { branches: {}, programs: {}, subs: {} };
  for (const row of rows) {
    if (row.kind === "branch") data.branches[row.code] = { name: row.name, isTest: row.is_test };
    else if (row.kind === "program") data.programs[row.code] = row.name;
    else data.subs[row.code] = row.name;
  }
  return data;
}

export async function upsertParserConfig(kind: ConfigKind, code: string, name: string, isTest = false): Promise<void> {
  await ensureSchema();
  await getSharedPool().query(
    `INSERT INTO parser_config (kind, code, name, is_test) VALUES ($1, $2, $3, $4)
     ON CONFLICT (kind, code) DO UPDATE SET name = EXCLUDED.name, is_test = EXCLUDED.is_test, updated_at = now()`,
    [kind, code, name, isTest]
  );
  primeParserMaps(null); // ล้าง cache ให้คำขอถัดไปเห็นค่าใหม่ทันทีใน instance นี้
}

export async function deleteParserConfig(kind: ConfigKind, code: string): Promise<void> {
  await ensureSchema();
  await getSharedPool().query(`DELETE FROM parser_config WHERE kind = $1 AND code = $2`, [kind, code]);
  primeParserMaps(null);
}

/* ── hydration: โหลด config จาก DB เข้า cache ของ parser ── */

const HYDRATE_TTL_MS = 60_000;
let hydratedAt = 0;

/**
 * โหลด mapping จาก DB เข้า cache ใน lib/parser (TTL 60 วิ)
 * ถ้า DB ยังไม่ตั้งค่า/ล่ม จะเงียบๆ ใช้ค่า fallback เดิม (hardcode + JSON) — ไม่ทำให้ request พัง
 */
export async function hydrateParserConfig(): Promise<void> {
  if (!isParserConfigWritable()) return;
  if (Date.now() - hydratedAt < HYDRATE_TTL_MS) return;
  try {
    const data = await readParserConfig();
    primeParserMaps(data);
    hydratedAt = Date.now();
  } catch (err) {
    console.warn("[parser-config] hydrate failed, using fallback maps:", err instanceof Error ? err.message : err);
  }
}
