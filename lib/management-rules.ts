export const CPI_TARGET = 100;
export const CPL_TARGET_MIN = 200;
export const CPL_TARGET_MAX = 350;

export type Decision = "Scale candidate" | "Monitor" | "Low sample" | "Review" | "Data incomplete";

export interface DecisionResult {
  decision: Decision;
  confidence: "Low" | "Medium" | "High";
  reason: string;
}

export function isExcludedManagementGroup(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized === "ig" || normalized === "ทรัพยากรบุคคล" || normalized === "hr";
}

export function decisionForBranch(input: {
  cpi: number | null;
  cpl: number | null;
  inbox: number;
  leads: number;
  objectiveKnown: boolean;
  objectiveCount?: number;
  objectiveMetric?: "inbox" | "leads" | "clicks" | "impressions" | "unknown";
}): DecisionResult {
  if (!input.objectiveKnown) return { decision: "Data incomplete", confidence: "Low", reason: "ยังไม่พบ Objective ที่เชื่อถือได้ จึงไม่จัดอันดับด้วย Inbox" };
  if ((input.objectiveCount || 0) > 1) return { decision: "Review", confidence: "Low", reason: "มีหลาย Objective รวมกัน ต้องแยกดูแต่ละ Objective ก่อนตัดสินใจ" };
  if (input.objectiveMetric && !["inbox", "leads"].includes(input.objectiveMetric)) {
    return { decision: "Data incomplete", confidence: "Low", reason: "Objective นี้ใช้ผลลัพธ์คนละชนิด จึงยังไม่ใช้ CPI/CPL จัดอันดับรวม" };
  }
  const sample = input.leads > 0 ? input.leads : input.inbox;
  if (sample < 10) return { decision: "Low sample", confidence: "Low", reason: `มีผลลัพธ์เพียง ${sample} รายการ ต่ำกว่าเกณฑ์ 10 รายการ` };
  if (input.leads >= 10) {
    if (input.cpl != null && input.cpl >= CPL_TARGET_MIN && input.cpl <= CPL_TARGET_MAX) {
      return { decision: "Scale candidate", confidence: input.leads >= 30 ? "High" : "Medium", reason: `CPL อยู่ในเป้าหมาย ฿${CPL_TARGET_MIN}–฿${CPL_TARGET_MAX} จาก Lead ${input.leads} รายการ` };
    }
    return { decision: "Monitor", confidence: input.leads >= 30 ? "High" : "Medium", reason: `มี Lead ${input.leads} รายการ แต่ CPL ยังไม่อยู่ในช่วงเป้าหมาย` };
  }
  if (input.cpi != null && input.cpi <= CPI_TARGET) {
    return { decision: "Scale candidate", confidence: input.inbox >= 30 ? "High" : "Medium", reason: `CPI ไม่เกิน ฿${CPI_TARGET} จาก Inbox ${input.inbox} รายการ` };
  }
  return { decision: "Monitor", confidence: input.inbox >= 30 ? "High" : "Medium", reason: `มี Inbox ${input.inbox} รายการ แต่ CPI สูงกว่าเกณฑ์หรือยังไม่มีข้อมูลพอ` };
}
