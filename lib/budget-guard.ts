import { CPI_TARGET } from "./management-rules";
import { objectiveMetric } from "./reporting";

/**
 * ตัวตัดไฟแอดเปลืองเงิน: ธงแคมเปญที่กำลังรันอยู่แล้วเผาเงินโดยไม่ได้ผลลัพธ์
 * เพื่อให้หยุด/แก้ได้เร็วที่สุด — จากข้อมูลจริง แอดกลุ่มแย่มี CPI ฿181-652
 * ขณะที่เป้าคือ ฿100 การตัดเร็วคือส่วนที่ประหยัดงบเทสต์ได้จริง
 *
 * ตอนนี้ guard เฉพาะแคมเปญที่วัดผลด้วย Inbox (ผ่าน objectiveMetric)
 * แคมเปญ Lead/Traffic/Awareness ไม่ถูกธง เพราะเกณฑ์ CPI ใช้กับมันไม่ได้
 */

export interface BudgetGuardInput {
  spent: number;
  inbox: number;
  cpi: number;
  effectiveStatus?: string;
  objective?: string;
  optimizationGoal?: string;
}

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

export function classifyBudgetWaste(input: BudgetGuardInput): BudgetGuardFlag | null {
  if ((input.effectiveStatus || "").toUpperCase() !== "ACTIVE") return null;
  const metric = objectiveMetric(input.objective, input.optimizationGoal);
  if (metric.key !== "inbox") return null;

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
export function excessSpend(input: Pick<BudgetGuardInput, "spent" | "inbox">): number {
  return Math.max(0, input.spent - input.inbox * CPI_TARGET);
}
