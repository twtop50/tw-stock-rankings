import type { Metadata } from "next";
import "./globals.css";

const SITE_TITLE = "台股成交值排行 Top 50";
const SITE_DESC =
  "台股（上市＋上櫃）依當日成交金額排序的每日排行榜，含 AI 題材／族群分析、今日市場焦點、新進榜雷達與個股走勢。";
// 靜態 OG 圖放在 public/，帶 .png 副檔名（GitHub Pages 才會以 image/png 提供）。
// 明確帶上 CI 注入的 basePath，再由 metadataBase 補成絕對網址。
const OG_IMAGE = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/opengraph-image.png`;

export const metadata: Metadata = {
  // GitHub Pages 網域；上方 OG_IMAGE 已含 basePath。
  metadataBase: new URL("https://tomchang811.github.io"),
  title: SITE_TITLE,
  description: SITE_DESC,
  keywords: ["台股", "上市", "上櫃", "成交值", "成交金額", "排行榜", "Top 50", "題材", "族群", "台積電"],
  openGraph: {
    type: "website",
    locale: "zh_TW",
    siteName: SITE_TITLE,
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: SITE_TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-TW">
      <body className="min-h-screen overflow-x-hidden antialiased">{children}</body>
    </html>
  );
}
