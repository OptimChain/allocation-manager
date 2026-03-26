import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';
import { Activity, Fuel } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

// --- Confounding data from allocation-gym partial correlation analysis ---
// Includes Oil/Geo proxy: Brent crude ΔP as a geopolitical risk channel

interface FactorRow {
  factor: string;
  '3M': number;
  '6M': number;
  '12M': number;
}

const CONFOUNDING_DATA: FactorRow[] = [
  { factor: 'None (raw)', '3M': 0.494, '6M': 0.453, '12M': 0.455 },
  { factor: 'VIX', '3M': 0.254, '6M': 0.207, '12M': 0.204 },
  { factor: 'DXY', '3M': 0.484, '6M': 0.446, '12M': 0.458 },
  { factor: '10Y Yield', '3M': 0.513, '6M': 0.457, '12M': 0.452 },
  { factor: '2Y Yield', '3M': 0.493, '6M': 0.458, '12M': 0.435 },
  { factor: '2s10s Spread', '3M': 0.503, '6M': 0.454, '12M': 0.451 },
  { factor: 'Oil / Geo Risk', '3M': 0.431, '6M': 0.389, '12M': 0.372 },
  { factor: 'All factors', '3M': 0.241, '6M': 0.178, '12M': 0.174 },
];

const HORIZON_COLORS = {
  '3M': '#6366f1',
  '6M': '#f59e0b',
  '12M': '#10b981',
};

// --- Oil / Geo risk factor history 2022–2025 (numbers only) ---

interface YearRow {
  year: string;
  wtiBrent: string;
  brentVol: string;
  vix: string;
  btcIwnRaw: string;
  btcIwnPartialOil: string;
  geoEvents: string;
}

const YEARLY_DATA: YearRow[] = [
  {
    year: '2022',
    wtiBrent: '$94.53 / $99.04',
    brentVol: '42.7%',
    vix: '25.6 avg',
    btcIwnRaw: '+0.61',
    btcIwnPartialOil: '+0.52',
    geoEvents: 'Russia-Ukraine invasion, EU energy crisis, OPEC+ cuts',
  },
  {
    year: '2023',
    wtiBrent: '$77.61 / $82.49',
    brentVol: '31.2%',
    vix: '16.8 avg',
    btcIwnRaw: '+0.38',
    btcIwnPartialOil: '+0.34',
    geoEvents: 'Banking crisis (SVB/CS), Israel-Hamas war, Red Sea disruptions',
  },
  {
    year: '2024',
    wtiBrent: '$75.89 / $80.72',
    brentVol: '27.4%',
    vix: '15.5 avg',
    btcIwnRaw: '+0.42',
    btcIwnPartialOil: '+0.39',
    geoEvents: 'Iran-Israel escalation, Houthi shipping attacks, OPEC+ rollover',
  },
  {
    year: '2025',
    wtiBrent: '$71.20 / $74.80',
    brentVol: '24.1%',
    vix: '19.2 avg (YTD)',
    btcIwnRaw: '+0.45',
    btcIwnPartialOil: '+0.37',
    geoEvents: 'Tariff escalation, Middle East ceasefire talks, OPEC+ unwind',
  },
];

type HorizonKey = '3M' | '6M' | '12M';

export default function ConfoundingAnalysis() {
  const { isDark } = useTheme();
  const [selectedHorizon, setSelectedHorizon] = useState<HorizonKey>('12M');

  const axisColor = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  // Chart data for the selected horizon
  const chartData = CONFOUNDING_DATA.map((row) => ({
    factor: row.factor,
    correlation: row[selectedHorizon],
  }));

  // Multi-horizon grouped bar data
  const groupedData = CONFOUNDING_DATA.map((row) => ({
    factor: row.factor,
    '3M': row['3M'],
    '6M': row['6M'],
    '12M': row['12M'],
  }));

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg">
            <Activity className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Confounding Factor Analysis: BTC &harr; IWN
            </h2>
            <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm leading-relaxed">
              Partial correlations between BTC and IWN after controlling for macro risk factors.
              VIX is the dominant confounder, reducing correlation by ~0.25. Oil/geo risk
              (Brent crude &Delta;P) captures geopolitical supply shocks that affect both crypto
              sentiment and small-cap energy exposure. Even after all controls, a +0.17&ndash;0.24
              residual persists&mdash;suggesting structural risk-on/risk-off flows.
            </p>
          </div>
        </div>
      </div>

      {/* Grouped bar chart: all horizons */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
          Partial Correlations by Horizon
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          BTC &harr; IWN correlation after controlling for each factor individually
        </p>

        <ResponsiveContainer width="100%" height={360}>
          <BarChart data={groupedData} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="factor"
              tick={{ fontSize: 11, fill: axisColor }}
              axisLine={{ stroke: gridColor }}
              tickLine={{ stroke: gridColor }}
              interval={0}
              angle={-25}
              textAnchor="end"
              height={60}
            />
            <YAxis
              domain={[0, 0.6]}
              tickFormatter={(v: number) => v.toFixed(2)}
              tick={{ fontSize: 11, fill: axisColor }}
              axisLine={{ stroke: gridColor }}
              tickLine={{ stroke: gridColor }}
              width={50}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white dark:bg-zinc-900 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-800 text-xs">
                      <p className="font-medium text-gray-900 dark:text-white mb-1">{label}</p>
                      {payload.map((p) => (
                        <p key={p.dataKey as string} style={{ color: p.color }}>
                          {p.dataKey}: {typeof p.value === 'number' ? `+${p.value.toFixed(3)}` : p.value}
                        </p>
                      ))}
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              formatter={(value: string) => <span className="text-gray-600 dark:text-gray-400">{value}</span>}
            />
            <Bar dataKey="3M" fill={HORIZON_COLORS['3M']} radius={[2, 2, 0, 0]} />
            <Bar dataKey="6M" fill={HORIZON_COLORS['6M']} radius={[2, 2, 0, 0]} />
            <Bar dataKey="12M" fill={HORIZON_COLORS['12M']} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        {/* Key takeaway */}
        <div className="mt-4 p-3 bg-gray-50 dark:bg-zinc-900 rounded-lg border border-gray-100 dark:border-zinc-800">
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            <span className="font-semibold">Key finding:</span> VIX alone explains ~50% of BTC-IWN
            co-movement. Oil/geo risk accounts for an additional 5&ndash;8pp reduction. DXY and
            yield curves have negligible confounding effect (&lt;2pp). The &ldquo;All factors&rdquo;
            residual of +0.17&ndash;0.24 reflects genuine structural linkage.
          </p>
        </div>
      </div>

      {/* Single-horizon detail chart */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Factor Decomposition
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Select horizon to compare individual factor impact
            </p>
          </div>
          <div className="flex gap-1 bg-gray-100 dark:bg-zinc-900 p-1 rounded-lg">
            {(['3M', '6M', '12M'] as HorizonKey[]).map((h) => (
              <button
                key={h}
                onClick={() => setSelectedHorizon(h)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  selectedHorizon === h
                    ? 'bg-white dark:bg-zinc-800 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 5 }} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
            <XAxis
              type="number"
              domain={[0, 0.6]}
              tickFormatter={(v: number) => v.toFixed(2)}
              tick={{ fontSize: 11, fill: axisColor }}
              axisLine={{ stroke: gridColor }}
              tickLine={{ stroke: gridColor }}
            />
            <YAxis
              type="category"
              dataKey="factor"
              tick={{ fontSize: 11, fill: axisColor }}
              axisLine={{ stroke: gridColor }}
              tickLine={{ stroke: gridColor }}
              width={100}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload;
                  return (
                    <div className="bg-white dark:bg-zinc-900 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-zinc-800 text-xs">
                      <p className="font-medium text-gray-900 dark:text-white">{d.factor}</p>
                      <p className="text-gray-600 dark:text-gray-400">
                        Partial corr: +{d.correlation.toFixed(3)}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="correlation" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => {
                let fill = isDark ? '#525252' : '#a3a3a3';
                if (entry.factor === 'None (raw)') fill = '#3b82f6';
                else if (entry.factor === 'VIX') fill = '#ef4444';
                else if (entry.factor === 'Oil / Geo Risk') fill = '#f97316';
                else if (entry.factor === 'All factors') fill = '#8b5cf6';
                return <Cell key={index} fill={fill} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-blue-500 inline-block" /> Raw
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-red-500 inline-block" /> VIX (dominant)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-orange-500 inline-block" /> Oil / Geo Risk
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-violet-500 inline-block" /> All controls
          </span>
        </div>
      </div>

      {/* Oil / Geo Risk: 2022–2025 data table */}
      <div className="bg-white dark:bg-zinc-950 rounded-lg border border-gray-200 dark:border-zinc-800 p-6">
        <div className="flex items-start gap-3 mb-4">
          <Fuel className="w-5 h-5 text-orange-500 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              Oil &amp; Geopolitical Risk: 2022&ndash;2025
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Annual averages, realized volatility, and BTC-IWN correlations (raw vs oil-controlled)
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-800">
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">Year</th>
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">WTI / Brent Avg</th>
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">Brent 21d Vol</th>
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">VIX Avg</th>
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">BTC-IWN Raw &rho;</th>
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">Partial (Oil)</th>
                <th className="text-left py-2 px-3 text-gray-500 dark:text-gray-400 font-medium text-xs">Key Events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-900">
              {YEARLY_DATA.map((row) => (
                <tr key={row.year}>
                  <td className="py-2.5 px-3 font-semibold text-gray-900 dark:text-white">{row.year}</td>
                  <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{row.wtiBrent}</td>
                  <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{row.brentVol}</td>
                  <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{row.vix}</td>
                  <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{row.btcIwnRaw}</td>
                  <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">{row.btcIwnPartialOil}</td>
                  <td className="py-2.5 px-3 text-gray-500 dark:text-gray-400 text-xs">{row.geoEvents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 p-3 bg-gray-50 dark:bg-zinc-900 rounded-lg border border-gray-100 dark:border-zinc-800">
          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
            <span className="font-semibold">2022:</span> Brent spiked to $139 intraday (Mar); 42.7% realized vol.
            BTC-IWN raw &rho; peaked at +0.61, partial dropped to +0.52 controlling for oil.
            Oil explained ~15% of co-movement during energy crisis.{' '}
            <span className="font-semibold">2023:</span> Oil vol normalized to 31.2%.
            BTC-IWN weakened to +0.38 as crypto decoupled post-SVB. Oil confounding minimal (4pp).{' '}
            <span className="font-semibold">2024:</span> Brent range-bound $72&ndash;$91.
            Iran-Israel tensions added 3pp oil confounding. BTC-IWN recovered to +0.42.{' '}
            <span className="font-semibold">2025 YTD:</span> Brent vol at cycle low 24.1%.
            Tariff-driven macro uncertainty pushed raw &rho; to +0.45; oil control reduces to +0.37
            (8pp, highest since 2022) as supply-chain risk re-emerges.
          </p>
        </div>
      </div>
    </div>
  );
}
