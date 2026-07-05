// Weekend Gap Service
// Fetches daily + hourly history for an equity/ETF ticker and computes
// Friday-close -> next-open weekend gap metrics. These tickers trade weekdays
// only, so Saturday/Sunday drifts stay null and the analysis focuses on the
// weekend overnight gap (e.g. how a BTC ETF like the Grayscale Bitcoin Mini
// Trust gaps Monday after BTC moves over the weekend).

import { WeekendData, WeekendMetrics, HourlyBar } from './weekendMomentumService';
import { tdProxyUrl } from './tdProxy';

export interface TickerOption {
  symbol: string;
  label: string;
}

export const WEEKEND_GAP_TICKERS: TickerOption[] = [
  { symbol: 'NBSI', label: 'NBSI' },
  { symbol: 'NBIS', label: 'NBIS (Nebius)' },
  { symbol: 'CVS', label: 'CVS Health' },
  { symbol: 'BTC', label: 'Grayscale BTC Mini Trust' },
];

interface DailyBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

function getDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
}

async function fetchHourlyBars(symbol: string, outputsize: number): Promise<HourlyBar[]> {
  const url = tdProxyUrl('time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1h');
  url.searchParams.set('outputsize', outputsize.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch ${symbol} hourly: ${response.status}`);
  }

  const data = await response.json();
  if (data.status === 'error') {
    throw new Error(data.message || `API error for ${symbol} hourly`);
  }

  const bars = data.values
    .map((v: { datetime: string; open: string; high: string; low: string; close: string }) => ({
      datetime: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse(); // oldest first

  return bars.map((bar: DailyBar, i: number) => ({
    ...bar,
    change: i === 0 ? 0 : ((bar.close - bars[i - 1].close) / bars[i - 1].close) * 100,
  }));
}

async function fetchDailyBars(symbol: string, outputsize: number): Promise<DailyBar[]> {
  const url = tdProxyUrl('time_series');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1day');
  url.searchParams.set('outputsize', outputsize.toString());

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch ${symbol}: ${response.status}`);
  }

  const data = await response.json();
  if (data.status === 'error') {
    throw new Error(data.message || `API error for ${symbol}`);
  }

  return data.values
    .map((v: { datetime: string; open: string; high: string; low: string; close: string }) => ({
      datetime: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
    }))
    .reverse(); // oldest first
}

// For an equity/ETF, the "weekend" is the gap from each Friday close to the next
// trading session's open (normally Monday, but the next bar handles holidays too).
// Saturday/Sunday have no bars, so those drifts are null.
function buildGapData(bars: DailyBar[]): WeekendData[] {
  const weekends: WeekendData[] = [];

  for (let i = 0; i < bars.length; i++) {
    const friday = bars[i];
    if (getDayOfWeek(friday.datetime) !== 5) continue; // Only process Fridays

    // Next trading session after Friday (Monday, or first day after a holiday).
    const nextOpen = bars[i + 1];
    if (!nextOpen) continue;

    // Friday afternoon: open->close drift
    const friOpenToCloseDrift = ((friday.close - friday.open) / friday.open) * 100;

    // Monday morning: open->close drift
    const monOpenToCloseDrift = ((nextOpen.close - nextOpen.open) / nextOpen.open) * 100;

    // Weekend gap: next open vs Friday close
    const sunToMonDrift = ((nextOpen.open - friday.close) / friday.close) * 100;

    // Gap risk: worst dip on the next session relative to Friday close
    const weekendDrawdown = ((nextOpen.low - friday.close) / friday.close) * 100;

    const mondayRecoveryPositive = nextOpen.close > friday.close;

    weekends.push({
      fridayDate: friday.datetime,
      fridayOpen: friday.open,
      fridayHigh: friday.high,
      fridayLow: friday.low,
      fridayClose: friday.close,
      friOpenToCloseDrift,
      saturdayClose: null,
      saturdayLow: null,
      sundayClose: null,
      sundayLow: null,
      mondayOpen: nextOpen.open,
      mondayHigh: nextOpen.high,
      mondayLow: nextOpen.low,
      mondayClose: nextOpen.close,
      monOpenToCloseDrift,
      monBelowFri: nextOpen.open < friday.close,
      friToSatDrift: null,
      satToSunDrift: null,
      sunToMonDrift,
      weekendDrawdown,
      mondayRecoveryPositive,
    });
  }

  return weekends;
}

function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function computeMetrics(weekends: WeekendData[]): WeekendMetrics {
  if (weekends.length === 0) {
    return {
      totalWeekends: 0,
      monBelowFriPct: 0,
      avgFriOpenToCloseDrift: 0,
      friClosedAboveOpenPct: 0,
      avgFriToSatDrift: 0,
      avgSatToSunDrift: 0,
      avgSunToMonDrift: 0,
      avgMonOpenToCloseDrift: 0,
      monClosedAboveOpenPct: 0,
      avgWeekendDrawdown: 0,
      worstWeekendDrawdown: 0,
      mondayRecoveryPositivePct: 0,
    };
  }

  const n = weekends.length;
  const monBelowCount = weekends.filter((w) => w.monBelowFri).length;
  const recoveryCount = weekends.filter((w) => w.mondayRecoveryPositive).length;

  const friOcDrifts = weekends.map((w) => w.friOpenToCloseDrift);
  const friClosedAbove = weekends.filter((w) => w.friOpenToCloseDrift > 0).length;

  const sunMonDrifts = weekends.map((w) => w.sunToMonDrift);

  const monOcDrifts = weekends.map((w) => w.monOpenToCloseDrift);
  const monClosedAbove = weekends.filter((w) => w.monOpenToCloseDrift > 0).length;

  const drawdowns = weekends.map((w) => w.weekendDrawdown);

  return {
    totalWeekends: n,
    monBelowFriPct: (monBelowCount / n) * 100,
    avgFriOpenToCloseDrift: avg(friOcDrifts),
    friClosedAboveOpenPct: (friClosedAbove / n) * 100,
    avgFriToSatDrift: 0,
    avgSatToSunDrift: 0,
    avgSunToMonDrift: avg(sunMonDrifts),
    avgMonOpenToCloseDrift: avg(monOcDrifts),
    monClosedAboveOpenPct: (monClosedAbove / n) * 100,
    avgWeekendDrawdown: avg(drawdowns),
    worstWeekendDrawdown: Math.min(...drawdowns),
    mondayRecoveryPositivePct: (recoveryCount / n) * 100,
  };
}

// Filter weekends to those within the last `months` (null = all history).
export function sliceByMonths(weekends: WeekendData[], months: number | null): WeekendData[] {
  if (months === null) return weekends;
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);
  const cutoff = cutoffDate.toISOString().slice(0, 10);
  return weekends.filter((w) => w.fridayDate >= cutoff);
}

export interface WeekendGapResult {
  symbol: string;
  weekends: WeekendData[];
  hourlyHistory: HourlyBar[];
}

export async function fetchWeekendGapData(symbol: string): Promise<WeekendGapResult> {
  const [dailyBars, hourlyBars] = await Promise.all([
    fetchDailyBars(symbol, 5000),
    fetchHourlyBars(symbol, 50),
  ]);

  return {
    symbol,
    weekends: buildGapData(dailyBars),
    hourlyHistory: hourlyBars,
  };
}
