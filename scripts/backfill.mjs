// 回補歷史快照：抓取過去 N 個交易日台股（上市＋上櫃）成交值前 50 名個股，
// 寫入 public/history/<交易日>.json，並重建 index.json / trends.json。一次性／偶爾手動執行。
//
// 用法： node scripts/backfill.mjs [N]      （N＝回補的交易日數，預設 60）
// 環境變數 / .env.local：GEMINI_API_KEY（選用）。
//
// 與每日 snapshot 的差異：
//  - isNew / rankChange / streak 由「回補序列中相鄰的前一交易日」推算。
//  - 題材標籤：彙整所有日子出現過的個股，呼叫 Gemini 一次（分批）統一標註後套用各日。
//  - 不做 grounded 呼叫（新進榜催化劑、今日市場焦點），故歷史日這些欄位為空。
//  - 上櫃指定日端點（TPEx 改版後）較不穩；某日若 TPEx 失敗，該日僅含上市，仍可用。

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  fmtDate,
  readKey,
  fetchAllByDate,
  loadCache,
  saveCache,
  loadIndustryMap,
  rankTop,
  enrichWithGemini,
  rebuildHistoryMeta,
  HISTORY_DIR,
  THEME_TTL_MS,
} from "./lib/core.mjs";

const DEFAULT_N = 60;

/** 從昨天往回收集 count 個「有資料」的交易日（新到舊）。 */
async function collectTradingDays(count) {
  const days = [];
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  for (let i = 0; i < count * 2 + 20 && days.length < count; i++) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const ds = fmtDate(cursor);
      const rows = await fetchAllByDate(ds);
      if (rows.length > 0) {
        days.push({ date: ds, rows });
        console.log(`  取得 ${ds}（${rows.length} 檔）`);
      } else {
        console.log(`  ${ds} 無資料（假日或來源未提供），略過`);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return days; // 新到舊
}

async function main() {
  const n = Math.max(1, parseInt(process.argv[2] ?? "", 10) || DEFAULT_N);
  const geminiKey = await readKey("GEMINI_API_KEY");

  console.log(`回補最近 ${n} 個交易日（多抓 1 日作 isNew/streak 基準）…`);
  const daysDesc = await collectTradingDays(n + 1);
  if (daysDesc.length === 0) {
    console.error("找不到任何可用的交易日資料");
    process.exit(1);
  }
  const daysAsc = [...daysDesc].reverse(); // 由舊到新處理，方便鏈式計算 streak
  console.log(`共取得 ${daysAsc.length} 個交易日：${daysAsc[0].date} ~ ${daysAsc[daysAsc.length - 1].date}`);

  const cache = await loadCache();
  const industryMap = await loadIndustryMap(cache);

  // 逐日排名。
  const perDay = daysAsc.map((day) => ({ date: day.date, picked: rankTop(day.rows, industryMap) }));

  // 題材標籤：彙整所有日子出現過的個股，分批呼叫 Gemini 一次統一標註。
  let themesByTicker = new Map();
  const metaBySymbol = new Map();
  for (const { picked } of perDay) {
    for (const p of picked) {
      if (!metaBySymbol.has(p.symbol)) metaBySymbol.set(p.symbol, { name: p.name, sector: p.sector });
    }
  }
  if (geminiKey && metaBySymbol.size > 0) {
    const allSymbols = [...metaBySymbol.keys()];
    const CHUNK = 100;
    try {
      for (let i = 0; i < allSymbols.length; i += CHUNK) {
        const chunk = allSymbols.slice(i, i + CHUNK).map((sym) => ({
          symbol: sym,
          name: metaBySymbol.get(sym).name,
          sector: metaBySymbol.get(sym).sector,
          changePercent: 0,
        }));
        const r = await enrichWithGemini(chunk, geminiKey);
        for (const [sym, th] of r.themesByTicker) themesByTicker.set(sym, th);
        console.log(`  題材標註 ${Math.min(i + CHUNK, allSymbols.length)}/${allSymbols.length} …`);
      }
      for (const [sym, th] of themesByTicker) {
        cache[sym] = { ...cache[sym], theme: th, themeFetchedAt: Date.now() };
      }
      await saveCache(cache);
      console.log(`Gemini 題材標註完成（${themesByTicker.size}/${metaBySymbol.size} 檔）`);
    } catch (e) {
      console.warn(`Gemini 題材標註失敗，改用快取/產業別後備：${e.message}`);
    }
  } else {
    console.log("未設定 GEMINI_API_KEY，題材使用快取/產業別後備");
  }

  const themeOf = (sym, sector) => {
    if (themesByTicker.get(sym)) return themesByTicker.get(sym);
    const cached = cache[sym];
    if (cached?.theme && cached.themeFetchedAt && Date.now() - cached.themeFetchedAt < THEME_TTL_MS) {
      return cached.theme;
    }
    return sector ?? "—";
  };

  const haveThemes =
    themesByTicker.size > 0 ||
    [...metaBySymbol.keys()].some((t) => {
      const c = cache[t];
      return c?.theme && c.themeFetchedAt && Date.now() - c.themeFetchedAt < THEME_TTL_MS;
    });

  // 鏈式計算 isNew / rankChange / streak（由舊到新），輸出最近 n 日。
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  let prevRanks = new Map();
  let prevStreaks = new Map();
  const startIdx = Math.max(0, perDay.length - n); // 最舊一日當基準、不輸出
  let written = 0;

  for (let i = 0; i < perDay.length; i++) {
    const { date, picked } = perDay[i];
    const hasPrev = i > 0;

    const rows = picked.map((p, idx) => {
      const currentRank = idx + 1;
      const prevRank = prevRanks.get(p.symbol);
      const inPrev = prevRanks.has(p.symbol);
      let streak;
      if (!hasPrev || !inPrev) streak = 1;
      else streak = (prevStreaks.get(p.symbol) ?? 1) + 1;
      return {
        symbol: p.symbol,
        market: p.market,
        name: p.name,
        price: p.price,
        changePercent: p.changePercent,
        dollarVolume: p.dollarVolume,
        marketCap: p.marketCap,
        sector: p.sector,
        theme: themeOf(p.symbol, p.sector),
        isNew: hasPrev ? !inPrev : false,
        rankChange: prevRank ? prevRank - currentRank : null,
        streak,
      };
    });

    const nextRanks = new Map();
    const nextStreaks = new Map();
    rows.forEach((r, idx) => {
      nextRanks.set(r.symbol, idx + 1);
      nextStreaks.set(r.symbol, r.streak);
    });
    prevRanks = nextRanks;
    prevStreaks = nextStreaks;

    if (i < startIdx) continue;

    const out = {
      rows,
      asOf: `${date}T13:30:00+08:00`,
      generatedAt: new Date().toISOString(),
      source: "twse",
      aiSource: haveThemes ? "gemini" : "none",
      themeSummary: [],
      newEntrants: [],
      marketBriefing: null,
      backfilled: true,
    };

    // 保險：若該日已有「正式日」檔（含 grounded AI），保留其 AI 整理，只更新價量/streak。
    try {
      const existing = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, `${date}.json`), "utf8"));
      if (existing && existing.backfilled !== true) {
        out.marketBriefing = existing.marketBriefing ?? null;
        out.themeSummary = existing.themeSummary ?? [];
        out.newEntrants = existing.newEntrants ?? [];
        out.aiSource = existing.aiSource ?? out.aiSource;
        delete out.backfilled;
        const themeBySym = new Map((existing.rows ?? []).map((r) => [r.symbol, r.theme]));
        out.rows = rows.map((r) =>
          themeBySym.has(r.symbol) ? { ...r, theme: themeBySym.get(r.symbol) } : r,
        );
      }
    } catch {}

    await fs.writeFile(path.join(HISTORY_DIR, `${date}.json`), JSON.stringify(out, null, 2), "utf8");
    written++;
  }

  console.log(`重建 index.json / trends.json …`);
  const meta = await rebuildHistoryMeta();
  console.log(`完成：回補 ${written} 個交易日，history 共 ${meta.count} 檔。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
