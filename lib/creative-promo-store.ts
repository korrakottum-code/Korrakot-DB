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
