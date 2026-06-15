// 共用資料管線工具（台股版）：供 snapshot.mjs（每日最新）與 backfill.mjs（回補歷史）共用。
// 資料來源：證交所(TWSE) + 櫃買(TPEx) 官方 OpenAPI；成交金額由交易所直接公布，
// 故不需逐檔補抓、也不需嚴格 rate-limit。題材分析沿用 Google Gemini。

import { promises as fs } from "node:fs";
import path from "node:path";

export const ROOT = process.cwd();
export const CACHE_DIR = path.join(ROOT, ".cache");
export const CACHE_FILE = path.join(CACHE_DIR, "tw-industry.json");
export const PUBLIC_DIR = path.join(ROOT, "public");
export const HISTORY_DIR = path.join(PUBLIC_DIR, "history");

export const TOP_N = 50; // 最終輸出的個股數
export const INDUSTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 產業別/股數 7 天重抓
export const THEME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 題材標籤 30 天重抓

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtDate = (d) => d.toISOString().slice(0, 10);

// ───────────────────────── 解析輔助 ─────────────────────────

/** 解析交易所回傳的數字字串："1,234,567" / "14.63" / "+1.79" / "--" → number 或 NaN。 */
export function toNum(s) {
  if (s == null) return NaN;
  const v = String(s).replace(/,/g, "").replace(/\s/g, "").trim();
  if (v === "" || v === "--" || v === "---" || v === "—") return NaN;
  return Number(v);
}

/** 只保留 4 位純數字代號（個股）；排除 ETF（00xxx）、權證（6 位）、特別股（含字母）。 */
export function isCommonStock(code) {
  return /^[1-9]\d{3}$/.test(String(code ?? "").trim());
}

/** 民國日期字串 "1150612" → "2026-06-12"。 */
export function rocToISO(roc) {
  const s = String(roc ?? "").trim();
  const m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (m) return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
  // 已是 "YYY/MM/DD" 或 "2026-06-12" 等形式時的後備處理。
  const m2 = s.match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/);
  if (m2) {
    const y = Number(m2[1]) + 1911;
    return `${y}-${String(m2[2]).padStart(2, "0")}-${String(m2[3]).padStart(2, "0")}`;
  }
  return s;
}

// 上市/上櫃共用的 MOPS 產業別代碼 → 名稱（前端題材後備 + 餵給 Gemini 的脈絡）。
const INDUSTRY_NAMES = {
  "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維",
  "05": "電機機械", "06": "電器電纜", "08": "玻璃陶瓷", "09": "造紙工業",
  "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "14": "建材營造",
  "15": "航運業", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨",
  "19": "綜合", "20": "其他", "21": "化學工業", "22": "生技醫療業",
  "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業", "26": "光電業",
  "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
  "31": "其他電子業", "32": "文化創意業", "33": "農業科技業", "34": "電子商務",
  "35": "綠能環保", "36": "數位雲端", "37": "運動休閒", "38": "居家生活",
  "80": "管理股票",
};

/** 產業別代碼 → 名稱（找不到則原樣回傳）。 */
export function industryName(code) {
  const c = String(code ?? "").trim();
  if (!c) return "—";
  return INDUSTRY_NAMES[c.padStart(2, "0")] ?? INDUSTRY_NAMES[c] ?? c;
}

/** 顯示用產業字串（台股已是繁中名稱，原樣回傳；保留對全大寫英文的標題化）。 */
export function formatSector(sector) {
  if (!sector || sector === "—") return "—";
  if (sector !== sector.toUpperCase()) return sector;
  return sector.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// ───────────────────────── HTTP ─────────────────────────

/**
 * 取 JSON，對 429/5xx 與網路錯誤退避重試。台股 OpenAPI 量少，不需 rate-limit。
 *
 * 兩個關鍵韌性處理（針對 GitHub Actions 上偶發的 `TypeError: terminated` /
 * `SocketError: other side closed`）：
 *  1) body 解析（res.json()）在 try 內 await：該錯誤發生在「讀取回應 body」階段，
 *     若只 `return res.json()` 會在呼叫端才 reject、繞過本函式的重試 —— 等於重試形同虛設。
 *  2) `Connection: close` + AbortController 逾時：避免 undici 連線池重用到已被對端關閉的
 *     keep-alive 連線，並讓「卡住的 socket」逾時後改走重試，而非永久 hang 或直接致命。
 */
export async function getJson(url, { timeoutMs = 25_000, retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "tw-stock-rankings/1.0 (+github actions)",
          Accept: "application/json",
          Connection: "close",
        },
        signal: ac.signal,
      });
      if (res.ok) return await res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < retries - 1) {
        await sleep(3_000 * (attempt + 1));
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (e) {
      if (attempt < retries - 1) {
        await sleep(3_000 * (attempt + 1));
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 從環境變數或 .env.local 讀取指定金鑰。 */
export async function readKey(name) {
  if (process.env[name]) return process.env[name].trim();
  try {
    const raw = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const m = raw.match(new RegExp(`^${name}\\s*=\\s*(.+)\\s*$`, "m"));
    if (m) return m[1].trim();
  } catch {}
  return null;
}

// ───────────────────────── 產業別 / 股數（市值）快取 ─────────────────────────

const TWSE_BASIC = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
const TPEX_BASIC = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";

export async function loadCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function saveCache(cache) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
}

/**
 * 建立 symbol → { sector(產業名), shares(已發行普通股數) } 對照表，供：
 *  1) 市值＝股數 × 收盤價   2) 無 AI 時的題材後備   3) 餵給 Gemini 的產業脈絡。
 * 變動緩慢，含 7 天磁碟快取（cache.industry）。
 */
export async function loadIndustryMap(cache = {}) {
  const fresh =
    cache.industry && cache.industryFetchedAt && Date.now() - cache.industryFetchedAt < INDUSTRY_TTL_MS;
  const map = new Map();
  if (fresh) {
    for (const [k, v] of Object.entries(cache.industry)) map.set(k, v);
    return map;
  }

  const obj = {};
  const add = (code, sectorCode, shares) => {
    if (!isCommonStock(code)) return;
    obj[code] = { sector: industryName(sectorCode), shares: Number.isFinite(shares) ? shares : 0 };
  };
  try {
    const twse = await getJson(TWSE_BASIC);
    for (const r of twse) {
      add(r["公司代號"], r["產業別"], toNum(r["已發行普通股數或TDR原股發行股數"]));
    }
  } catch (e) {
    console.warn(`  上市基本資料抓取失敗：${e.message}`);
  }
  try {
    const tpex = await getJson(TPEX_BASIC);
    for (const r of tpex) {
      add(r.SecuritiesCompanyCode, r.SecuritiesIndustryCode, toNum(r.IssueShares));
    }
  } catch (e) {
    console.warn(`  上櫃基本資料抓取失敗：${e.message}`);
  }

  for (const [k, v] of Object.entries(obj)) map.set(k, v);
  cache.industry = obj;
  cache.industryFetchedAt = Date.now();
  await saveCache(cache);
  return map;
}

// ───────────────────────── 行情抓取（當日，OpenAPI） ─────────────────────────

const TWSE_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TPEX_DAY_ALL = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";

/** 正規化後的個股列：{ market, symbol, name, price, open, volume, dollarVolume, changeDelta, date }。 */
function normTwse(r) {
  return {
    market: "twse",
    symbol: r.Code,
    name: (r.Name ?? "").trim(),
    price: toNum(r.ClosingPrice),
    open: toNum(r.OpeningPrice),
    volume: toNum(r.TradeVolume),
    dollarVolume: toNum(r.TradeValue),
    changeDelta: toNum(r.Change), // 已帶正負號（跌為 "-x"）
    date: rocToISO(r.Date),
  };
}
function normTpex(r) {
  return {
    market: "tpex",
    symbol: r.SecuritiesCompanyCode,
    name: (r.CompanyName ?? "").trim(),
    price: toNum(r.Close),
    open: toNum(r.Open),
    volume: toNum(r.TradingShares),
    dollarVolume: toNum(r.TransactionAmount),
    changeDelta: toNum(r.Change), // 已帶正負號（如 "+1.79"）
    date: rocToISO(r.Date),
  };
}

function keepRow(x) {
  return isCommonStock(x.symbol) && x.price > 0 && x.dollarVolume > 0;
}

export async function fetchTwseLatest() {
  const data = await getJson(TWSE_DAY_ALL);
  return (Array.isArray(data) ? data : []).map(normTwse).filter(keepRow);
}
export async function fetchTpexLatest() {
  const data = await getJson(TPEX_DAY_ALL);
  return (Array.isArray(data) ? data : []).map(normTpex).filter(keepRow);
}

/**
 * 上市「指定日」資料的合理性檢查：與前一交易日（prev）共同個股的收盤價比值中位數，
 * 應落在台股單日漲跌幅（±10%）的寬鬆區間內。用以擋掉上游盤後分批寫入時的「暫態壞檔」
 * —— 曾觀察到 MI_INDEX 某瞬間整批價格被縮放 10×（台積電 227 vs 2310），中位數會掉到 ~0.1。
 * 樣本太少（<20 檔共同個股）時不判斷，避免誤殺。
 */
function twseDatedSane(next, prev) {
  const pm = new Map(prev.map((r) => [r.symbol, r.price]));
  const ratios = [];
  for (const r of next) {
    const p = pm.get(r.symbol);
    if (p > 0 && r.price > 0) ratios.push(r.price / p);
  }
  if (ratios.length < 20) return true;
  ratios.sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  return med >= 0.7 && med <= 1.45;
}

/**
 * 抓上市＋上櫃當日全市場個股，回傳「同一交易日」的 { date, rows }。
 *
 * 交易日以「上市」為錨（每個交易日一定有上市資料）。實測證交所 STOCK_DAY_ALL OpenAPI 會
 * 落後一天（收盤後數小時、櫃買已是新日，它仍給前一交易日）；此時改用「指定日」MI_INDEX
 * 端點補上市當日，並用 twseDatedSane() 擋掉上游暫態壞檔（壞則維持在上一個完整交易日，
 * 待 OpenAPI 自己補上才前進）。櫃買只採與上市同日者，確保兩市場不混日。
 */
export async function fetchAllLatest() {
  const [twseOA, tpex] = await Promise.all([fetchTwseLatest(), fetchTpexLatest()]);
  const oaDate = twseOA.map((r) => r.date).filter(Boolean).sort().pop();
  const tpexDate = tpex.map((r) => r.date).filter(Boolean).sort().pop();

  let twse = twseOA;
  let date = oaDate;
  // 上市 OpenAPI 落後於櫃買（有更新的交易日可拿）→ 試指定日端點補上市當日。
  if (tpexDate && (!oaDate || tpexDate > oaDate)) {
    const dated = await fetchTwseByDate(tpexDate).catch(() => []);
    if (dated.length > 0 && twseDatedSane(dated, twseOA)) {
      twse = dated;
      date = tpexDate;
      console.log(`  上市 OpenAPI 落後（${oaDate ?? "無"}），改用指定日端點 ${tpexDate}（已通過漲跌幅合理性檢查）`);
    } else if (dated.length > 0) {
      console.warn(`  指定日上市 ${tpexDate} 數值與前一交易日不連續（疑似上游壞檔），暫不採用，維持 ${oaDate}`);
    }
  }

  date = date ?? tpexDate ?? fmtDate(new Date());
  const rows = [...twse.filter((r) => r.date === date), ...tpex.filter((r) => r.date === date)];
  return { date, rows };
}

// ───────────────────────── 行情抓取（指定日，回補用） ─────────────────────────

/** 指定日上市全市場（MI_INDEX dated，欄位含千分位逗號、漲跌方向在 HTML cell）。 */
export async function fetchTwseByDate(ds) {
  const ymd = ds.replace(/-/g, "");
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${ymd}&type=ALLBUT0999&response=json`;
  let data;
  try {
    data = await getJson(url);
  } catch {
    return [];
  }
  if (!data || data.stat !== "OK" || !Array.isArray(data.tables)) return [];
  const table = data.tables.find(
    (t) => Array.isArray(t.fields) && t.fields.includes("成交金額") && t.fields.includes("證券代號"),
  );
  if (!table) return [];
  const f = table.fields;
  const idx = (name) => f.indexOf(name);
  const iCode = idx("證券代號"), iName = idx("證券名稱"), iVol = idx("成交股數"),
    iAmt = idx("成交金額"), iOpen = idx("開盤價"), iClose = idx("收盤價"),
    iDir = idx("漲跌(+/-)"), iDiff = idx("漲跌價差");
  const rows = [];
  for (const row of table.data ?? []) {
    const code = String(row[iCode] ?? "").trim();
    if (!isCommonStock(code)) continue;
    const dir = String(row[iDir] ?? "").replace(/<[^>]*>/g, "").trim(); // 去掉 <p> 標籤後為 + / - / X
    const diff = toNum(row[iDiff]);
    const changeDelta = Number.isFinite(diff) ? (dir.includes("-") ? -diff : diff) : NaN;
    const x = {
      market: "twse",
      symbol: code,
      name: String(row[iName] ?? "").trim(),
      price: toNum(row[iClose]),
      open: toNum(row[iOpen]),
      volume: toNum(row[iVol]),
      dollarVolume: toNum(row[iAmt]),
      changeDelta,
      date: ds,
    };
    if (keepRow(x)) rows.push(x);
  }
  return rows;
}

/** 指定日上櫃全市場（best-effort：TPEx 改版後歷史端點較不穩，失敗則回 []）。 */
export async function fetchTpexByDate(ds) {
  const [y, m, d] = ds.split("-");
  const roc = `${Number(y) - 1911}/${m}/${d}`;
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php?l=zh-tw&d=${roc}&se=EW`;
  let data;
  try {
    data = await getJson(url);
  } catch {
    return [];
  }
  const arr = data?.aaData ?? data?.tables?.[0]?.data ?? [];
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const rows = [];
  for (const row of arr) {
    // 舊版欄位順序：代號, 名稱, 收盤, 漲跌, 開盤, 最高, 最低, 均價, 成交股數, 成交金額(元), 成交筆數, ...
    const code = String(row[0] ?? "").trim();
    if (!isCommonStock(code)) continue;
    const x = {
      market: "tpex",
      symbol: code,
      name: String(row[1] ?? "").trim(),
      price: toNum(row[2]),
      open: toNum(row[4]),
      volume: toNum(row[8]),
      dollarVolume: toNum(row[9]),
      changeDelta: toNum(row[3]),
      date: ds,
    };
    if (keepRow(x)) rows.push(x);
  }
  return rows;
}

/**
 * 指定日上市＋上櫃（回補用）。
 * 真正的交易日一定有上市資料；若上市為空（國定假日，或來源暫時失敗），整日略過 ——
 * 避免 TPEx 舊端點對非交易日回傳「幻影」資料而產生上櫃-only 的髒歷史、打斷在榜天數鏈。
 */
export async function fetchAllByDate(ds) {
  const twse = await fetchTwseByDate(ds);
  if (twse.length === 0) return [];
  const tpex = await fetchTpexByDate(ds);
  return [...twse, ...tpex];
}

// ───────────────────────── 排名 ─────────────────────────

/**
 * 依成交金額排序取前 topN 個股，補上漲跌幅 / 產業別 / 市值。
 * @param normRows 正規化個股列（已過濾個股）。
 * @param industryMap symbol → { sector, shares }。
 * @returns picked[]：{ symbol, market, name, price, dollarVolume, volume, changePercent, sector, marketCap }（成交值由大到小）。
 */
export function rankTop(normRows, industryMap, opts = {}) {
  const topN = opts.topN ?? TOP_N;
  return [...normRows]
    .filter(keepRow)
    .sort((a, b) => b.dollarVolume - a.dollarVolume)
    .slice(0, topN)
    .map((r) => {
      const prevClose = r.price - (Number.isFinite(r.changeDelta) ? r.changeDelta : 0);
      const changePercent = Number.isFinite(r.changeDelta) && prevClose > 0
        ? (r.changeDelta / prevClose) * 100
        : r.open > 0
          ? ((r.price - r.open) / r.open) * 100
          : 0;
      const meta = industryMap.get(r.symbol);
      const shares = meta?.shares ?? 0;
      return {
        symbol: r.symbol,
        market: r.market,
        name: r.name || r.symbol,
        price: r.price,
        dollarVolume: r.dollarVolume,
        volume: r.volume,
        changePercent,
        sector: meta?.sector ?? "—",
        marketCap: shares > 0 ? shares * r.price : 0,
      };
    });
}

// ───────────────────────── Gemini（題材標籤） ─────────────────────────

export const GEMINI_MODEL = "gemini-2.5-flash";

/** 呼叫 Gemini generateContent，對 429/500/503 退避重試，回傳解析後的回應物件。 */
export async function callGemini(apiKey, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    if ([429, 500, 503].includes(res.status) && attempt < 4) {
      const wait = 5_000 * (attempt + 1);
      console.warn(`  Gemini HTTP ${res.status}，${wait / 1000}s 後重試（第 ${attempt + 1} 次）…`);
      await sleep(wait);
      continue;
    }
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
}

/** 串接候選回應的所有 text part。 */
export function candidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text || "").join("").trim();
}

/** 用 Gemini 分析每檔題材標籤 + 當日發動題材摘要。回傳 { themesByTicker, summary }。 */
export async function enrichWithGemini(stocks, apiKey) {
  const lines = stocks
    .map((s) => `${s.symbol} | ${s.name} | ${s.sector} | ${s.changePercent.toFixed(2)}%`)
    .join("\n");

  const prompt = `你是台股題材分析師。以下是某交易日「成交值前 50 名個股」（格式：代碼 | 名稱 | 產業別 | 當日漲跌幅）：
${lines}

請完成兩件事，全部用繁體中文：
1. tickers：為每一檔指定「一個」精簡且具體的題材/族群標籤（例如：AI 伺服器、CoWoS 先進封裝、矽光子 CPO、散熱、ABF 載板、PCB、記憶體、IP 矽智財、重電/電力、軍工國防、航運、被動元件、生技新藥、機器人、低軌衛星、綠能儲能、金融、資產股…）。同一族群的股票請用「完全一致」的標籤字串。避免過於籠統（不要只寫「電子」「半導體」）。
2. summary：找出當日「發動」的題材族群——以「上漲（漲跌幅為正）」的股票為主，依族群的強度（成員數與漲幅）由強到弱排序，最多 6 組。每組給 theme（題材名，需與 tickers 用詞一致）、reason（一句話說明該題材近期為何受資金關注，用你既有的知識）、symbols（屬於該族群且當日上漲的代碼陣列）。

只輸出 JSON。`;

  const schema = {
    type: "object",
    properties: {
      tickers: {
        type: "array",
        items: {
          type: "object",
          properties: { symbol: { type: "string" }, theme: { type: "string" } },
          required: ["symbol", "theme"],
        },
      },
      summary: {
        type: "array",
        items: {
          type: "object",
          properties: {
            theme: { type: "string" },
            reason: { type: "string" },
            symbols: { type: "array", items: { type: "string" } },
          },
          required: ["theme", "reason", "symbols"],
        },
      },
    },
    required: ["tickers", "summary"],
  };

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    // 關掉 gemini-2.5-flash 預設 thinking 並給足輸出上限；結構化輸出不需 thinking。
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.3,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const data = await callGemini(apiKey, body);
  const text = candidateText(data);
  if (!text) throw new Error("Gemini 回應為空");
  const parsed = JSON.parse(text);

  const themesByTicker = new Map();
  for (const it of parsed.tickers ?? []) {
    if (it.symbol && it.theme) themesByTicker.set(it.symbol, it.theme);
  }
  return { themesByTicker, summary: parsed.summary ?? [] };
}

// ───────────────────────── 歷史快照存檔 ─────────────────────────

/** 寫入一份歷史快照（以交易日命名），並重建 index.json / trends.json。 */
export async function writeHistory(out) {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const date = out.asOf.slice(0, 10);
  await fs.writeFile(path.join(HISTORY_DIR, `${date}.json`), JSON.stringify(out, null, 2), "utf8");
  await rebuildHistoryMeta();
}

/**
 * 掃描 public/history/ 下所有 <date>.json，重建：
 *  - index.json：可選日期清單（新到舊）
 *  - trends.json：每檔個股跨日的名次/成交額/價格走勢（供前端走勢圖一次載入）
 */
export async function rebuildHistoryMeta() {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const files = (await fs.readdir(HISTORY_DIR))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // 由舊到新

  const index = [];
  const symbols = {};
  const dates = [];

  for (const f of files) {
    const date = f.slice(0, 10);
    let data;
    try {
      data = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const rows = data.rows ?? [];
    dates.push(date);
    index.push({ date, asOf: data.asOf, generatedAt: data.generatedAt ?? null, count: rows.length });
    // rows 已依成交值由大到小排序 → 索引即成交值名次。
    rows.forEach((r, i) => {
      const sym = r.symbol;
      if (!symbols[sym]) symbols[sym] = { name: r.name, points: [] };
      symbols[sym].name = r.name;
      symbols[sym].points.push({
        d: date,
        rank: i + 1,
        dv: r.dollarVolume,
        price: r.price,
        chg: r.changePercent,
        streak: r.streak,
      });
    });
  }

  index.reverse(); // 新到舊
  await fs.writeFile(path.join(HISTORY_DIR, "index.json"), JSON.stringify(index), "utf8");
  await fs.writeFile(path.join(HISTORY_DIR, "trends.json"), JSON.stringify({ dates, symbols }), "utf8");
  return { dates, count: files.length };
}
