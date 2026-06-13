"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import SortableHeader from "./SortableHeader";
import StatusBar from "./StatusBar";
import ThemeSummary from "./ThemeSummary";
import NewEntrants from "./NewEntrants";
import MarketBriefing from "./MarketBriefing";
import CollapsibleSection from "./CollapsibleSection";
import StockTrendModal from "./StockTrendModal";
import {
  changeColorClass,
  formatMoney,
  formatPercent,
  formatPrice,
  formatSector,
} from "@/lib/format";
import {
  TEXT_COLUMNS,
  type RankingsResponse,
  type RankingSource,
  type SortDir,
  type SortKey,
  type StockRow,
  type ThemeSummaryItem,
  type NewEntrant,
  type MarketBriefing as MarketBriefingData,
  type HistoryIndexEntry,
  type TrendsData,
  type SymbolTrend,
} from "@/types/stock";

// 靜態網站：資料來自每日排程產生的 rankings.json（相對路徑以相容 basePath）。
const DATA_URL = "rankings.json";
const HISTORY_INDEX_URL = "history/index.json";
const TRENDS_URL = "history/trends.json";
const historyUrl = (date: string) => `history/${date}.json`;
const RANK_JUMP_THRESHOLD = 10; // 排名躍升標示門檻

/** 依在榜天數給顏色：1 天(剛發動，灰) / 2–4 天 / ≥5 天(持續強勢，綠)。 */
function streakClass(streak: number): string {
  if (streak >= 5) return "text-emerald-300 font-semibold";
  if (streak >= 2) return "text-slate-300";
  return "text-slate-500";
}

/** 顯示用日期：YYYY-MM-DD。 */
function fmtDateLabel(date: string): string {
  return date;
}

interface ColumnDef {
  key: SortKey;
  label: string;
  align: "left" | "right";
  hideOnMobile?: boolean; // 手機隱藏（節省寬度）；桌機照常
  hint?: string; // 表頭 ⓘ tooltip 說明
}

// 手機隱藏 className（與下方 <td> 一致）
const HIDE_ON_MOBILE = "hidden sm:table-cell";

const COLUMNS: ColumnDef[] = [
  { key: "symbol", label: "代碼", align: "left" },
  { key: "price", label: "價格", align: "right", hideOnMobile: true },
  { key: "changePercent", label: "漲跌幅", align: "right" },
  {
    key: "streak",
    label: "在榜天數",
    align: "right",
    hideOnMobile: true,
    hint: "連續登上 Top 50 的天數；數字由歷史回補紀錄推算，僅供參考。",
  },
  { key: "dollarVolume", label: "成交金額", align: "right" },
  { key: "marketCap", label: "市值", align: "right", hideOnMobile: true },
  { key: "theme", label: "題材/族群", align: "left" },
];

function compare(a: StockRow, b: StockRow, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  let result: number;
  if (typeof av === "number" && typeof bv === "number") {
    result = av - bv;
  } else {
    result = String(av).localeCompare(String(bv));
  }
  return dir === "asc" ? result : -result;
}

export default function RankingTable() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [source, setSource] = useState<RankingSource | null>(null);
  const [aiSource, setAiSource] = useState<"gemini" | "none">("none");
  const [themeSummary, setThemeSummary] = useState<ThemeSummaryItem[]>([]);
  const [newEntrants, setNewEntrants] = useState<NewEntrant[]>([]);
  const [marketBriefing, setMarketBriefing] = useState<MarketBriefingData | null>(null);
  const [backfilled, setBackfilled] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 歷史快照切換。
  const [history, setHistory] = useState<HistoryIndexEntry[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 個股走勢圖（trends.json 延遲載入）。
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [trendsLoading, setTrendsLoading] = useState(false);
  const [trendTarget, setTrendTarget] = useState<{
    symbol: string;
    market: "twse" | "tpex";
    name: string;
  } | null>(null);

  const [sortKey, setSortKey] = useState<SortKey>("dollarVolume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  /** 載入某一天（date 為 null 時載入最新的 rankings.json）。 */
  const load = useCallback(async (date: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const url = date ? historyUrl(date) : DATA_URL;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`讀取資料失敗 ${res.status}`);
      const data = (await res.json()) as RankingsResponse;
      setRows(data.rows);
      setAsOf(data.asOf);
      setGeneratedAt(data.generatedAt ?? null);
      setSource(data.source);
      setAiSource(data.aiSource ?? "none");
      setThemeSummary(data.themeSummary ?? []);
      setNewEntrants(data.newEntrants ?? []);
      setMarketBriefing(data.marketBriefing ?? null);
      setBackfilled(data.backfilled === true);
      setNotice(data.notice);
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  // 開啟頁面：先讀歷史索引；有則載入最新一天，否則退回 rankings.json。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(HISTORY_INDEX_URL, { cache: "no-store" });
        if (res.ok) {
          const idx = (await res.json()) as HistoryIndexEntry[];
          if (!cancelled && Array.isArray(idx) && idx.length > 0) {
            setHistory(idx);
            setSelectedDate(idx[0].date);
            await load(idx[0].date);
            return;
          }
        }
      } catch {
        // 無索引（尚未部署歷史）→ 退回單一最新檔。
      }
      if (!cancelled) await load(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  // 自動刷新：檢視「最新」時每 5 分鐘重抓索引並載入最新一天（分頁可見才做），
  // 免得使用者一直手動重整去猜資料更新了沒。檢視歷史日時不刷新（不會變）。
  useEffect(() => {
    const latest = history[0]?.date ?? null;
    const viewingLatest = !latest || selectedDate === latest;
    if (!viewingLatest) return;
    const id = setInterval(async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch(HISTORY_INDEX_URL, { cache: "no-store" });
        if (res.ok) {
          const idx = (await res.json()) as HistoryIndexEntry[];
          if (Array.isArray(idx) && idx.length > 0) {
            setHistory(idx);
            setSelectedDate(idx[0].date);
            await load(idx[0].date);
            return;
          }
        }
      } catch {
        // 忽略；下一輪再試
      }
      await load(null);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [history, selectedDate, load]);

  const handleSelectDate = useCallback(
    (date: string) => {
      setSelectedDate(date);
      void load(date);
    },
    [load],
  );

  /** 點擊個股 → 開啟走勢圖（首次開啟時延遲載入 trends.json）。 */
  const openTrend = useCallback(
    async (symbol: string, market: "twse" | "tpex", name: string) => {
      setTrendTarget({ symbol, market, name });
      if (trends || trendsLoading) return;
      setTrendsLoading(true);
      try {
        const res = await fetch(TRENDS_URL, { cache: "no-store" });
        if (res.ok) setTrends((await res.json()) as TrendsData);
      } catch {
        // 無 trends.json → 走勢圖顯示「資料不足」。
      } finally {
        setTrendsLoading(false);
      }
    },
    [trends, trendsLoading],
  );

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      // 切到新欄位：文字欄預設升冪、數字欄預設降冪。
      setSortDir(TEXT_COLUMNS.has(key) ? "asc" : "desc");
      return key;
    });
  }, []);

  // 成交值名次（# 永遠代表成交金額排名，與排序方式無關）。
  const rankBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    [...rows]
      .sort((a, b) => b.dollarVolume - a.dollarVolume)
      .forEach((r, i) => m.set(r.symbol, i + 1));
    return m;
  }, [rows]);

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir]);

  const showSkeleton = loading && rows.length === 0;
  const isLatest = history.length === 0 || selectedDate === history[0]?.date;
  const trendData: SymbolTrend | null = trendTarget
    ? trends?.symbols[trendTarget.symbol] ?? null
    : null;

  return (
    <div>
      <StatusBar
        asOf={asOf}
        generatedAt={generatedAt}
        source={source}
        aiSource={aiSource}
        notice={notice}
        loading={loading}
      />

      {history.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label htmlFor="history-date" className="text-xs font-medium text-slate-400">
            歷史日期
          </label>
          <select
            id="history-date"
            value={selectedDate ?? ""}
            onChange={(e) => handleSelectDate(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {history.map((h) => (
              <option key={h.date} value={h.date}>
                {fmtDateLabel(h.date)}
                {h.date === history[0].date ? "（最新）" : ""}
              </option>
            ))}
          </select>
          {!isLatest && (
            <span className="rounded bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              檢視歷史快照
            </span>
          )}
          <span className="text-xs text-slate-600">· 點任一列看個股走勢</span>
        </div>
      )}

      {!showSkeleton && backfilled && (
        <div className="mb-5 rounded-lg border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-xs leading-relaxed text-slate-400">
          📁 此日為歷史回補資料，無當日「今日市場焦點」與「發動題材」（即時事件無法事後重建）。個股題材、走勢與排行仍正常顯示。
        </div>
      )}

      {!showSkeleton && marketBriefing && (
        <CollapsibleSection title="📰 今日市場焦點">
          <MarketBriefing data={marketBriefing} />
        </CollapsibleSection>
      )}
      {!showSkeleton && newEntrants.length > 0 && (
        <CollapsibleSection title="🆕 新進榜雷達">
          <NewEntrants items={newEntrants} />
        </CollapsibleSection>
      )}
      {!showSkeleton && (aiSource === "none" || themeSummary.length > 0) && (
        <CollapsibleSection title="🔥 今日發動題材">
          <ThemeSummary items={themeSummary} aiSource={aiSource} />
        </CollapsibleSection>
      )}

      {error && rows.length === 0 ? (
        <div className="rounded-lg border border-rose-800 bg-rose-950/40 p-8 text-center text-rose-300">
          載入失敗：{error}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => void load(selectedDate)}
              className="rounded-md border border-rose-700 px-3 py-1.5 text-sm hover:bg-rose-900/40"
            >
              重試
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800 shadow-xl">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-slate-900/95 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 backdrop-blur"
                >
                  #
                </th>
                {COLUMNS.map((c) => (
                  <SortableHeader
                    key={c.key}
                    label={c.label}
                    sortKey={c.key}
                    activeKey={sortKey}
                    dir={sortDir}
                    align={c.align}
                    onSort={handleSort}
                    className={c.hideOnMobile ? HIDE_ON_MOBILE : ""}
                    hint={c.hint}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {showSkeleton
                ? Array.from({ length: 12 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-800/60">
                      <td className="px-3 py-3" colSpan={COLUMNS.length + 1}>
                        <div className="h-4 w-full animate-pulse rounded bg-slate-800" />
                      </td>
                    </tr>
                  ))
                : sortedRows.map((row) => {
                    const rank = rankBySymbol.get(row.symbol) ?? 0;
                    const jumped =
                      row.rankChange != null && row.rankChange >= RANK_JUMP_THRESHOLD;
                    return (
                      <tr
                        key={row.symbol}
                        onClick={() => void openTrend(row.symbol, row.market, row.name)}
                        title={`${row.name}（點擊看走勢）`}
                        className={`cursor-pointer border-b border-slate-800/60 transition-colors hover:bg-slate-800/40 ${
                          row.isNew ? "bg-amber-400/[0.07]" : ""
                        }`}
                      >
                        <td className="px-3 py-2.5 text-right align-top">
                          <div className="font-mono text-xs text-slate-500">{rank}</div>
                          {jumped && (
                            <div className="font-mono text-[10px] font-semibold text-emerald-400">
                              ▲{row.rankChange}
                            </div>
                          )}
                        </td>
                        <td
                          className="px-3 py-2.5 font-mono font-semibold text-slate-200"
                          title={row.name}
                        >
                          {row.isNew && (
                            <span className="mr-1.5 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-amber-300 align-middle">
                              NEW
                            </span>
                          )}
                          {row.symbol}
                          <span className="ml-1.5 hidden rounded bg-slate-800 px-1 py-0.5 align-middle text-[10px] font-normal text-slate-500 sm:inline">
                            {row.market === "tpex" ? "櫃" : "市"}
                          </span>
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono text-slate-200 sm:table-cell">
                          {formatPrice(row.price)}
                        </td>
                        <td
                          className={`px-3 py-2.5 text-right font-mono font-medium ${changeColorClass(
                            row.changePercent,
                          )}`}
                        >
                          {formatPercent(row.changePercent)}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono sm:table-cell">
                          <span className={streakClass(row.streak)}>{row.streak}</span>
                          <span className="ml-0.5 text-[10px] text-slate-600">天</span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-emerald-300">
                          {formatMoney(row.dollarVolume)}
                        </td>
                        <td className="hidden px-3 py-2.5 text-right font-mono text-slate-300 sm:table-cell">
                          {formatMoney(row.marketCap)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300">
                          {row.theme || formatSector(row.sector)}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      )}

      {!showSkeleton && !error && sortedRows.length === 0 && (
        <div className="rounded-lg border border-slate-800 p-8 text-center text-slate-500">
          目前沒有資料。
        </div>
      )}

      {trendTarget && (
        <StockTrendModal
          symbol={trendTarget.symbol}
          market={trendTarget.market}
          name={trendTarget.name}
          trend={trendData}
          loading={trendsLoading}
          onClose={() => setTrendTarget(null)}
        />
      )}
    </div>
  );
}
