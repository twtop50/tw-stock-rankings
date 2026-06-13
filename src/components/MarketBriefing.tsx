"use client";

import type { MarketBriefing as MarketBriefingData } from "@/types/stock";

interface Props {
  data?: MarketBriefingData | null;
}

export default function MarketBriefing({ data }: Props) {
  if (!data) return null;
  const { highlights, eventsPast, eventsUpcoming } = data;
  const hasEvents = eventsPast.length > 0 || eventsUpcoming.length > 0;
  if (!highlights && !hasEvents) return null;

  return (
    <section className="mb-5 rounded-lg border border-sky-500/25 bg-sky-400/[0.05] p-4 shadow-lg">
      <div className="mb-2 hidden items-center gap-2 sm:flex">
        <h2 className="text-sm font-semibold text-white">📰 今日市場焦點</h2>
        <span className="text-xs text-slate-500">
          成交重點與重大事件 · AI + Google 搜尋分析
        </span>
      </div>

      {highlights && (
        <p className="mb-3 text-sm leading-relaxed text-slate-200">{highlights}</p>
      )}

      {hasEvents && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {eventsPast.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                重大事件（已發生）
              </h3>
              <ul className="space-y-1.5">
                {eventsPast.map((e, i) => (
                  <li key={i} className="text-xs leading-relaxed">
                    <span className="font-medium text-slate-200">{e.title}</span>
                    {e.detail && <span className="text-slate-400"> — {e.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {eventsUpcoming.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                即將到來
              </h3>
              <ul className="space-y-1.5">
                {eventsUpcoming.map((e, i) => (
                  <li key={i} className="text-xs leading-relaxed">
                    {e.date && (
                      <span className="mr-1.5 rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
                        {e.date}
                      </span>
                    )}
                    <span className="font-medium text-slate-200">{e.title}</span>
                    {e.detail && <span className="text-slate-400"> — {e.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
