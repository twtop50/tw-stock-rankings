"use client";

import { changeColorClass, formatPercent } from "@/lib/format";
import type { NewEntrant } from "@/types/stock";

interface Props {
  items: NewEntrant[];
}

export default function NewEntrants({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 hidden items-center gap-2 sm:flex">
        <h2 className="text-sm font-semibold text-white">🆕 新進榜雷達</h2>
        <span className="text-xs text-slate-500">
          今日首次衝進前 50 · AI + Google 搜尋分析「發生了什麼」
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((it) => (
          <div
            key={it.symbol}
            className="rounded-lg border border-amber-500/30 bg-amber-400/[0.06] p-3 shadow-lg"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono font-bold text-amber-300">{it.symbol}</span>
              <span
                className={`shrink-0 font-mono text-sm font-semibold ${changeColorClass(
                  it.changePercent,
                )}`}
              >
                {formatPercent(it.changePercent)}
              </span>
            </div>
            <div className="mb-1 truncate text-xs text-slate-400" title={it.name}>
              {it.name}
            </div>
            <div className="mb-1 text-[11px] text-slate-500">{it.theme}</div>
            <p className="text-xs leading-relaxed text-slate-300">
              {it.reason || "（無說明）"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
