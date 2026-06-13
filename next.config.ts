import type { NextConfig } from "next";

// 靜態匯出（GitHub Pages）。basePath 由 CI 依 repo 名稱注入；
// 在 user.github.io 根網域或自訂網域時留空即可。
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default nextConfig;
