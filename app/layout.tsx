import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Meta Ads Dashboard",
    template: "%s | Meta Ads Dashboard",
  },
  description: "แดชบอร์ดภายในสำหรับติดตามผลโฆษณา Meta Ads แบบอ่านอย่างเดียว",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="th"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
