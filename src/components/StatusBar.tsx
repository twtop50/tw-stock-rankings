"use client";

import type { RankingSource } from "@/types/stock";
import { formatTime, formatTradingDate } from "@/lib/format";

interface Props {
  asOf: string | null;
  generatedAt?: string | null;
  source: RankingSource | null;
  aiSource?: "gemini" | "none";
  notice?: string;
  loading: boolean;
}

export default function StatusBar({ asOf, generatedAt, source, aiSource, notice, loading }: Props) {
  // 資料新鮮度：以瀏覽器當天對比收盤日（台北）。正常情形最多 3 天（週五收盤 → 週一
  // 盤後更新前 = 3 個日曆天），故門檻設 4 天：可在「週末後漏掉一個交易日」隔天就示警，
  // 又不會在正常週一上午誤報；逢國定連假可能偶爾提早亮（可接受，寧可多提醒）。
  const staleDays = (() => {
    if (!asOf) return null;
    const d = new Date(`${asOf.slice(0, 10)}T00:00:00+08:00`);
    if (Number.isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / 86_400_000);
  })();
  const isStale = staleDays != null && staleDays >= 4;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-400">
        <span>
          台股收盤：
          <span className="ml-1 font-mono text-slate-200">
            {asOf ? formatTradingDate(asOf) : "—"}
          </span>
        </span>
        {generatedAt && (
          <span>
            更新於：
            <span className="ml-1 font-mono text-slate-300">{formatTime(generatedAt)}</span>
            <span className="ml-1 text-xs text-slate-500">（台北）</span>
          </span>
        )}
        {source === "mock" && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-300">
            示範資料（資料來源暫時無法取得）
          </span>
        )}
        {source === "twse" && (
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            上市＋上櫃 · 證交所／櫃買（收盤）
          </span>
        )}
        {aiSource === "gemini" && (
          <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-medium text-sky-300">
            題材分析 · Gemini
          </span>
        )}
        {aiSource === "none" && (
          <span className="rounded-full bg-slate-600/30 px-2.5 py-0.5 text-xs font-medium text-slate-400">
            AI 未啟用
          </span>
        )}
      </div>

      {loading && <span className="text-xs text-slate-500">更新中…</span>}

      <p className="w-full text-xs leading-relaxed text-slate-500">
        ℹ️ 顯示最近一個台股交易日的收盤資料；每個交易日約 <span className="text-slate-400">15:00–16:00</span>（台北）於收盤後自動更新。
      </p>

      {isStale && (
        <p className="w-full rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          ⚠️ 資料已 {staleDays} 天未更新（最後收盤日 {asOf ? formatTradingDate(asOf) : "—"}），自動更新可能延遲或暫停，請留意數據時效。
        </p>
      )}

      {notice && (
        <p className="w-full rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {notice}
        </p>
      )}
    </div>
  );
}
