// Daily / hourly OHLC bar fetchers shared by the weekend analytics services.
// Backed by the shared TwelveData cache (memory + localStorage + in-flight
// dedup), so panels asking for the same symbol share one download.

import { tdFetch } from './tdProxy';
import { cachedJson } from './twelveDataCache';
import type { TimeSeriesResponse } from './twelveDataService';

const TTL_DAILY = 30 * 60_000;
const TTL_HOURLY = 3 * 60_000;

export interface DailyBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface HourlyBar extends DailyBar {
  change: number;
}

/** 0=Sun … 6=Sat for a TwelveData `YYYY-MM-DD` date. */
export function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}

async function fetchBars(symbol: string, interval: '1h' | '1day', outputsize: number): Promise<DailyBar[]> {
  const data = await tdFetch<TimeSeriesResponse>('time_series', { symbol, interval, outputsize });
  return (data.values ?? [])
    .map((v) => ({
      datetime: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse(); // oldest first
}

export function fetchDailyBars(symbol: string, outputsize: number): Promise<DailyBar[]> {
  return cachedJson(`bars:1day:${symbol}:${outputsize}`, TTL_DAILY, () => fetchBars(symbol, '1day', outputsize));
}

export function fetchHourlyBars(symbol: string, outputsize: number): Promise<HourlyBar[]> {
  return cachedJson(`bars:1h:${symbol}:${outputsize}`, TTL_HOURLY, async () => {
    const bars = await fetchBars(symbol, '1h', outputsize);
    return bars.map((bar, i) => ({
      ...bar,
      change: i === 0 ? 0 : ((bar.close - bars[i - 1].close) / bars[i - 1].close) * 100,
    }));
  });
}
