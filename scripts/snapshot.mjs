// 產生靜態網站的資料快照：抓取最近交易日台股（上市＋上櫃）成交值前 50 名「個股」，
// 補上產業別/市值，並用 Gemini 分析題材/族群；標示新進榜與排名躍升。
// 寫入 public/rankings.json，並另存一份歷史快照 public/history/<交易日>.json（重建 index/trends）。
// 供 GitHub Action 每日收盤後執行，或本機手動執行。
//
// 用法： node scripts/snapshot.mjs
// 環境變數 / .env.local：GEMINI_API_KEY（選用，缺少則題材退回產業別）。行情來源免金鑰。

import {
  readKey,
  fetchAllLatest,
  loadCache,
  saveCache,
  loadIndustryMap,
  rankTop,
  callGemini,
  candidateText,
  enrichWithGemini,
  writeHistory,
  THEME_TTL_MS,
  ROOT,
  HISTORY_DIR,
} from "./lib/core.mjs";
import { promises as fs } from "node:fs";
import path from "node:path";

const OUT_FILE = path.join(ROOT, "public", "rankings.json");

// 前一份快照（線上）來源，用於計算 isNew / rankChange；可用 env 覆寫成你的 GitHub Pages 網址。
const PREV_RANKINGS_URL =
  process.env.PREV_RANKINGS_URL ||
  "https://twtop50.github.io/tw-stock-rankings/rankings.json";

/**
 * 取「前一交易日」基準（優先，且最穩）：讀 public/history 下日期 < latestDate 的最新一檔。
 * 用真正的前一交易日來算 streak/isNew/rankChange，可避免「同日重跑/重部署」把 streak 壓回線上舊值。
 */
async function readPrevFromHistory(latestDate) {
  try {
    const dates = (await fs.readdir(HISTORY_DIR))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .filter((d) => d < latestDate)
      .sort();
    const prevDate = dates[dates.length - 1];
    if (!prevDate) return null;
    const data = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, `${prevDate}.json`), "utf8"));
    const ranks = new Map();
    const rows = new Map();
    (data.rows ?? []).forEach((r, i) => {
      ranks.set(r.symbol, i + 1);
      rows.set(r.symbol, r);
    });
    return { ranks, rows, date: prevDate };
  } catch {
    return null;
  }
}

/** 取得線上前一份快照：symbol→名次(1-based)、symbol→該列資料、資料交易日。 */
async function fetchPrev() {
  try {
    const res = await fetch(PREV_RANKINGS_URL);
    if (!res.ok) return null;
    const data = await res.json();
    const ranks = new Map();
    const rows = new Map();
    (data.rows ?? []).forEach((r, i) => {
      ranks.set(r.symbol, i + 1);
      rows.set(r.symbol, r);
    });
    const date = typeof data.asOf === "string" ? data.asOf.slice(0, 10) : null;
    return { ranks, rows, date };
  } catch {
    return null;
  }
}

/**
 * 用 Gemini + Google 搜尋，為「新進榜」個股說明近期催化劑（發生了什麼）。
 * 回傳 Map<symbol, reason>。grounding 與結構化輸出不相容，故用容錯 JSON 解析。
 */
async function explainNewEntrants(newStocks, apiKey) {
  const lines = newStocks
    .map((s) => `${s.symbol} | ${s.name} | ${s.theme} | ${s.changePercent.toFixed(2)}%`)
    .join("\n");
  const prompt = `以下是今天「首次進入台股成交值前 50」的個股（代碼 | 名稱 | 題材 | 當日漲跌幅）：
${lines}

請用 Google 搜尋它們「最近幾天」的相關新聞，逐檔說明：這檔股票為何會突然放量、衝進成交值前 50？請指出「具體催化劑」（例如財報/財測、營收、法說會、新產品或大訂單、外資/投信買超、分析師調升、題材輪動、除權息、突發事件等）。每檔「一句話、25 字內」、繁體中文、務實具體；若查無明確消息，請說「近期無明確個股消息，可能受族群輪動帶動」。
只輸出 JSON 陣列，格式：[{"symbol":"代碼","reason":"一句話原因"}]，不要任何其他文字或 markdown。`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
  };
  const data = await callGemini(apiKey, body);
  const text = candidateText(data);
  const map = new Map();
  for (const it of parseJsonObjects(text)) {
    if (it.symbol && it.reason) map.set(it.symbol, it.reason);
  }
  if (map.size === 0) throw new Error("新進榜回應無可解析的 JSON");
  return map;
}

/** 從（可能被截斷的）grounded 回應文字抽出 JSON 物件陣列。 */
function parseJsonObjects(text) {
  const s = text.indexOf("[");
  const e = text.lastIndexOf("]");
  if (s >= 0 && e > s) {
    try {
      const arr = JSON.parse(text.slice(s, e + 1));
      if (Array.isArray(arr)) return arr;
    } catch {}
  }
  const out = [];
  for (const m of text.match(/\{[^{}]*\}/g) ?? []) {
    try {
      out.push(JSON.parse(m));
    } catch {}
  }
  return out;
}

/**
 * 容錯解析「今日市場焦點」單一 JSON 物件。grounded 回應偶有未跳脫的內層引號（新聞標題常見），
 * 導致整包 JSON.parse 失敗；此時改逐欄位/逐事件搶救：highlights 以邊界正則抽出，
 * eventsPast / eventsUpcoming 以扁平物件正則逐筆解析（壞的單筆丟棄，不連累整份焦點）。
 */
function parseBriefing(text) {
  const clean = text.replace(/```json|```/g, "");
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s >= 0 && e > s) {
    try {
      return JSON.parse(clean.slice(s, e + 1)); // 乾淨優先
    } catch {}
  }
  const highlights = (clean.match(/"highlights"\s*:\s*"([\s\S]*?)"\s*,\s*"events/) || [])[1] || "";
  const grabArr = (key) => {
    const m = clean.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    const out = [];
    for (const obj of (m?.[1] ?? "").match(/\{[^{}]*\}/g) ?? []) {
      try {
        out.push(JSON.parse(obj));
      } catch {}
    }
    return out;
  };
  return { highlights, eventsPast: grabArr("eventsPast"), eventsUpcoming: grabArr("eventsUpcoming") };
}

/**
 * 用 Gemini + Google 搜尋產生「今日市場焦點」：成交重點（highlights）+
 * 已發生（eventsPast）與即將到來（eventsUpcoming）的重大事件。失敗則丟例外（後備為 null）。
 */
async function marketBriefing(topStocks, themeSummary, apiKey, tradingDate) {
  const stockLines = topStocks
    .map(
      (s) =>
        `${s.symbol} | ${s.name} | ${s.theme} | ${s.changePercent.toFixed(2)}% | ${(
          s.dollarVolume / 1e8
        ).toFixed(1)}億`,
    )
    .join("\n");
  const themeLines = themeSummary.length
    ? themeSummary.map((t) => `${t.theme}（${t.symbols.join("、")}）`).join("\n")
    : "（無）";

  const prompt = `今天分析的是台股 ${tradingDate} 的收盤資料。以下是當日成交金額最高的個股（代碼 | 名稱 | 題材 | 漲跌幅 | 成交金額）：
${stockLines}

當日發動的題材族群：
${themeLines}

請用 Google 搜尋「最近幾天」的台股新聞，完成三件事，全部繁體中文、務實具體，並「聚焦上面這些榜上熱門股與族群」：
1. highlights：用 2–4 句話總結「本日成交重點」——資金為何集中在這些個股/族群、誰帶動了成交量、市場在交易什麼故事（可帶到台股大盤、外資/投信動向、美股/費半連動）。
2. eventsPast：當日（或最近一兩天）已發生、且與這些個股/族群相關的重大事件（財報、營收、法說會、外資評等、產業利多/利空、總經數據等），每筆 title（簡短標題）+ detail（一句說明）。最多 5 筆；若無明確消息給空陣列。
3. eventsUpcoming：未來幾天值得注意的重要事件（重要法說會、月營收公布、除權息、央行/Fed、CPI/出口數據、產品發表等），每筆 date（如 "6/10" 或 "本週四"）+ title + detail。最多 5 筆；若無則給空陣列。

只輸出 JSON，格式：
{"highlights":"...","eventsPast":[{"title":"...","detail":"..."}],"eventsUpcoming":[{"date":"...","title":"...","detail":"..."}]}
不要任何其他文字或 markdown。`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } },
  };
  const data = await callGemini(apiKey, body);
  const text = candidateText(data);
  const parsed = parseBriefing(text);
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const out = {
    highlights: str(parsed.highlights),
    eventsPast: (Array.isArray(parsed.eventsPast) ? parsed.eventsPast : [])
      .filter((x) => x && (x.title || x.detail))
      .slice(0, 5)
      .map((x) => ({ title: str(x.title), detail: str(x.detail) })),
    eventsUpcoming: (Array.isArray(parsed.eventsUpcoming) ? parsed.eventsUpcoming : [])
      .filter((x) => x && (x.title || x.detail))
      .slice(0, 5)
      .map((x) => ({ date: str(x.date), title: str(x.title), detail: str(x.detail) })),
  };
  // 全空視為失敗（交給下一班重試或沿用既有同日版本），避免渲染空白焦點卡。
  if (!out.highlights && out.eventsPast.length === 0 && out.eventsUpcoming.length === 0) {
    throw new Error("市場焦點回應無可解析內容");
  }
  return out;
}

/** 台北現在的日期（YYYY-MM-DD）與小時。 */
function taipeiNow() {
  const t = new Date(Date.now() + 8 * 3_600_000);
  return { date: t.toISOString().slice(0, 10), hour: t.getUTCHours() };
}

/** ds 的前一個平日（不含國定假日判斷；遇連假會多抓一次，無害）。 */
function prevWeekday(ds) {
  const d = new Date(`${ds}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const geminiKey = await readKey("GEMINI_API_KEY");

  // 失敗補跑 + 省成本：若「此交易日」資料已完整產生（有金鑰時需含 AI 市場焦點），直接結束。
  // 使每 30 分一班的多次排程只在第一次真正運算、其餘快速略過；某班 AI 失敗時下一班會自動重試補上。
  // 以環境變數 FORCE=1 可強制重算（手動需要時用）。
  //
  // 有金鑰時，必須已產出「今日市場焦點」(marketBriefing) 才算完成。它最易因 grounded 回應
  // JSON 破損而失敗；若改用「焦點或題材其一」當完成條件，會讓失敗的焦點被永久略過、再也不補。
  let published = null;
  if (!process.env.FORCE) {
    try {
      published = JSON.parse(await fs.readFile(OUT_FILE, "utf8"));
    } catch {
      // 無既有檔或解析失敗 → 照常產生。
    }
  }
  const pubDate = typeof published?.asOf === "string" ? published.asOf.slice(0, 10) : "";
  const pubDone =
    !!published && (published.rows?.length ?? 0) > 0 && (geminiKey ? !!published.marketBriefing : true);

  // 先判斷「根本不需要抓」再碰網路：2026-09～11 的 139 次 snapshot 失敗中有 55 次發生在
  // 當天早已發布之後 —— 後續班次仍去下載上櫃 5MB 全市場檔、被切斷就記一次失敗，純屬雜訊。
  //  - 今天的資料已完整 → 不用抓。
  //  - 收盤資料公布前（台北 14 點前，夜間延遲班次）且已有上一個平日的完整資料 → 不可能有新資料。
  //    （若上一個平日沒更新到，則照常抓，讓夜間班次有機會補回。）
  if (pubDone) {
    const now = taipeiNow();
    if (pubDate === now.date || (now.hour < 14 && pubDate === prevWeekday(now.date))) {
      console.log(`最新資料（${pubDate}）已完整，無新資料可抓，略過（補跑機制）。`);
      return;
    }
  }

  console.log("抓取上市＋上櫃當日全市場成交資料…");
  const { date, rows: allRows } = await fetchAllLatest();
  if (allRows.length === 0) throw new Error("找不到可用的台股當日資料（可能為假日或來源暫時無回應）");
  console.log(`最新交易日：${date}（上市＋上櫃共 ${allRows.length} 檔個股）`);

  // 抓完才知道來源最新日仍是已完成的那天（盤後尚未公布、或假日）→ 略過。
  if (pubDone && pubDate === date) {
    console.log(`今日（${date}）資料已完整，略過重算（補跑機制）。`);
    return;
  }

  const cache = await loadCache();
  const industryMap = await loadIndustryMap(cache);
  console.log(`產業別/股數對照：${industryMap.size} 檔`);

  // 依成交金額排序取前 50（含漲跌幅/產業別/市值）。
  const picked = rankTop(allRows, industryMap);

  // 取得「前一交易日」基準 → 計算 isNew / rankChange / streak。優先用歷史封存檔。
  const prev = (await readPrevFromHistory(date)) ?? (await fetchPrev());
  const sameDay = prev?.date != null && prev.date === date;
  console.log(
    prev
      ? `已取得前一份快照（${prev.ranks.size} 檔，交易日 ${prev.date}${sameDay ? "，同日重跑" : ""}）作對比`
      : "無前一份快照，新進榜/躍升/在榜天數本次以 1 起算",
  );

  // AI 題材分析（一次呼叫；缺金鑰或失敗則後備為產業別）。
  let aiSource = "none";
  let themesByTicker = new Map();
  let summaryRaw = [];
  if (geminiKey) {
    try {
      const aiInput = picked.map((p) => ({
        symbol: p.symbol,
        name: p.name,
        sector: p.sector,
        changePercent: p.changePercent,
      }));
      const r = await enrichWithGemini(aiInput, geminiKey);
      themesByTicker = r.themesByTicker;
      summaryRaw = r.summary;
      aiSource = "gemini";
      for (const p of picked) {
        const th = themesByTicker.get(p.symbol);
        if (th) cache[p.symbol] = { ...cache[p.symbol], theme: th, themeFetchedAt: Date.now() };
      }
      await saveCache(cache);
      console.log(`Gemini 題材分析完成（${themesByTicker.size} 檔、${summaryRaw.length} 組題材）`);
    } catch (e) {
      console.warn(`Gemini 失敗，改用後備題材（產業別）：${e.message}`);
    }
  } else {
    console.log("未設定 GEMINI_API_KEY，題材使用產業別後備");
  }

  const rows = picked.map((p, i) => {
    const t = p.symbol;
    const currentRank = i + 1;
    const prevRank = prev?.ranks.get(t);
    const inPrev = prev?.ranks.has(t) ?? false;
    // 題材：Gemini → 快取題材（未過期）→ 產業別
    const cached = cache[t];
    const cachedTheme =
      cached?.theme && cached.themeFetchedAt && Date.now() - cached.themeFetchedAt < THEME_TTL_MS
        ? cached.theme
        : null;
    const theme = themesByTicker.get(t) || cachedTheme || p.sector;

    let streak;
    if (!prev || !inPrev) {
      streak = 1;
    } else {
      const prevStreak = prev.rows.get(t)?.streak ?? 1;
      streak = sameDay ? prevStreak : prevStreak + 1;
    }

    return {
      symbol: t,
      market: p.market,
      name: p.name,
      price: p.price,
      changePercent: p.changePercent,
      dollarVolume: p.dollarVolume,
      marketCap: p.marketCap,
      sector: p.sector,
      theme,
      isNew: prev ? !inPrev : false,
      rankChange: prevRank ? prevRank - currentRank : null,
      streak,
    };
  });

  // 摘要：以我方資料計算 count / avgChange，只保留有對應到的成員。
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  let themeSummary = summaryRaw
    .map((s) => {
      const symbols = (s.symbols ?? []).filter((sym) => bySymbol.has(sym));
      const changes = symbols.map((sym) => bySymbol.get(sym).changePercent);
      const avgChange = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;
      return { theme: s.theme, reason: s.reason, symbols, count: symbols.length, avgChange };
    })
    .filter((s) => s.count > 0);

  // 新進榜雷達：對 isNew 的個股用 Gemini + Google 搜尋查近期催化劑。
  let newEntrants = rows
    .filter((r) => r.isNew)
    .map((r) => ({ symbol: r.symbol, name: r.name, theme: r.theme, changePercent: r.changePercent, reason: "" }));
  if (geminiKey && newEntrants.length > 0) {
    try {
      const reasons = await explainNewEntrants(newEntrants, geminiKey);
      newEntrants = newEntrants.map((n) => ({ ...n, reason: reasons.get(n.symbol) ?? "" }));
      console.log(`新進榜 AI 說明完成（${reasons.size}/${newEntrants.length} 檔，含 Google 搜尋）`);
    } catch (e) {
      console.warn(`新進榜 AI 說明失敗：${e.message}`);
    }
  }

  // 今日市場焦點：成交重點 + 重大事件，Gemini + Google 搜尋。
  let marketBrief = null;
  if (geminiKey) {
    try {
      const topForBrief = rows.slice(0, 15);
      marketBrief = await marketBriefing(topForBrief, themeSummary, geminiKey, date);
      console.log(
        `今日市場焦點完成（已發生 ${marketBrief.eventsPast.length} 筆、即將 ${marketBrief.eventsUpcoming.length} 筆，含 Google 搜尋）`,
      );
    } catch (e) {
      console.warn(`今日市場焦點失敗：${e.message}`);
    }
  }

  // 防止單次 Gemini 失敗讓既有區塊忽然消失：同一交易日若本次未產出
  // marketBriefing / themeSummary / 新進榜原因，沿用已存在的上一份（grounded 呼叫較不穩）。
  try {
    const prevOut = JSON.parse(await fs.readFile(OUT_FILE, "utf8"));
    if (typeof prevOut.asOf === "string" && prevOut.asOf.slice(0, 10) === date) {
      if (!marketBrief && prevOut.marketBriefing) {
        marketBrief = prevOut.marketBriefing;
        console.log("本次無今日市場焦點，沿用既有同日版本");
      }
      if (themeSummary.length === 0 && Array.isArray(prevOut.themeSummary) && prevOut.themeSummary.length) {
        themeSummary = prevOut.themeSummary;
        console.log("本次無發動題材，沿用既有同日版本");
      }
      // 新進榜原因：本次某檔查無原因但舊檔有，沿用該檔原因。
      if (Array.isArray(prevOut.newEntrants) && prevOut.newEntrants.length) {
        const prevReason = new Map(prevOut.newEntrants.map((n) => [n.symbol, n.reason]));
        newEntrants = newEntrants.map((n) => (n.reason ? n : { ...n, reason: prevReason.get(n.symbol) ?? "" }));
      }
    }
  } catch {}

  // aiSource 反映實際產物：只要有題材或市場焦點（本次或沿用）即標記 gemini，
  // 避免「題材呼叫失敗但市場焦點成功」時誤標 none、讓發動題材區塊藏起真有的資料。
  if (geminiKey && (themeSummary.length > 0 || marketBrief)) aiSource = "gemini";

  const out = {
    rows,
    asOf: `${date}T13:30:00+08:00`, // 台股收盤 13:30（台北）
    generatedAt: new Date().toISOString(),
    source: "twse",
    aiSource,
    themeSummary,
    newEntrants,
    marketBriefing: marketBrief,
  };
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(out, null, 2), "utf8");

  // 另存歷史快照並重建 index.json / trends.json。
  await writeHistory(out);

  const newCount = rows.filter((r) => r.isNew).length;
  console.log(
    `完成：寫出 ${rows.length} 檔個股 → public/rankings.json + public/history/${date}.json（AI=${aiSource}，新進榜 ${newCount} 檔）`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
