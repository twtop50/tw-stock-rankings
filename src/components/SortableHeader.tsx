"use client";

import type { SortDir, SortKey } from "@/types/stock";

interface Props {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  align?: "left" | "right";
  onSort: (key: SortKey) => void;
  className?: string;
  hint?: string; // 有值時於標題旁顯示 ⓘ 並以 tooltip 說明
}

export default function SortableHeader({
  label,
  sortKey,
  activeKey,
  dir,
  align = "left",
  onSort,
  className = "",
  hint,
}: Props) {
  const isActive = activeKey === sortKey;
  const indicator = isActive ? (dir === "desc" ? "▼" : "▲") : "";

  return (
    <th
      scope="col"
      title={hint}
      className={`sticky top-0 z-10 bg-slate-900/95 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider backdrop-blur ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      <span
        className={`inline-flex items-center gap-1 ${
          align === "right" ? "flex-row-reverse" : ""
        }`}
      >
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`inline-flex items-center gap-1 transition-colors hover:text-white ${
            align === "right" ? "flex-row-reverse" : ""
          } ${isActive ? "text-emerald-400" : "text-slate-300"}`}
          aria-sort={isActive ? (dir === "desc" ? "descending" : "ascending") : "none"}
        >
          <span>{label}</span>
          <span className="w-3 text-[10px]">{indicator}</span>
        </button>
        {hint && (
          <span
            title={hint}
            aria-label={hint}
            className="cursor-help text-[11px] font-normal normal-case text-slate-500 hover:text-slate-300"
          >
            ⓘ
          </span>
        )}
      </span>
    </th>
  );
}
