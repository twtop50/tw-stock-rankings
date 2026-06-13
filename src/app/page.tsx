import RankingTable from "@/components/RankingTable";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          台股成交值排行 <span className="text-rose-400">Top 50</span>
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          上市＋上櫃依當日成交金額排序。點擊任一欄位標題可切換排序方式。
        </p>
      </header>
      <RankingTable />
      <Footer />
    </main>
  );
}
