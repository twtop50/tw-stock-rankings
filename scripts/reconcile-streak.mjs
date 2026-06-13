// 重接「在榜天數」(streak) 成單一連續鏈，消除 backfill 與每日排程的接縫。
// 純離線、零 API：只覆蓋每列的 streak / rankChange / isNew，其餘（marketBriefing /
// themeSummary / newEntrants / price / theme / aiSource）一律原封不動。
//
// 用法： node scripts/reconcile-streak.mjs
// 時機：回補後、或正式排程覆寫造成 streak 斷層時，跑一次即可（冪等、可重跑）。

import { promises as fs } from "node:fs";
import path from "node:path";
import { HISTORY_DIR, PUBLIC_DIR, rebuildHistoryMeta } from "./lib/core.mjs";

async function main() {
  const files = (await fs.readdir(HISTORY_DIR))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort(); // 舊 → 新
  if (files.length === 0) {
    console.error("public/history 下無歷史快照，無需重接。");
    process.exit(1);
  }

  let prevStreak = new Map(); // symbol → 前一交易日 streak
  let prevRank = new Map(); // symbol → 前一交易日名次
  let first = true;
  let latestData = null;
  let latestDate = null;

  for (const f of files) {
    const p = path.join(HISTORY_DIR, f);
    const data = JSON.parse(await fs.readFile(p, "utf8"));
    const rows = data.rows ?? [];
    const nextStreak = new Map();
    const nextRank = new Map();

    rows.forEach((r, i) => {
      const currentRank = i + 1;
      const inPrev = prevRank.has(r.symbol);
      // 第一天保留既有 streak 當基準；其後從前一日往上接。
      if (!first) {
        r.streak = inPrev ? prevStreak.get(r.symbol) + 1 : 1;
        r.isNew = !inPrev;
        r.rankChange = inPrev ? prevRank.get(r.symbol) - currentRank : null;
      }
      nextStreak.set(r.symbol, r.streak);
      nextRank.set(r.symbol, currentRank);
    });

    await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
    prevStreak = nextStreak;
    prevRank = nextRank;
    first = false;
    latestData = data;
    latestDate = f.slice(0, 10);
  }

  // 同步 rankings.json（= 最新一天）；僅當不會讓它回退到較舊交易日時才覆寫。
  const rankFile = path.join(PUBLIC_DIR, "rankings.json");
  let synced = true;
  try {
    const cur = JSON.parse(await fs.readFile(rankFile, "utf8"));
    const curDate = typeof cur.asOf === "string" ? cur.asOf.slice(0, 10) : "";
    if (curDate > latestDate) synced = false;
  } catch {}
  if (synced) {
    await fs.writeFile(rankFile, JSON.stringify(latestData, null, 2), "utf8");
  }

  console.log(
    `已重接 ${files.length} 天 streak（最新 ${latestDate}）；rankings.json ${synced ? "已同步" : "未覆寫（現有較新）"}。`,
  );
  await rebuildHistoryMeta();
  console.log("已重建 index.json / trends.json。");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
