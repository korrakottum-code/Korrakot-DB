import type { Metadata } from "next";
import CreativeChecklist from "@/components/CreativeChecklist";

export const metadata: Metadata = {
  title: "ตรวจสอบคอนเทนท์ก่อนขึ้นแอด | Meta Ads Dashboard",
  description: "Checklist ประเมินคอนเทนท์ก่อนขึ้นแอด สรุปจากครีเอทีฟที่ติด Top จริง",
};

export default function CreativeReviewPage() {
  return <CreativeChecklist />;
}
