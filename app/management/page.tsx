import type { Metadata } from "next";
import ManagementReport from "@/components/ManagementReport";

export const metadata: Metadata = {
  title: "Management Report | Meta Ads Dashboard",
  description: "รายงานเพื่อการบริหาร Meta Ads แบบอ่านอย่างเดียว",
};

export default function ManagementPage() {
  return <ManagementReport />;
}
