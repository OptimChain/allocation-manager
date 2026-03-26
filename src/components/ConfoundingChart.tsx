import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useTheme } from '../contexts/ThemeContext';
import { CHART_DATA } from '../data/confoundingData';

const COLORS = {
  threeMonth: '#6366f1',
  sixMonth: '#22c55e',
  twelveMonth: '#f59e0b',
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; dataKey: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  const horizonLabel: Record<string, string> = { threeMonth: '3M', sixMonth: '6M', twelveMonth: '12M' };
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-medium text-gray-900 dark:text-white mb-1">Controlling for: {label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600 dark:text-gray-400">{horizonLabel[p.dataKey]}:</span>
          <span className="font-mono text-gray-900 dark:text-white">{p.value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ConfoundingChart() {
  const { isDark } = useTheme();
  const axisColor = isDark ? '#a1a1aa' : '#6b7280';
  const gridColor = isDark ? '#27272a' : '#e5e7eb';

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={CHART_DATA} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="factor"
          tick={{ fill: axisColor, fontSize: 12 }}
          angle={-25}
          textAnchor="end"
          interval={0}
        />
        <YAxis
          domain={[0, 0.6]}
          tick={{ fill: axisColor, fontSize: 12 }}
          tickFormatter={(v: number) => v.toFixed(2)}
          label={{ value: 'Partial Correlation', angle: -90, position: 'insideLeft', fill: axisColor, fontSize: 12, dy: 50 }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          verticalAlign="top"
          formatter={(value: string) => {
            const labels: Record<string, string> = { threeMonth: '3 Month', sixMonth: '6 Month', twelveMonth: '12 Month' };
            return <span className="text-sm text-gray-700 dark:text-gray-300">{labels[value] || value}</span>;
          }}
        />
        <Bar dataKey="threeMonth" fill={COLORS.threeMonth} radius={[2, 2, 0, 0]} />
        <Bar dataKey="sixMonth" fill={COLORS.sixMonth} radius={[2, 2, 0, 0]} />
        <Bar dataKey="twelveMonth" fill={COLORS.twelveMonth} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
