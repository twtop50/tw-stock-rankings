"use client";

import { changeColorClass, formatPercent } from "@/lib/format";
import type { ThemeSummaryItem } from "@/types/stock";

interface Props {
  items: ThemeSummaryItem[];
  aiSource: "gemini" | "none";
}

export default function ThemeSummary({ items, aiSource }: Props) {
  if (aiSource === "none") {
    return (
      <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
        今日 AI 題材分析暫無，「題材／族群」欄改以產業別顯示。
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 hidden items-center gap-2 sm:flex">
        <h2 className="text-sm font-semibold text-white">🔥 今日發動題材</h2>
        <span className="text-xs text-slate-500">依族群強度排序 · 由 AI 分析</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.theme}
            className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 shadow-lg"
          >
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="truncate font-semibold text-slate-100">{it.theme}</h3>
              <span
                className={`shrink-0 font-mono text-sm font-semibold ${changeColorClass(
                  it.avgChange,
                )}`}
              >
                {formatPercent(it.avgChange)}
              </span>
            </div>
            <p className="mb-2 text-xs leading-relaxed text-slate-400">{it.reason}</p>
            <div className="flex flex-wrap gap-1">
              {it.symbols.map((s) => (
                <span
                  key={s}
                  className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
