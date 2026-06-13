/**
 * 漲跌著色慣例。
 * 台股慣例：漲 = 紅、跌 = 綠。
 * 若要改回美股慣例（漲 = 綠、跌 = 紅），把此值改為 "us"。
 */
export const COLOR_CONVENTION: "us" | "tw" = "tw";

/**
 * 將大額金額（成交金額／市值，單位：新台幣元）格式化為台股慣用單位。
 * 例：2.53e13 → 25.30兆；3.0e10 → 300.0億；5.0e7 → 5000萬。
 */
export function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}兆`;
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}億`;
  if (abs >= 1e4) return `${(value / 1e4).toFixed(0)}萬`;
  return value.toFixed(0);
}

/** 將股價格式化為新台幣兩位小數（例：925.00、1,205.00）。 */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value.toLocaleString("zh-TW", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 將漲跌幅格式化為 +1.23% / -0.45%。 */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** 依漲跌方向與著色慣例回傳對應的 Tailwind 文字顏色 class。 */
export function changeColorClass(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "text-slate-400";
  const up = value > 0;
  if (COLOR_CONVENTION === "tw") {
    return up ? "text-rose-400" : "text-emerald-400";
  }
  return up ? "text-emerald-400" : "text-rose-400";
}

/**
 * 產業別字串顯示用。台股的「產業別」已是乾淨的繁中字串（例：半導體業），
 * 原樣回傳即可；保留對全大寫英文（少數 ADR/特殊代碼）的標題化處理。
 */
export function formatSector(sector: string): string {
  if (!sector || sector === "—") return "—";
  if (sector !== sector.toUpperCase()) return sector; // 含小寫或中日韓 → 原樣
  return sector
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\bAnd\b/g, "&");
}

/**
 * 將 asOf（台股某交易日 13:30 收盤，ISO 帶 +08:00）顯示為「交易日期（星期）」。
 * 直接取 ISO 的日期部分即為台股交易日，不需時區換算。
 */
export function formatTradingDate(iso: string): string {
  const d = iso.slice(0, 10); // YYYY-MM-DD（即台股交易日）
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const wd = ["日", "一", "二", "三", "四", "五", "六"][new Date(y, m - 1, day).getDay()];
  return `${d}（${wd}）`;
}

/** 將 ISO 時間戳格式化為使用者本地時間的可讀字串。 */
export function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
