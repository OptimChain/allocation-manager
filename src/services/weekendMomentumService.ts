// Weekend Momentum Strategy Service
// Fetches BTC/USD daily history and computes weekend metrics

import endpoints from 'virtual:endpoints';

const TWELVE_DATA_API = endpoints.apis.twelve_data;

interface DailyBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface WeekendData {
  fridayDate: string;
  fridayOpen: number;
  fridayHigh: number;
  fridayLow: number;
  fridayClose: number;
  friOpenToCloseDrift: number;
  saturdayClose: number | null;
  saturdayLow: number | null;
  sundayClose: number | null;
  sundayLow: number | null;
  mondayOpen: number;
  mondayHigh: number;
  mondayLow: number;
  mondayClose: number;
  monOpenToCloseDrift: number;
  monBelowFri: boolean;
  friToSatDrift: number | null;
  satToSunDrift: number | null;
  sunToMonDrift: number;
  weekendDrawdown: number;
  mondayRecoveryPositive: boolean;
}

export interface WeekendMetrics {
  totalWeekends: number;
  monBelowFriPct: number;
  avgFriOpenToCloseDrift: number;
  friClosedAboveOpenPct: number;
  avgFriToSatDrift: number;
  avgSatToSunDrift: number;
  avgSunToMonDrift: number;
  avgMonOpenToCloseDrift: number;
  monClosedAboveOpenPct: number;
  avgWeekendDrawdown: number;
  worstWeekendDrawdown: number;
  mondayRecoveryPositivePct: number;
}

const getApiKey = (): string => {
  const key = import.meta.env.VITE_TWELVE_DATA_API_KEY;
  if (!key) {
    throw new Error('VITE_TWELVE_DATA_API_KEY environment variable is not set');
  }
  return key;
};

function getDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
}

async function fetchHourlyBars(symbol: string, outputsize: number): Promise<HourlyBar[]> {
  const apiKey = getApiKey();
  const url = new URL(`${TWELVE_DATA_API}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1h');
  url.searchParams.set('outputsize', outputsize.toString());
  url.searchParams.set('apikey', apiKey);

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
  const apiKey = getApiKey();
  const url = new URL(`${TWELVE_DATA_API}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', '1day');
  url.searchParams.set('outputsize', outputsize.toString());
  url.searchParams.set('apikey', apiKey);

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

function buildWeekendData(bars: DailyBar[]): WeekendData[] {
  const byDate = new Map<string, DailyBar>();
  for (const bar of bars) {
    byDate.set(bar.datetime, bar);
  }

  const weekends: WeekendData[] = [];

  for (const bar of bars) {
    const dow = getDayOfWeek(bar.datetime);
    if (dow !== 5) continue; // Only process Fridays

    const friday = bar;
    const fridayDate = new Date(friday.datetime + 'T00:00:00');

    const satDate = new Date(fridayDate);
    satDate.setDate(satDate.getDate() + 1);
    const sunDate = new Date(fridayDate);
    sunDate.setDate(sunDate.getDate() + 2);
    const monDate = new Date(fridayDate);
    monDate.setDate(monDate.getDate() + 3);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const saturday = byDate.get(fmt(satDate));
    const sunday = byDate.get(fmt(sunDate));
    const monday = byDate.get(fmt(monDate));

    if (!monday) continue;

    const satClose = saturday ? saturday.close : null;
    const satLow = saturday ? saturday.low : null;
    const sunClose = sunday ? sunday.close : null;
    const sunLow = sunday ? sunday.low : null;

    // Friday afternoon: open→close drift
    const friOpenToCloseDrift = ((friday.close - friday.open) / friday.open) * 100;

    // Monday morning: open→close drift
    const monOpenToCloseDrift = ((monday.close - monday.open) / monday.open) * 100;

    // Three separate weekend drifts
    const friToSatDrift = satClose !== null
      ? ((satClose - friday.close) / friday.close) * 100
      : null;

    const satToSunDrift = satClose !== null && sunClose !== null
      ? ((sunClose - satClose) / satClose) * 100
      : null;

    // Sun→Mon: use Sunday close if available, otherwise Saturday close, otherwise Friday close
    const preMonday = sunClose ?? satClose ?? friday.close;
    const sunToMonDrift = ((monday.open - preMonday) / preMonday) * 100;

    // Weekend drawdown: worst low during Sat/Sun relative to Friday close
    const lows: number[] = [];
    if (satLow !== null) lows.push(satLow);
    if (sunLow !== null) lows.push(sunLow);
    const weekendMin = lows.length > 0 ? Math.min(...lows) : monday.open;
    const weekendDrawdown = ((weekendMin - friday.close) / friday.close) * 100;

    const mondayRecoveryPositive = monday.close > friday.close;

    weekends.push({
      fridayDate: friday.datetime,
      fridayOpen: friday.open,
      fridayHigh: friday.high,
      fridayLow: friday.low,
      fridayClose: friday.close,
      friOpenToCloseDrift,
      saturdayClose: satClose,
      saturdayLow: satLow,
      sundayClose: sunClose,
      sundayLow: sunLow,
      mondayOpen: monday.open,
      mondayHigh: monday.high,
      mondayLow: monday.low,
      mondayClose: monday.close,
      monOpenToCloseDrift,
      monBelowFri: monday.open < friday.close,
      friToSatDrift,
      satToSunDrift,
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

function computeMetrics(weekends: WeekendData[]): WeekendMetrics {
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

  const friSatDrifts = weekends.filter((w) => w.friToSatDrift !== null).map((w) => w.friToSatDrift!);
  const satSunDrifts = weekends.filter((w) => w.satToSunDrift !== null).map((w) => w.satToSunDrift!);
  const sunMonDrifts = weekends.map((w) => w.sunToMonDrift);

  const monOcDrifts = weekends.map((w) => w.monOpenToCloseDrift);
  const monClosedAbove = weekends.filter((w) => w.monOpenToCloseDrift > 0).length;

  const drawdowns = weekends.map((w) => w.weekendDrawdown);

  return {
    totalWeekends: n,
    monBelowFriPct: (monBelowCount / n) * 100,
    avgFriOpenToCloseDrift: avg(friOcDrifts),
    friClosedAboveOpenPct: (friClosedAbove / n) * 100,
    avgFriToSatDrift: avg(friSatDrifts),
    avgSatToSunDrift: avg(satSunDrifts),
    avgSunToMonDrift: avg(sunMonDrifts),
    avgMonOpenToCloseDrift: avg(monOcDrifts),
    monClosedAboveOpenPct: (monClosedAbove / n) * 100,
    avgWeekendDrawdown: avg(drawdowns),
    worstWeekendDrawdown: Math.min(...drawdowns),
    mondayRecoveryPositivePct: (recoveryCount / n) * 100,
  };
}

export interface HourlyBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
}

export interface WeekendMomentumResult {
  allHistory: {
    metrics: WeekendMetrics;
    weekends: WeekendData[];
  };
  btcMiniTrust: {
    metrics: WeekendMetrics;
    weekends: WeekendData[];
    last3Months: WeekendData[];
    startDate: string;
  };
  hourlyHistory: HourlyBar[];
}

export async function fetchWeekendMomentumData(): Promise<WeekendMomentumResult> {
  // Fetch BTC/USD daily data (max history), BTC Mini Trust, and BTC hourly (last 7 days = 168h)
  const [btcBars, miniTrustBars, hourlyBars] = await Promise.all([
    fetchDailyBars('BTC/USD', 5000),
    fetchDailyBars('BTC', 5000),
    fetchHourlyBars('BTC/USD', 168),
  ]);

  const allWeekends = buildWeekendData(btcBars);
  const allMetrics = computeMetrics(allWeekends);

  // BTC Mini Trust era: filter to weekends on/after its earliest data point
  const miniTrustStartDate = miniTrustBars.length > 0 ? miniTrustBars[0].datetime : '';
  const miniTrustWeekends = miniTrustStartDate
    ? allWeekends.filter((w) => w.fridayDate >= miniTrustStartDate)
    : [];
  const miniTrustMetrics = computeMetrics(miniTrustWeekends);

  // Last 3 months: ~13 weekends
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const cutoff = threeMonthsAgo.toISOString().slice(0, 10);
  const last3Months = miniTrustWeekends.filter((w) => w.fridayDate >= cutoff);

  return {
    allHistory: { metrics: allMetrics, weekends: allWeekends },
    btcMiniTrust: {
      metrics: miniTrustMetrics,
      weekends: miniTrustWeekends,
      last3Months,
      startDate: miniTrustStartDate,
    },
    hourlyHistory: hourlyBars,
  };
}
