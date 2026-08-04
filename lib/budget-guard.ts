import { CPI_TARGET } from "./management-rules";
import { objectiveMetric } from "./reporting";

/**
 * ตัวตัดไฟแอดเปลืองเงิน: ธง "ชิ้นครีเอทีฟ" ที่ยังรันอยู่แล้วเผาเงินโดยไม่ได้ผลลัพธ์
 * เพื่อให้หยุด/แก้ได้เร็วที่สุด — จากข้อมูลจริง แอดกลุ่มแย่มี CPI ฿181-652
 * ขณะที่เป้าคือ ฿100 การตัดเร็วคือส่วนที่ประหยัดงบเทสต์ได้จริง
 *
 * นับเฉพาะแอดที่วัดผลด้วย Inbox (ผ่าน objectiveMetric)
 * แอดในแคมเปญ Lead/Traffic/Awareness ไม่ถูกธง เพราะเกณฑ์ CPI ใช้กับมันไม่ได้
 */

export type BudgetGuardLevel = "kill" | "warning";

export interface BudgetGuardFlag {
  level: BudgetGuardLevel;
  reason: string;
}

// ใช้เงินเท่ากับค่าเป้าของ 3 inbox แล้วยังไม่มีสักอัน = ควรปิดทันที
export const KILL_NO_RESULT_SPEND = CPI_TARGET * 3;
export const WARN_NO_RESULT_SPEND = CPI_TARGET * 1.5;
// CPI เกินเป้า 2 เท่า (และมี inbox พอให้เชื่อได้ว่าไม่ใช่แค่โชคร้าย) = ควรปิด
export const KILL_CPI = CPI_TARGET * 2;
export const MIN_INBOX_FOR_CPI_JUDGE = 3;

/** กติกาหลัก ใช้ได้กับทั้งระดับชิ้นครีเอทีฟและระดับแคมเปญ (ไม่เช็คสถานะ/objective) */
export function classifyWasteCore(input: { spent: number; inbox: number; cpi: number }): BudgetGuardFlag | null {
  if (input.inbox <= 0) {
    if (input.spent >= KILL_NO_RESULT_SPEND) {
      return {
        level: "kill",
        reason: `ใช้ไป ฿${Math.round(input.spent).toLocaleString()} แล้วยังไม่มี Inbox เลย (เท่าค่าเป้าของ ${Math.floor(input.spent / CPI_TARGET)} inbox) — ควรปิดหรือเปลี่ยนครีเอทีฟทันที`,
      };
    }
    if (input.spent >= WARN_NO_RESULT_SPEND) {
      return {
        level: "warning",
        reason: `ใช้ไป ฿${Math.round(input.spent).toLocaleString()} ยังไม่มี Inbox — ถ้าแตะ ฿${KILL_NO_RESULT_SPEND.toLocaleString()} แล้วยังเงียบควรปิด`,
      };
    }
    return null;
  }

  if (input.inbox >= MIN_INBOX_FOR_CPI_JUDGE && input.cpi > 0) {
    if (input.cpi > KILL_CPI) {
      return {
        level: "kill",
        reason: `CPI ฿${Math.round(input.cpi).toLocaleString()} สูงกว่าเป้า (฿${CPI_TARGET}) เกิน 2 เท่า จาก ${input.inbox} inbox — เงินส่วนเกินกำลังไหลทิ้งทุกวัน`,
      };
    }
    if (input.cpi > CPI_TARGET) {
      return {
        level: "warning",
        reason: `CPI ฿${Math.round(input.cpi).toLocaleString()} เกินเป้า ฿${CPI_TARGET} จาก ${input.inbox} inbox — เฝ้าดูใกล้ชิด ถ้าไม่ดีขึ้นควรปิด`,
      };
    }
  }

  return null;
}

/** เงินส่วนที่จ่ายเกินกว่าที่ควรจ่ายตามเป้า CPI (ไว้เรียงลำดับว่าตัวไหนเผาเงินหนักสุด) */
export function excessSpend(input: { spent: number; inbox: number }): number {
  return Math.max(0, input.spent - input.inbox * CPI_TARGET);
}

/* ── ระดับชิ้นครีเอทีฟ (จาก ad insights) ─────────────────── */

/** ข้อมูลขั้นต่ำต่อแถวโฆษณา — AdInsight ใช้ได้ตรงๆ */
export interface WasteRowInput {
  parsed: { creativeId: string; awCode: string; branch?: string };
  adId?: string;
  spend: number;
  inbox: number;
  effectiveStatus?: string;
  objective?: string;
  optimizationGoal?: string;
}

export interface WastefulCreative {
  /** เช่น "PF00-0292" — โปรแกรม+ชิ้นครีเอทีฟ เหมือนที่ใช้ในหน้า Creative */
  groupKey: string;
  programCode: string;
  spend: number;
  inbox: number;
  cpi: number;
  adCount: number;
  branches: string[];
  excess: number;
  flag: BudgetGuardFlag;
}

/**
 * รวมแถวโฆษณาเป็นรายชิ้นครีเอทีฟ (awBase + creativeId เหมือนหน้า Creative)
 * แล้วธงชิ้นที่กำลังเปลืองเงิน — เรียงตัววิกฤต (kill) ขึ้นก่อน ตามด้วยเงินส่วนเกินมากสุด
 */
export function flagWastefulCreatives(rows: WasteRowInput[]): WastefulCreative[] {
  const groups = new Map<
    string,
    { programCode: string; spend: number; inbox: number; adIds: Set<string>; branches: Set<string>; active: boolean }
  >();

  for (const row of rows) {
    const cid = row.parsed.creativeId;
    if (!cid) continue;
    // นับเฉพาะแอดที่วัดผลด้วย Inbox — แคมเปญ Lead/Traffic ใช้เกณฑ์ CPI ไม่ได้
    if (objectiveMetric(row.objective, row.optimizationGoal).key !== "inbox") continue;

    const awBase = row.parsed.awCode.replace(/-\d+$/, "");
    const key = `${awBase}-${cid}`;
    const group = groups.get(key) || {
      programCode: awBase.replace(/\d+$/, ""),
      spend: 0,
      inbox: 0,
      adIds: new Set<string>(),
      branches: new Set<string>(),
      active: false,
    };
    group.spend += row.spend;
    group.inbox += row.inbox;
    if (row.adId) group.adIds.add(row.adId);
    if (row.parsed.branch) group.branches.add(row.parsed.branch);
    if ((row.effectiveStatus || "").toUpperCase() === "ACTIVE") group.active = true;
    groups.set(key, group);
  }

  const flagged: WastefulCreative[] = [];
  for (const [groupKey, group] of groups) {
    // ธงเฉพาะชิ้นที่ยังมีแคมเปญ ACTIVE — ชิ้นที่ปิดไปแล้วไม่ได้เผาเงินต่อ
    if (!group.active) continue;
    const cpi = group.inbox > 0 ? group.spend / group.inbox : 0;
    const flag = classifyWasteCore({ spent: group.spend, inbox: group.inbox, cpi });
    if (!flag) continue;
    flagged.push({
      groupKey,
      programCode: group.programCode,
      spend: group.spend,
      inbox: group.inbox,
      cpi,
      adCount: group.adIds.size,
      branches: [...group.branches].sort(),
      excess: excessSpend({ spent: group.spend, inbox: group.inbox }),
      flag,
    });
  }

  return flagged.sort((a, b) => {
    if (a.flag.level !== b.flag.level) return a.flag.level === "kill" ? -1 : 1;
    return b.excess - a.excess;
  });
}

/* ── ระดับแคมเปญ (คงไว้เผื่อใช้กับหน้า Ads ภายหลัง) ────────── */

export interface BudgetGuardInput {
  spent: number;
  inbox: number;
  cpi: number;
  effectiveStatus?: string;
  objective?: string;
  optimizationGoal?: string;
}

export function classifyBudgetWaste(input: BudgetGuardInput): BudgetGuardFlag | null {
  if ((input.effectiveStatus || "").toUpperCase() !== "ACTIVE") return null;
  if (objectiveMetric(input.objective, input.optimizationGoal).key !== "inbox") return null;
  return classifyWasteCore(input);
}
