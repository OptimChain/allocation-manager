// Market Indicator Service
// Fetches and calculates IV z-score, ETF flows, 200-week MA, historical vol

const TWELVE_DATA_API = 'https://api.twelvedata.com';
const BTC_ETFS = ['BTC'];

// ── Types ────────────────────────────────────────────────────────────────

interface OHLCVData {
  date: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface DVOLDataPoint {
  timestamp: number;
  close: number;
}

export interface IVZScoreResult {
  source: string | null;
  current: number | null;
  mean: number | null;
  std: number | null;
  zscore: number | null;
  series: { timestamp: number; value: number }[];
}

export interface ETFFlowResult {
  etfCount: number;
  totalDollarVolume: number;
  netFlowEstimate: number;
  recent7d: number;
  recent30d: number;
  dailyFlows: { timestamp: number; flow: number; cumulative: number }[];
}

export interface MAResult {
  currentPrice: number;
  ma200wk: number | null;
  ratio: number | null;
  pctAbove: number | null;
  series: { timestamp: number; price: number; ma: number | null }[];
}

export interface VolWindow {
  label: string;
  vol: number;
  regime: string;
}

export interface HistVolResult {
  windows: VolWindow[];
  rollingSeries: { timestamp: number; vol: number }[];
}

export interface MarketIndicatorData {
  iv: IVZScoreResult;
  flows: ETFFlowResult;
  ma: MAResult;
  vol: HistVolResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = avg(arr);
  const variance = arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

const getApiKey = (): string => {
  const key = import.meta.env.VITE_TWELVE_DATA_API_KEY;
  if (!key) throw new Error('VITE_TWELVE_DATA_API_KEY not set');
  return key;
};

// ── Data Fetchers ────────────────────────────────────────────────────────

async function fetchOHLCV(
  symbol: string,
  outputsize: number,
  interval: string = '1day',
): Promise<OHLCVData[]> {
  const apiKey = getApiKey();
  const url = new URL(`${TWELVE_DATA_API}/time_series`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('interval', interval);
  url.searchParams.set('outputsize', outputsize.toString());
  url.searchParams.set('apikey', apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`Failed to fetch ${symbol}: ${response.status}`);

  const data = await response.json();
  if (data.status === 'error') throw new Error(data.message || `API error for ${symbol}`);
  if (!data.values || !Array.isArray(data.values)) return [];

  return data.values
    .map((item: Record<string, string>) => ({
      date: item.datetime,
      timestamp: new Date(item.datetime).getTime(),
      open: parseFloat(item.open),
      high: parseFloat(item.high),
      low: parseFloat(item.low),
      close: parseFloat(item.close),
      volume: parseFloat(item.volume || '0'),
    }))
    .reverse();
}

async function fetchDeribitDVOL(days: number): Promise<DVOLDataPoint[]> {
  try {
    const response = await fetch(`/.netlify/functions/deribit-dvol?days=${days}`);
    if (!response.ok) return [];
    const json = await response.json();
    if (!json.data) return [];
    return json.data.map((d: { timestamp: number; close: number }) => ({
      timestamp: d.timestamp,
      close: d.close,
    }));
  } catch {
    return [];
  }
}

// ── Calculations ─────────────────────────────────────────────────────────

function calcIVZScore(
  dvol: DVOLDataPoint[],
  dailyData: OHLCVData[],
  lookback: number,
): IVZScoreResult {
  const empty: IVZScoreResult = {
    source: null, current: null, mean: null, std: null, zscore: null, series: [],
  };

  // Primary: Deribit DVOL
  if (dvol.length >= 30) {
    const tail = dvol.slice(-lookback);
    const values = tail.map((d) => d.close);
    const current = values[values.length - 1];
    const meanVal = avg(values);
    const stdVal = stddev(values);
    const zscore = stdVal > 0 ? (current - meanVal) / stdVal : 0;

    return {
      source: 'Deribit DVOL',
      current,
      mean: meanVal,
      std: stdVal,
      zscore,
      series: tail.map((d) => ({ timestamp: d.timestamp, value: d.close })),
    };
  }

  // Fallback: 30-day realised vol z-score
  const closes = dailyData.map((d) => d.close);
  if (closes.length < 40) return empty;

  const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const window = 30;
  const rollingVol: number[] = [];
  const rollingTimestamps: number[] = [];

  for (let i = window - 1; i < logReturns.length; i++) {
    const slice = logReturns.slice(i - window + 1, i + 1);
    rollingVol.push(stddev(slice) * Math.sqrt(365));
    rollingTimestamps.push(dailyData[i + 1].timestamp);
  }

  if (rollingVol.length < 30) return empty;

  const tail = rollingVol.slice(-lookback);
  const tailTs = rollingTimestamps.slice(-lookback);
  const current = tail[tail.length - 1];
  const meanVal = avg(tail);
  const stdVal = stddev(tail);

  return {
    source: '30d Realised Vol',
    current: current * 100,
    mean: meanVal * 100,
    std: stdVal * 100,
    zscore: stdVal > 0 ? (current - meanVal) / stdVal : 0,
    series: tail.map((v, i) => ({ timestamp: tailTs[i], value: v * 100 })),
  };
}

function calcEtfFlows(
  etfDataMap: Map<string, OHLCVData[]>,
  btcDaily: OHLCVData[],
): ETFFlowResult {
  const empty: ETFFlowResult = {
    etfCount: 0, totalDollarVolume: 0, netFlowEstimate: 0,
    recent7d: 0, recent30d: 0, dailyFlows: [],
  };

  if (etfDataMap.size === 0) return empty;

  // BTC daily returns keyed by date
  const btcReturns = new Map<string, number>();
  for (let i = 1; i < btcDaily.length; i++) {
    btcReturns.set(
      btcDaily[i].date,
      (btcDaily[i].close - btcDaily[i - 1].close) / btcDaily[i - 1].close,
    );
  }

  const flowMap = new Map<string, { timestamp: number; flow: number }>();
  let totalDV = 0;

  for (const [, etfData] of etfDataMap) {
    if (etfData.length < 5) continue;

    for (let i = 1; i < etfData.length; i++) {
      const date = etfData[i].date;
      const etfRet = (etfData[i].close - etfData[i - 1].close) / etfData[i - 1].close;
      const btcRet = btcReturns.get(date);
      if (btcRet === undefined) continue;

      const dollarVol = etfData[i].close * etfData[i].volume;
      totalDV += dollarVol;
      const premium = etfRet - btcRet;
      const flowSign = premium > 0 ? 1 : premium < 0 ? -1 : 0;

      const existing = flowMap.get(date);
      if (existing) {
        existing.flow += dollarVol * flowSign;
      } else {
        flowMap.set(date, { timestamp: etfData[i].timestamp, flow: dollarVol * flowSign });
      }
    }
  }

  const sorted = [...flowMap.values()].sort((a, b) => a.timestamp - b.timestamp);
  let cumulative = 0;
  const dailyFlows = sorted.map((d) => {
    cumulative += d.flow;
    return { timestamp: d.timestamp, flow: d.flow, cumulative };
  });

  return {
    etfCount: etfDataMap.size,
    totalDollarVolume: totalDV,
    netFlowEstimate: dailyFlows.reduce((s, d) => s + d.flow, 0),
    recent7d: dailyFlows.slice(-7).reduce((s, d) => s + d.flow, 0),
    recent30d: dailyFlows.slice(-30).reduce((s, d) => s + d.flow, 0),
    dailyFlows,
  };
}

function calc200WeekMA(weeklyData: OHLCVData[]): MAResult {
  if (weeklyData.length === 0) {
    return {
      currentPrice: 0, ma200wk: null, ratio: null, pctAbove: null, series: [],
    };
  }

  const closes = weeklyData.map((d) => d.close);

  const maValues: (number | null)[] = closes.map((_, i) => {
    if (i < 199) return null;
    return avg(closes.slice(i - 199, i + 1));
  });

  const currentPrice = closes[closes.length - 1];
  const currentMA = maValues[maValues.length - 1];

  return {
    currentPrice,
    ma200wk: currentMA,
    ratio: currentMA ? currentPrice / currentMA : null,
    pctAbove: currentMA ? (currentPrice / currentMA - 1) * 100 : null,
    series: weeklyData.map((d, i) => ({
      timestamp: d.timestamp,
      price: d.close,
      ma: maValues[i],
    })),
  };
}

function calcHistoricalVol(dailyData: OHLCVData[]): HistVolResult {
  const n = dailyData.length;

  // Yang-Zhang volatility estimator
  function yangZhangVol(data: OHLCVData[], tradingDays: number = 365): number {
    const len = data.length;
    if (len < 3) return 0;

    const overnightRet: number[] = [];
    const closeRet: number[] = [];
    const rsComponents: number[] = [];

    for (let i = 1; i < len; i++) {
      const { open: o, high: h, low: l, close: c } = data[i];
      const prevC = data[i - 1].close;

      overnightRet.push(Math.log(o / prevC));
      closeRet.push(Math.log(c / prevC));
      rsComponents.push(
        Math.log(h / c) * Math.log(h / o) + Math.log(l / c) * Math.log(l / o),
      );
    }

    const n = len - 1; // number of returns
    const k = 0.34 / (1.34 + (n + 1) / (n - 1));
    const oMean = avg(overnightRet);
    const cMean = avg(closeRet);

    const oVar = overnightRet.reduce((s, r) => s + (r - oMean) ** 2, 0) / (n - 1);
    const cVar = closeRet.reduce((s, r) => s + (r - cMean) ** 2, 0) / (n - 1);
    const rsVar = avg(rsComponents);

    const yzVar = oVar + k * cVar + (1 - k) * rsVar;
    return Math.sqrt(Math.max(0, yzVar) * tradingDays);
  }

  // Multi-window volatility
  const windows: VolWindow[] = [];
  for (const { label, period } of [
    { label: '30d', period: 30 },
    { label: '60d', period: 60 },
    { label: '90d', period: 90 },
    { label: '1Y', period: 365 },
  ]) {
    if (n < period + 2) continue;
    const vol = yangZhangVol(dailyData.slice(-period));
    let regime = 'normal';
    if (vol > 0.8) regime = 'extreme';
    else if (vol > 0.5) regime = 'high';
    else if (vol < 0.2) regime = 'low';
    windows.push({ label, vol, regime });
  }

  // Rolling 30d vol series
  const rollingSeries: { timestamp: number; vol: number }[] = [];
  for (let i = 30; i < n; i++) {
    const vol = yangZhangVol(dailyData.slice(i - 30, i));
    rollingSeries.push({ timestamp: dailyData[i].timestamp, vol: vol * 100 });
  }

  return { windows, rollingSeries };
}

// ── Main API ─────────────────────────────────────────────────────────────

export async function getMarketIndicators(): Promise<MarketIndicatorData> {
  // Fetch all data in parallel with graceful error handling
  const results = await Promise.allSettled([
    fetchOHLCV('BTC/USD', 1900, '1day'),
    fetchOHLCV('BTC/USD', 270, '1week'),
    fetchDeribitDVOL(1825),
    ...BTC_ETFS.map((s) => fetchOHLCV(s, 1900, '1day')),
  ]);

  const btcDaily = results[0].status === 'fulfilled' ? results[0].value : [];
  const btcWeekly = results[1].status === 'fulfilled' ? results[1].value : [];
  const dvol = results[2].status === 'fulfilled' ? results[2].value as DVOLDataPoint[] : [];

  const etfDataMap = new Map<string, OHLCVData[]>();
  BTC_ETFS.forEach((symbol, i) => {
    const r = results[3 + i];
    if (r.status === 'fulfilled' && r.value.length > 0) {
      etfDataMap.set(symbol, r.value as OHLCVData[]);
    }
  });

  if (btcDaily.length === 0 && btcWeekly.length === 0) {
    throw new Error('Failed to fetch BTC price data');
  }

  return {
    iv: calcIVZScore(dvol, btcDaily, 1825),
    flows: calcEtfFlows(etfDataMap, btcDaily),
    ma: calc200WeekMA(btcWeekly),
    vol: calcHistoricalVol(btcDaily),
  };
}
