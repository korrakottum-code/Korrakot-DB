import { getSharedPool } from "./insights-store";

/**
 * แท็กกลุ่มโปรโมชั่นต่อชิ้นครีเอทีฟ (groupKey เช่น "PF02-0368") — เก็บใน Postgres
 * เพื่อให้ทั้งทีมเห็นตรงกัน (ต่างจาก tag แคมเปญเดิมที่เก็บใน localStorage ต่อเครื่อง)
 *
 * ราคา/โปรโมชั่นไม่ได้เข้ารหัสอยู่ในชื่อแอด (เช่น "filler 2990" vs "filler 11990")
 * ระบบจึงแยกให้อัตโนมัติไม่ได้ — ต้องให้ทีมติดแท็กเอง แล้ว dashboard ใช้แท็กนี้ไปกรอง/สรุปแยกกลุ่ม
 */

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await getSharedPool().query(`
    CREATE TABLE IF NOT EXISTS creative_promo_group (
      group_key TEXT PRIMARY KEY,
      promo_group TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  schemaReady = true;
}

export function isPromoGroupWritable(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

/** อ่านแท็กทั้งหมด: groupKey → promoGroup */
export async function readPromoGroups(): Promise<Record<string, string>> {
  await ensureSchema();
  const { rows } = await getSharedPool().query(`SELECT group_key, promo_group FROM creative_promo_group`);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.group_key] = row.promo_group;
  return map;
}

export async function upsertPromoGroup(groupKey: string, promoGroup: string): Promise<void> {
  await ensureSchema();
  await getSharedPool().query(
    `INSERT INTO creative_promo_group (group_key, promo_group) VALUES ($1, $2)
     ON CONFLICT (group_key) DO UPDATE SET promo_group = EXCLUDED.promo_group, updated_at = now()`,
    [groupKey, promoGroup]
  );
}

export async function deletePromoGroup(groupKey: string): Promise<void> {
  await ensureSchema();
  await getSharedPool().query(`DELETE FROM creative_promo_group WHERE group_key = $1`, [groupKey]);
}

/**
 * เปลี่ยนชื่อกลุ่มโปรโมชั่นทั้งกลุ่มในครั้งเดียว (แก้ชื่อที่พิมพ์ผิด/ไม่ตรง) — ย้ายทุกชิ้นที่แท็ก
 * ด้วยชื่อเดิมไปเป็นชื่อใหม่ ถ้าชื่อใหม่มีอยู่แล้วจะรวมเป็นกลุ่มเดียวกัน (ไม่ error เพราะ
 * primary key เป็น group_key ไม่ใช่ promo_group). คืนจำนวนชิ้นที่ถูกเปลี่ยน
 */
export async function renamePromoGroup(from: string, to: string): Promise<number> {
  await ensureSchema();
  const { rowCount } = await getSharedPool().query(
    `UPDATE creative_promo_group SET promo_group = $2, updated_at = now() WHERE promo_group = $1`,
    [from, to]
  );
  return rowCount ?? 0;
}

/** ลบแท็กกลุ่มโปรโมชั่นออกจากทุกชิ้นที่ใช้ชื่อนี้ในครั้งเดียว (โปรเลิกใช้แล้ว) คืนจำนวนชิ้นที่ถูกล้างแท็ก */
export async function deletePromoGroupEverywhere(name: string): Promise<number> {
  await ensureSchema();
  const { rowCount } = await getSharedPool().query(
    `DELETE FROM creative_promo_group WHERE promo_group = $1`,
    [name]
  );
  return rowCount ?? 0;
}
