// 前端（靜態網站）使用的型別。資料來自每日排程產生的 rankings.json，
// 故型別在此自足定義，不依賴執行期的 provider 程式碼。

export interface StockRow {
  symbol: string; // 股票代碼（4 位數字，如 2330）
  market: "twse" | "tpex"; // 上市(twse) / 上櫃(tpex)；供 K 線交易所前綴與標示
  name: string; // 股票名稱
  price: number; // 收盤價
  changePercent: number; // 漲跌幅 (%)
  dollarVolume: number; // 成交金額（交易所直接公布）
  marketCap: number; // 市值（無資料時為 0）
  sector: string; // 產業別（後備用）
  theme: string; // AI 題材/族群（無 AI 時退為產業別）
  isNew: boolean; // 是否首次進前 50（對比前一交易日）
  rankChange: number | null; // 前一名次 − 本次名次（正=上升；新進為 null）
  streak: number; // 連續在榜天數（含當日；新進為 1）
}

/** 一個「發動題材」族群。 */
export interface ThemeSummaryItem {
  theme: string;
  reason: string;
  symbols: string[];
  count: number;
  avgChange: number;
}

/** 新進榜個股 + AI（含 Google 搜尋）說明的近期催化劑。 */
export interface NewEntrant {
  symbol: string;
  name: string;
  theme: string;
  changePercent: number;
  reason: string;
}

/** 一則已發生的重大事件。 */
export interface MarketEvent {
  title: string;
  detail: string;
}

/** 一則即將到來的重要事件（含日期/時點）。 */
export interface UpcomingEvent {
  date: string;
  title: string;
  detail: string;
}

/** 今日市場焦點：成交重點摘要 + 重大事件（已發生／即將到來）。 */
export interface MarketBriefing {
  highlights: string;
  eventsPast: MarketEvent[];
  eventsUpcoming: UpcomingEvent[];
}

export type RankingSource = "twse" | "mock";

export interface RankingsResponse {
  rows: StockRow[];
  asOf: string;
  /** 本次快照實際產生時間（ISO）；可看出資料每日是否有更新。 */
  generatedAt?: string;
  source: RankingSource;
  /** AI 題材分析來源；none 表示未啟用。 */
  aiSource: "gemini" | "none";
  themeSummary: ThemeSummaryItem[];
  newEntrants: NewEntrant[];
  /** 今日市場焦點（成交重點 + 重大事件）；未啟用 AI 或失敗時為 null/缺。 */
  marketBriefing?: MarketBriefing | null;
  notice?: string;
  /** 是否為回補的歷史資料（無 grounded 事件分析）。 */
  backfilled?: boolean;
}

/** history/index.json 的一筆：可選的歷史交易日（新到舊）。 */
export interface HistoryIndexEntry {
  date: string; // 交易日 YYYY-MM-DD
  asOf: string; // ISO（收盤時點）
  generatedAt: string | null; // 該份快照產生時間
  count: number; // 當日榜上檔數
}

/** 某個股在某交易日的走勢資料點。 */
export interface TrendPoint {
  d: string; // 交易日 YYYY-MM-DD
  rank: number; // 成交值名次（1=最高）
  dv: number; // 成交金額
  price: number; // 收盤價
  chg: number; // 漲跌幅 (%)
  streak: number; // 連續在榜天數
}

/** 單一個股跨日的走勢。 */
export interface SymbolTrend {
  name: string;
  points: TrendPoint[];
}

/** history/trends.json：所有歷史日期 + 每檔個股的跨日走勢。 */
export interface TrendsData {
  dates: string[]; // 由舊到新
  symbols: Record<string, SymbolTrend>;
}

/** 可排序的欄位鍵。 */
export type SortKey = keyof Pick<
  StockRow,
  "symbol" | "name" | "price" | "changePercent" | "dollarVolume" | "marketCap" | "theme" | "streak"
>;

export type SortDir = "asc" | "desc";

/** 文字欄位（預設升冪）；其餘為數字欄位（預設降冪）。 */
export const TEXT_COLUMNS: ReadonlySet<SortKey> = new Set(["symbol", "name", "theme"]);
