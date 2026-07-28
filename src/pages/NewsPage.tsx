import { useMemo, useState } from 'react';
import {
  Newspaper,
  Star,
  ExternalLink,
  TrendingUp,
  ShieldAlert,
  Landmark,
  Receipt,
  Network,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  FileText,
} from 'lucide-react';
import NewsSummary from '../components/NewsSummary';
import {
  STOCKS,
  CATEGORY_ORDER,
  CATEGORY_META,
  getStock,
  allStatements,
  loadFavorites,
  saveFavorites,
  type CategoryKey,
  type CategoryData,
  type Trend,
  type StatementDoc,
} from '../services/financialsData';

const CATEGORY_ICON: Record<CategoryKey, typeof TrendingUp> = {
  revenue: TrendingUp,
  risk: ShieldAlert,
  costOfCapital: Landmark,
  costs: Receipt,
  supplyChain: Network,
};

function trendClasses(trend?: Trend): string {
  if (trend === 'up') return 'text-emerald-600 dark:text-emerald-400';
  if (trend === 'down') return 'text-rose-600 dark:text-rose-400';
  return 'text-gray-500 dark:text-zinc-400';
}

function TrendIcon({ trend }: { trend?: Trend }) {
  if (trend === 'up') return <ArrowUpRight className="w-3.5 h-3.5" />;
  if (trend === 'down') return <ArrowDownRight className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
}

function CategoryPanel({
  categoryKey,
  data,
}: {
  categoryKey: CategoryKey;
  data: CategoryData;
}) {
  const meta = CATEGORY_META[categoryKey];
  const Icon = CATEGORY_ICON[categoryKey];

  return (
    <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 flex flex-col">
      {/* Header */}
      <div className="flex items-start gap-3 px-5 pt-5">
        <div className="p-2 bg-gray-100 dark:bg-zinc-900 rounded-lg">
          <Icon className="w-4 h-4 text-gray-700 dark:text-zinc-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {meta.label}
          </h3>
          <p className="text-xs text-gray-400 dark:text-zinc-500">{meta.blurb}</p>
        </div>
      </div>

      <p className="px-5 pt-3 text-xs leading-relaxed text-gray-600 dark:text-zinc-300">
        {data.summary}
      </p>

      {/* Stat tiles */}
      <div className="grid grid-cols-3 gap-2 px-5 pt-4">
        {data.tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-md bg-gray-50 dark:bg-zinc-900 px-2.5 py-2"
          >
            <div className="text-[11px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 leading-tight">
              {tile.label}
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-base font-semibold text-gray-900 dark:text-white tabular-nums">
                {tile.value}
              </span>
              {tile.note && (
                <span className="text-[10px] text-gray-400 dark:text-zinc-500">
                  {tile.note}
                </span>
              )}
            </div>
            {tile.change && (
              <div
                className={`mt-0.5 flex items-center gap-0.5 text-[11px] font-medium ${trendClasses(
                  tile.trend
                )}`}
              >
                <TrendIcon trend={tile.trend} />
                {tile.change}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Sub-categories */}
      <div className="px-5 py-4 mt-1 space-y-2.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-zinc-500">
          Sub-categories
        </div>
        {data.subcategories.map((sub) => (
          <div key={sub.name} className="flex gap-2.5">
            <span className={`mt-1 ${trendClasses(sub.trend)}`}>
              <TrendIcon trend={sub.trend} />
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-900 dark:text-white">
                {sub.name}
              </div>
              <div className="text-xs text-gray-500 dark:text-zinc-400 leading-snug">
                {sub.detail}
              </div>
              {sub.tags && sub.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {sub.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-900 text-[10px] text-gray-500 dark:text-zinc-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementRow({
  doc,
  ticker,
  isFavorite,
  onToggle,
}: {
  doc: StatementDoc;
  ticker: string;
  isFavorite: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3 px-4 border-b border-gray-100 dark:border-zinc-900 last:border-b-0">
      <button
        onClick={() => onToggle(doc.id)}
        aria-label={isFavorite ? 'Remove favorite' : 'Add favorite'}
        title={isFavorite ? 'Remove favorite' : 'Add favorite'}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-900 transition-colors"
      >
        <Star
          className={`w-4 h-4 ${
            isFavorite
              ? 'fill-amber-400 text-amber-400'
              : 'text-gray-300 dark:text-zinc-600'
          }`}
        />
      </button>
      <div className="p-1.5 bg-gray-100 dark:bg-zinc-900 rounded">
        <FileText className="w-4 h-4 text-gray-500 dark:text-zinc-400" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded bg-gray-900 dark:bg-white text-white dark:text-black text-[10px] font-semibold">
            {ticker}
          </span>
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {doc.title}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-gray-400 dark:text-zinc-500">
          {doc.type} · {doc.period} · {doc.date}
        </div>
      </div>
      <a
        href={doc.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white px-2 py-1"
      >
        Open <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}

export default function NewsPage() {
  // Stock subbar selection: a ticker, or 'favorites' pseudo-tab.
  const [active, setActive] = useState<string>(STOCKS[0]?.ticker ?? 'favorites');
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      saveFavorites(next);
      return next;
    });
  };

  const stock = active === 'favorites' ? undefined : getStock(active);

  const favoriteDocs = useMemo(
    () => allStatements().filter((d) => favorites.includes(d.id)),
    [favorites]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-3">
        <div className="p-2.5 bg-gray-100 dark:bg-zinc-900 rounded-lg">
          <Newspaper className="w-5 h-5 text-gray-700 dark:text-zinc-300" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            News
          </h1>
          <p className="text-gray-500 dark:text-zinc-400 mt-0.5 text-sm">
            Financial statements by stock — revenue, risk, cost of capital,
            costs and supply-chain dependencies. Star the filings you follow.
          </p>
        </div>
      </div>

      {/* Stock subbar */}
      <div className="border-b border-gray-200 dark:border-zinc-800 mb-6">
        <nav className="flex gap-1 overflow-x-auto pb-px">
          <button
            onClick={() => setActive('favorites')}
            className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active === 'favorites'
                ? 'border-amber-400 text-gray-900 dark:text-white'
                : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
            }`}
          >
            <Star
              className={`w-4 h-4 ${
                active === 'favorites'
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-gray-400 dark:text-zinc-500'
              }`}
            />
            Favorites
            {favorites.length > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-semibold">
                {favorites.length}
              </span>
            )}
          </button>

          {STOCKS.map((s) => (
            <button
              key={s.ticker}
              onClick={() => setActive(s.ticker)}
              className={`flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                active === s.ticker
                  ? 'border-gray-900 dark:border-white text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'
              }`}
            >
              <span className="font-semibold">{s.ticker}</span>
              <span className="text-xs text-gray-400 dark:text-zinc-500 hidden sm:inline">
                {s.name}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* Favorites view */}
      {active === 'favorites' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-900">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Favorite financial statements
              </h2>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                Saved across all stocks · stored in your browser
              </p>
            </div>
            {favoriteDocs.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Star className="w-6 h-6 mx-auto text-gray-300 dark:text-zinc-700" />
                <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
                  No favorites yet. Open a stock and star a statement to pin it
                  here.
                </p>
              </div>
            ) : (
              <div>
                {favoriteDocs.map((doc) => (
                  <StatementRow
                    key={doc.id}
                    doc={doc}
                    ticker={doc.ticker}
                    isFavorite
                    onToggle={toggleFavorite}
                  />
                ))}
              </div>
            )}
          </div>
          <NewsSummary />
        </div>
      )}

      {/* Per-stock view */}
      {stock && (
        <div className="space-y-6">
          {/* Stock header */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xl font-semibold text-gray-900 dark:text-white">
              {stock.ticker}
            </span>
            <span className="text-gray-500 dark:text-zinc-400">
              {stock.name}
            </span>
            <span className="text-xs text-gray-400 dark:text-zinc-500 px-2 py-0.5 rounded bg-gray-100 dark:bg-zinc-900">
              {stock.sector}
            </span>
            <span className="ml-auto text-xs text-gray-400 dark:text-zinc-500">
              as of {stock.asOf}
            </span>
          </div>

          {/* Category dashboard */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CATEGORY_ORDER.map((key) => (
              <CategoryPanel
                key={key}
                categoryKey={key}
                data={stock.categories[key]}
              />
            ))}
          </div>

          {/* Statements */}
          <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800">
            <div className="px-5 py-4 border-b border-gray-100 dark:border-zinc-900">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Financial statements
              </h2>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                Star to add to your favorites
              </p>
            </div>
            <div>
              {stock.statements.map((doc) => (
                <StatementRow
                  key={doc.id}
                  doc={doc}
                  ticker={stock.ticker}
                  isFavorite={favorites.includes(doc.id)}
                  onToggle={toggleFavorite}
                />
              ))}
            </div>
          </div>

          {/* Live headlines */}
          <NewsSummary />
        </div>
      )}
    </div>
  );
}
