/**
 * 頁尾：免責聲明 + 資料來源標註。
 * 這是一個顯示金融數據與 AI 生成題材的公開網站，免責聲明為必要資訊。
 */
export default function Footer() {
  return (
    <footer className="mt-10 border-t border-slate-800 pt-6 text-xs leading-relaxed text-slate-500">
      <p className="mb-3 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-slate-400">
        ⚠️ <span className="font-medium text-slate-300">免責聲明：</span>
        本站所有數據與「題材／族群」「市場焦點」等分析皆由程式與 AI 自動產生，
        <span className="text-slate-300">僅供參考、非投資建議</span>，
        且可能延遲、不完整或有誤。任何投資決策請自行查證並自負風險，本站不對任何損失負責。
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          行情資料：
          <a
            href="https://www.twse.com.tw/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            證交所
          </a>
          ＋
          <a
            href="https://www.tpex.org.tw/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            櫃買中心
          </a>
          （收盤）
        </span>
        <span>
          題材分析：
          <a
            href="https://ai.google.dev/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            Google Gemini
          </a>
        </span>
        <span>
          走勢圖：
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
          >
            TradingView
          </a>
        </span>
      </div>
    </footer>
  );
}
