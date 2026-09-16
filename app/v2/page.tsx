import Dashboard from "@/components/Dashboard";

// หน้าทดลอง Depth3 — ไม่ผูกลิงก์จากที่ไหนในแอปโดยตั้งใจ เข้าได้เฉพาะพิมพ์ URL ตรงๆ
// (ยังอยู่หลัง proxy.ts เหมือนหน้าอื่น ต้อง login ทีมงานก่อนเหมือนเดิม)
export default function DashboardV2() {
  return <Dashboard showDepth3 />;
}
