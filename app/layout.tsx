import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "狼人杀",
  description: "与AI一起玩狼人杀推理游戏",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
