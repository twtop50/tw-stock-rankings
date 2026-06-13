"use client";

import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * 手機（<sm）顯示可點的標題列，內容預設收合（讓使用者快速滑到下方排行榜）。
 * 桌機（≥sm）隱藏標題列、內容永遠展開——維持現狀。
 */
export default function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mb-3 sm:mb-0">
      {/* 手機才出現的收合標題列 */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-left sm:hidden"
      >
        <span className="text-sm font-semibold text-white">{title}</span>
        <span className="text-xs text-slate-400">{open ? "收合 ▲" : "展開 ▼"}</span>
      </button>

      {/* 內容：手機依 open 顯示；桌機永遠顯示 */}
      <div className={`${open ? "mt-2 block" : "hidden"} sm:mt-0 sm:block`}>{children}</div>
    </div>
  );
}
