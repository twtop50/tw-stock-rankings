"use client";

import { useState } from "react";
import type { SortDir, SortKey } from "@/types/stock";

interface Props {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: SortDir;
  align?: "left" | "right";
  onSort: (key: SortKey) => void;
  className?: string;
  hint?: string; // 有值時於標題旁顯示 ⓘ；點一下展開說明（手機可用，非僅 hover）
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
  const [showHint, setShowHint] = useState(false);
  const isActive = activeKey === sortKey;
  const indicator = isActive ? (dir === "desc" ? "▼" : "▲") : "";

  return (
    <th
      scope="col"
      className={`sticky top-0 z-10 whitespace-nowrap bg-slate-900/95 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider backdrop-blur ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      <span
        className={`relative inline-flex items-center gap-1 ${
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
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowHint((v) => !v);
              }}
              onBlur={() => setShowHint(false)}
              aria-label={hint}
              title={hint}
              className="text-[11px] font-normal normal-case text-slate-500 hover:text-slate-300"
            >
              ⓘ
            </button>
            {showHint && (
              <span
                className={`absolute top-full z-30 mt-1 w-56 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-xl ${
                  align === "right" ? "right-0" : "left-0"
                }`}
              >
                {hint}
              </span>
            )}
          </>
        )}
      </span>
    </th>
  );
}
