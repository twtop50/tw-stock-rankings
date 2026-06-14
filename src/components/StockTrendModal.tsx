"use client";

import { useEffect } from "react";
import { changeColorClass, formatMoney, formatPercent, formatPrice } from "@/lib/format";
import type { SymbolTrend, TrendPoint } from "@/types/stock";

interface Props {
  symbol: string;
  market: "twse" | "tpex";
  name: string;
  trend: SymbolTrend | null;
  loading: boolean;
  onClose: () => void;
}

const W = 560;
const H = 130;
const PAD_X = 10;
const PAD_TOP = 12;
const PAD_BOT = 22;

/** 以 SVG 折線繪製單一序列。invert=true 時數值越小越高（給名次用）。 */
function LineChart({
  points,
  accessor,
  color,
  invert = false,
  formatVal,
}: {
  points: TrendPoint[];
  accessor: (p: TrendPoint) => number;
  color: string;
  invert?: boolean;
  formatVal: (v: number) => string;
}) {
  const vals = points.map(accessor);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = points.length;
  const plotH = H - PAD_TOP - PAD_BOT;
  const x = (i: number) => PAD_X + (n <= 1 ? 0 : (i * (W - 2 * PAD_X)) / (n - 1));
  const y = (v: number) => {
    const t = (v - min) / span;
    return PAD_TOP + (invert ? t : 1 - t) * plotH;
  };
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(accessor(p)).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${(PAD_TOP + plotH).toFixed(1)} L${x(0).toFixed(
    1,
  )},${(PAD_TOP + plotH).toFixed(1)} Z`;
  const last = points[n - 1];
  const first = points[0];
  const gid = `g-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" />
      <circle cx={x(n - 1)} cy={y(accessor(last))} r="3" fill={color} />
      {/* 端點數值 */}
      <text x={PAD_X} y={H - 6} className="fill-slate-500 text-[9px]">
        {first.d.slice(5)}
      </text>
      <text x={W - PAD_X} y={H - 6} textAnchor="end" className="fill-slate-500 text-[9px]">
        {last.d.slice(5)}
      </text>
      {/* 高/低標 */}
      <text x={PAD_X} y={PAD_TOP - 2} className="fill-slate-600 text-[9px]">
        {invert ? `高 #${formatVal(min)}` : formatVal(max)}
      </text>
    </svg>
  );
}

function Panel({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        <span className="font-mono text-xs text-slate-400">最新 {value}</span>
      </div>
      {children}
    </div>
  );
}

export default function StockTrendModal({ symbol, market, name, trend, loading, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const points = trend?.points ?? [];
  const enough = points.length >= 2;
  const last = points[points.length - 1];

  // 台灣財經站多半禁止 iframe 內嵌，無法直接預覽圖表，故以「開新分頁」深連結為主；
  // 預覽則用本站自有資料畫的走勢圖。Yahoo 依上市/上櫃帶 .TW/.TWO。
  const yahooSuffix = market === "tpex" ? "TWO" : "TW";
  const extLinks: { label: string; href: string }[] = [
    { label: "奇摩股市", href: `https://tw.stock.yahoo.com/quote/${symbol}.${yahooSuffix}` },
    { label: "Goodinfo", href: `https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${symbol}` },
    { label: "玩股網線圖", href: `https://www.wantgoo.com/stock/${symbol}/technical-chart` },
    {
      label: "TradingView",
      href: `https://www.tradingview.com/chart/?symbol=${market === "tpex" ? "TPEX" : "TWSE"}:${symbol}`,
    },
  ];

  const ExtLinks = () => (
    <div className="flex flex-wrap items-center gap-1.5">
      {extLinks.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-xs text-sky-300 hover:bg-slate-800"
        >
          {l.label} ↗
        </a>
      ))}
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-xl font-bold text-white">
              {symbol}
              <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 align-middle text-[11px] font-normal text-slate-400">
                {market === "tpex" ? "上櫃" : "上市"}
              </span>
            </h2>
            <p className="text-sm text-slate-400">{name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-sm text-slate-300 hover:bg-slate-800"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-slate-500">載入走勢資料中…</div>
        ) : !enough ? (
          <div className="space-y-3 rounded-lg border border-slate-800 p-4 text-center text-xs text-slate-500">
            <p>本站走勢需累積更多在榜交易日（目前 {points.length} 天）。</p>
            <div className="flex justify-center">
              <ExtLinks />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ExtLinks />
            <Panel label="收盤價" value={formatPrice(last.price)}>
              <LineChart
                points={points}
                accessor={(p) => p.price}
                color="#fbbf24"
                formatVal={formatPrice}
              />
            </Panel>
            <Panel label="成交值名次（越上越前）" value={`#${last.rank}`}>
              <LineChart
                points={points}
                accessor={(p) => p.rank}
                color="#38bdf8"
                invert
                formatVal={(v) => String(v)}
              />
            </Panel>
            <Panel label="成交金額" value={formatMoney(last.dv)}>
              <LineChart
                points={points}
                accessor={(p) => p.dv}
                color="#34d399"
                formatVal={formatMoney}
              />
            </Panel>

            {/* 近期資料表（新到舊，最多 12 筆） */}
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-500">
                    <th className="px-3 py-1.5 text-left font-medium">日期</th>
                    <th className="px-3 py-1.5 text-right font-medium">名次</th>
                    <th className="px-3 py-1.5 text-right font-medium">收盤</th>
                    <th className="px-3 py-1.5 text-right font-medium">漲跌</th>
                    <th className="px-3 py-1.5 text-right font-medium">成交額</th>
                    <th className="px-3 py-1.5 text-right font-medium">在榜</th>
                  </tr>
                </thead>
                <tbody>
                  {[...points]
                    .reverse()
                    .slice(0, 12)
                    .map((p) => (
                      <tr key={p.d} className="border-b border-slate-800/60">
                        <td className="px-3 py-1.5 font-mono text-slate-400">{p.d}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-300">#{p.rank}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-300">
                          {formatPrice(p.price)}
                        </td>
                        <td
                          className={`px-3 py-1.5 text-right font-mono ${changeColorClass(p.chg)}`}
                        >
                          {formatPercent(p.chg)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-emerald-300/80">
                          {formatMoney(p.dv)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-slate-400">
                          {p.streak}天
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
