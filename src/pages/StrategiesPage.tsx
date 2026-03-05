import { useState } from 'react';
import { FileText, Download } from 'lucide-react';
import WeekendMomentum from '../components/WeekendMomentum';

const TABS = [
  { id: 'volatility-puts', label: 'Volatility Puts' },
  { id: 'weekend-momentum', label: 'Weekend Momentum' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const WHITEPAPER_URL =
  'https://raw.githubusercontent.com/IamJasonBian/allocation-gym/IamJasonBian/audit-redis-proto/docs/7/iwn_vol_analysis.pdf';

export default function StrategiesPage() {
  const [activeTab, setActiveTab] = useState<TabId>('volatility-puts');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Strategies</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Quantitative strategy analysis and ideas. Backtesting coming soon.</p>
      </div>

      {/* Sub-tabs */}
      <div className="border-b border-gray-200 dark:border-zinc-800 mb-8">
        <nav className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-gray-900 dark:border-gray-100 text-gray-900 dark:text-white'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'volatility-puts' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-gray-100 dark:bg-zinc-800 rounded-lg">
                <FileText className="w-6 h-6 text-gray-700 dark:text-gray-300" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Grayscale BTC Mini-Trust &amp; IWM Put Hedging
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
                  Technical Report &middot; March 4, 2026
                </p>
                <p className="text-gray-600 dark:text-gray-300 mt-3 text-sm leading-relaxed">
                  Intra-week volatility trading with a long-term macro viewpoint. Uses BTC Mini
                  Trust with IWM puts to implement momentum-based DCA. BTC and small-cap equities
                  draw down together (&rho; = +0.77 at 20d with IWM), making equity-index puts a
                  viable proxy hedge at 3&ndash;5&times; lower cost than direct BTC puts.
                </p>
                <a
                  href={WHITEPAPER_URL}
                  download="iwn_vol_analysis.pdf"
                  className="inline-flex items-center gap-2 mt-4 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-zinc-800 text-sm"
                >
                  <Download className="w-4 h-4" />
                  Download Whitepaper
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'weekend-momentum' && <WeekendMomentum />}
    </div>
  );
}
