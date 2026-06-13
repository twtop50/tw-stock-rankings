"use client";

import { useEffect, useRef } from "react";

interface Props {
  symbol: string; // 台股代碼（如 2330）
  market?: "twse" | "tpex"; // 交易所前綴：上市 → TWSE、上櫃 → TPEX
  height?: number | string; // 數字=px；字串可用 "85vh" 等
}

/**
 * 嵌入 TradingView「Advanced Chart」小工具，顯示該代碼的日K（蠟燭圖）。
 * 純 client 端注入官方腳本；symbol 改變時重建。靜態匯出相容（不需 server）。
 * 台股需帶交易所前綴：上市 TWSE:2330、上櫃 TPEX:6488。
 */
export default function TradingViewChart({ symbol, market = "twse", height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tvSymbol = `${market === "tpex" ? "TPEX" : "TWSE"}:${symbol}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // 重建容器，避免切換代碼時殘留舊圖。
    container.innerHTML = '<div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div>';

    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: tvSymbol,
      interval: "D", // 日K
      timezone: "Asia/Taipei",
      theme: "dark",
      style: "1", // 蠟燭圖
      locale: "zh_TW",
      allow_symbol_change: false,
      hide_side_toolbar: true,
      hide_legend: false,
      backgroundColor: "rgba(2, 6, 23, 1)", // slate-950 近似，與站台一致
    });
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [tvSymbol]);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container overflow-hidden rounded-lg border border-slate-800"
      style={{ height }}
    />
  );
}
