// Option Price History Service
// Fetches sampled historical option pricing from blob snapshots
// and transforms into per-option time series for Recharts.

export interface OptionPricePoint {
  timestamp: number;
  mark_price: number;
  iv: number | null;
}

export interface OptionSeries {
  key: string;
  label: string;
  chain_symbol: string;
  option_type: string;
  strike: number;
  expiration: string;
  quantity: number;
  position_type: string;
  data: OptionPricePoint[];
}

export interface OptionPriceHistoryData {
  series: OptionSeries[];
}

interface SnapshotOption {
  chain_symbol: string;
  option_type: string;
  strike: number;
  expiration: string;
  mark_price: number;
  iv: number | null;
  quantity: number;
  position_type: string;
}

interface Snapshot {
  timestamp: string;
  timestampMs: number;
  options: SnapshotOption[];
}

const SAMPLES_BY_DAYS: Record<number, number> = {
  7: 36,
  30: 30,
  90: 30,
  365: 24,
  1095: 24,
};

export async function getOptionPriceHistory(
  days: number
): Promise<OptionPriceHistoryData> {
  const samples = SAMPLES_BY_DAYS[days] ?? 24;
  const response = await fetch(
    `/.netlify/functions/option-price-history?days=${days}&samples=${samples}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch option history: ${response.status}`);
  }
  const { snapshots } = (await response.json()) as { snapshots: Snapshot[] };

  const seriesMap = new Map<string, OptionSeries>();

  for (const snap of snapshots) {
    for (const opt of snap.options) {
      const key = `${opt.chain_symbol}-${opt.option_type}-${opt.strike}-${opt.expiration}`;
      if (!seriesMap.has(key)) {
        const expDate = new Date(opt.expiration + 'T00:00:00');
        const expLabel = expDate.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        seriesMap.set(key, {
          key,
          label: `${opt.chain_symbol} $${opt.strike} ${opt.option_type === 'call' ? 'Call' : 'Put'} (${expLabel})`,
          chain_symbol: opt.chain_symbol,
          option_type: opt.option_type,
          strike: opt.strike,
          expiration: opt.expiration,
          quantity: opt.quantity,
          position_type: opt.position_type,
          data: [],
        });
      }
      seriesMap.get(key)!.data.push({
        timestamp: snap.timestampMs,
        mark_price: opt.mark_price,
        iv: opt.iv,
      });
    }
  }

  for (const series of seriesMap.values()) {
    series.data.sort((a, b) => a.timestamp - b.timestamp);
  }

  return { series: Array.from(seriesMap.values()) };
}
