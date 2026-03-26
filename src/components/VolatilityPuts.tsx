import { FileText } from 'lucide-react';
import ConfoundingChart from './ConfoundingChart';
import { FACTOR_YEARLY_DATA } from '../data/confoundingData';

const PDF_URL =
  'https://raw.githubusercontent.com/IamJasonBian/allocation-gym/IamJasonBian/audit-redis-proto/docs/7/iwn_vol_analysis.pdf';

export default function VolatilityPuts() {
  return (
    <div className="space-y-8">
      {/* Confounding Analysis Chart */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
          BTC-IWN Confounding Factor Analysis
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Partial correlations between BTC and IWN returns after controlling for each macro factor.
          Lower bars indicate the factor explains more of the co-movement.
        </p>
        <ConfoundingChart />
      </div>

      {/* Oil-Geo Risk Factor */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Oil-Geo Risk Factor</h2>
          <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-full">
            estimated
          </span>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Crude oil prices proxy geopolitical risk premium, influencing both crypto risk appetite and
          small-cap equity volatility. Oil supply shocks (OPEC decisions, sanctions, conflict) compress
          risk budgets across asset classes, creating spurious BTC-IWN co-movement.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {[
            { horizon: '3M', raw: 0.494, partial: 0.475 },
            { horizon: '6M', raw: 0.453, partial: 0.438 },
            { horizon: '12M', raw: 0.455, partial: 0.442 },
          ].map((d) => (
            <div key={d.horizon} className="bg-gray-50 dark:bg-zinc-900 rounded-lg p-3 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{d.horizon} Horizon</p>
              <p className="text-xl font-mono font-semibold text-gray-900 dark:text-white">
                {d.partial.toFixed(3)}
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                raw {d.raw.toFixed(3)} &rarr; {((1 - d.partial / d.raw) * 100).toFixed(1)}% reduction
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Factor Write-up 2022-2025 */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-zinc-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Macro Factor Ranges: 2022 &ndash; 2025
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-gray-400">Year</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">VIX</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">DXY</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">10Y Yield</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">2Y Yield</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">2s10s</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">WTI Crude</th>
                <th className="text-right px-4 py-2 font-medium text-gray-500 dark:text-gray-400">BTC-IWN Corr</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_YEARLY_DATA.map((row) => (
                <tr
                  key={row.year}
                  className="border-b border-gray-100 dark:border-zinc-800 last:border-b-0 hover:bg-gray-50 dark:hover:bg-zinc-900/50"
                >
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{row.year}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{row.vix}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{row.dxy}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{row.ust10y}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{row.ust2y}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{row.spread2s10s}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-700 dark:text-gray-300">{row.wtiCrude}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900 dark:text-white">{row.btcIwnCorr}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* White Paper Link */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-4">
        <a
          href={PDF_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 text-blue-600 dark:text-blue-400 hover:underline"
        >
          <FileText className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-medium">IWN Volatility Analysis &mdash; Full White Paper (PDF)</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Detailed methodology: variance metrics, hedge selection, confounding analysis, and backtest results.
            </p>
          </div>
        </a>
      </div>
    </div>
  );
}
