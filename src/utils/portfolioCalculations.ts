import { NormalizedPriceData, PortfolioAsset } from '../services/twelveDataService';

export interface ReturnDataPoint {
  date: string;
  timestamp: number;
  returnPercent: number;
  price: number;
  smaReturnPercent?: number;
}

export interface PortfolioReturnData {
  symbol: string;
  displayName: string;
  color: string;
  returns: ReturnDataPoint[];
}

// Calculate percentage returns from price data (normalized to startIndex value = 0%)
export function calculateReturns(
  priceData: NormalizedPriceData[],
  startIndex: number = 0
): ReturnDataPoint[] {
  if (priceData.length === 0) return [];

  const startPrice = priceData[startIndex].price;

  return priceData.map((point) => ({
    date: point.date,
    timestamp: point.timestamp,
    returnPercent: ((point.price - startPrice) / startPrice) * 100,
    price: point.price,
  }));
}

// Calculate Simple Moving Average over return percentages
export function calculateSMA(returns: ReturnDataPoint[], window: number): ReturnDataPoint[] {
  return returns.map((point, index) => {
    if (index < window - 1) {
      return { ...point, smaReturnPercent: undefined };
    }
    const slice = returns.slice(index - window + 1, index + 1);
    const avg = slice.reduce((sum, p) => sum + p.returnPercent, 0) / window;
    return { ...point, smaReturnPercent: avg };
  });
}

// Apply yearly fee deduction to returns
// Fee compounds daily, reducing effective returns over time
export function applyFees(
  returns: ReturnDataPoint[],
  yearlyFeePercent: number
): ReturnDataPoint[] {
  if (returns.length === 0 || yearlyFeePercent === 0) return returns;

  const dailyFeeRate = yearlyFeePercent / 100 / 365;

  return returns.map((point, index) => {
    // Fee compounds from day 0
    const feeMultiplier = Math.pow(1 - dailyFeeRate, index);
    // Apply fee to the gross return (1 + return%)
    const grossReturn = 1 + point.returnPercent / 100;
    const netReturn = grossReturn * feeMultiplier;
    const netReturnPercent = (netReturn - 1) * 100;

    return {
      ...point,
      returnPercent: netReturnPercent,
    };
  });
}

// Rebase a return series so that the value at rebaseIndex becomes 0%
// Uses multiplicative rebasing: newReturn = (1+R)/(1+Rbase) - 1
function rebaseReturns(returns: ReturnDataPoint[], rebaseIndex: number): ReturnDataPoint[] {
  const baseReturn = returns[rebaseIndex].returnPercent;
  const baseFactor = 1 + baseReturn / 100;

  return returns.map((point) => {
    const rebased = ((1 + point.returnPercent / 100) / baseFactor - 1) * 100;
    const rebasedSMA = point.smaReturnPercent !== undefined
      ? ((1 + point.smaReturnPercent / 100) / baseFactor - 1) * 100
      : undefined;

    return {
      ...point,
      returnPercent: rebased,
      smaReturnPercent: rebasedSMA,
    };
  });
}

// Process portfolio assets into chart-ready data with fees applied and SMA calculated.
// When smaWindow > 0, extra warm-up data is expected in asset.data.
// Returns are calculated from the start of all data, SMA is computed on the full series,
// then the warm-up is trimmed and returns are rebased so the visible range starts at 0%.
export function processPortfolioReturns(
  assets: PortfolioAsset[],
  fees: Record<string, number>,
  smaWindow: number = 0
): PortfolioReturnData[] {
  return assets.map((asset) => {
    const rawReturns = calculateReturns(asset.data);
    const feePercent = fees[asset.symbol] || 0;
    const adjustedReturns = applyFees(rawReturns, feePercent);

    if (smaWindow <= 0) {
      return {
        symbol: asset.symbol,
        displayName: asset.displayName,
        color: asset.color,
        returns: adjustedReturns,
      };
    }

    const withSMA = calculateSMA(adjustedReturns, smaWindow);

    // Trim warm-up points and rebase so visible range starts at 0%
    const warmupSize = Math.min(smaWindow, withSMA.length - 1);
    const rebased = rebaseReturns(withSMA, warmupSize);
    const visible = rebased.slice(warmupSize);

    return {
      symbol: asset.symbol,
      displayName: asset.displayName,
      color: asset.color,
      returns: visible,
    };
  });
}

// Merge multiple return series into a single dataset for Recharts
// Each data point has: date, timestamp, and keys for each asset's return, price, and SMA
// Joins by DATE to handle assets with different trading calendars (e.g., BTC 24/7 vs stocks M-F)
export function mergeReturnsForChart(
  portfolioReturns: PortfolioReturnData[]
): Array<Record<string, string | number>> {
  if (portfolioReturns.length === 0) return [];

  // Build maps of date -> returns/prices/sma for each asset
  const returnsByDate = new Map<string, Record<string, number>>();
  const pricesByDate = new Map<string, Record<string, number>>();
  const smaByDate = new Map<string, Record<string, number>>();
  const timestampByDate = new Map<string, number>();

  portfolioReturns.forEach((asset) => {
    asset.returns.forEach((point) => {
      if (!returnsByDate.has(point.date)) {
        returnsByDate.set(point.date, {});
        pricesByDate.set(point.date, {});
        smaByDate.set(point.date, {});
        timestampByDate.set(point.date, point.timestamp);
      }
      returnsByDate.get(point.date)![asset.symbol] = Number(point.returnPercent.toFixed(2));
      pricesByDate.get(point.date)![`${asset.symbol}_price`] = point.price;
      if (point.smaReturnPercent !== undefined) {
        smaByDate.get(point.date)![`${asset.symbol}_sma`] = Number(point.smaReturnPercent.toFixed(2));
      }
    });
  });

  // Get all dates sorted chronologically
  const allDates = Array.from(returnsByDate.keys()).sort(
    (a, b) => (timestampByDate.get(a) || 0) - (timestampByDate.get(b) || 0)
  );

  // Only include dates where ALL assets have data (common trading days)
  const assetSymbols = portfolioReturns.map((a) => a.symbol);

  return allDates
    .filter((date) => {
      const returns = returnsByDate.get(date)!;
      return assetSymbols.every((symbol) => symbol in returns);
    })
    .map((date) => {
      const dataPoint: Record<string, string | number> = {
        date,
        timestamp: timestampByDate.get(date) || 0,
        ...returnsByDate.get(date)!,
        ...pricesByDate.get(date)!,
        ...smaByDate.get(date)!,
      };
      return dataPoint;
    });
}

// Compute daily log returns from a return series (day-over-day changes)
function dailyReturns(returns: ReturnDataPoint[]): number[] {
  const daily: number[] = [];
  for (let i = 1; i < returns.length; i++) {
    const prev = 1 + returns[i - 1].returnPercent / 100;
    const curr = 1 + returns[i].returnPercent / 100;
    daily.push(prev > 0 ? curr / prev - 1 : 0);
  }
  return daily;
}

// Pearson correlation coefficient between two arrays of equal length
function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// Standard deviation of an array
function stdDev(x: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const variance = x.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return Math.sqrt(variance);
}

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
  correlation: number;
  varianceContribution: number; // % of total equal-weight portfolio variance from this pair
  varianceA: number; // asset A's own variance contribution (w^2 * var_A) as % of total
  varianceB: number; // asset B's own variance contribution (w^2 * var_B) as % of total
}

// Calculate pairwise correlations between all portfolio return series
// Uses daily returns (day-over-day changes) aligned by date
// varianceContribution assumes equal-weight portfolio: 2 * w_i * w_j * cov(i,j) / totalVariance
export function calculateCorrelations(data: PortfolioReturnData[]): CorrelationPair[] {
  if (data.length < 2) return [];

  const n = data.length;
  const w = 1 / n; // equal weight

  // Build date-aligned daily returns for each asset
  const dateMap = new Map<string, Map<string, number>>();

  for (const asset of data) {
    const dr = dailyReturns(asset.returns);
    for (let i = 0; i < dr.length; i++) {
      const date = asset.returns[i + 1].date;
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      dateMap.get(date)!.set(asset.symbol, dr[i]);
    }
  }

  // Get common dates across all assets
  const symbols = data.map((a) => a.symbol);
  const commonDates = Array.from(dateMap.keys()).filter((date) => {
    const m = dateMap.get(date)!;
    return symbols.every((s) => m.has(s));
  });

  // Extract aligned daily return vectors per asset
  const alignedReturns = new Map<string, number[]>();
  for (const s of symbols) {
    alignedReturns.set(s, commonDates.map((d) => dateMap.get(d)!.get(s)!));
  }

  // Compute std devs
  const stds = new Map<string, number>();
  for (const s of symbols) {
    stds.set(s, stdDev(alignedReturns.get(s)!));
  }

  // Compute total equal-weight portfolio variance:
  // sum of w_i * w_j * cov(i,j) for all i,j (including diagonal)
  // cov(i,j) = corr(i,j) * std_i * std_j, and corr(i,i) = 1
  let totalVariance = 0;

  // Diagonal terms: w^2 * var_i
  const assetVariance = new Map<string, number>();
  for (const s of symbols) {
    const sd = stds.get(s)!;
    const v = w * w * sd * sd;
    assetVariance.set(s, v);
    totalVariance += v;
  }

  // Build pairs and accumulate off-diagonal variance
  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const a = data[i];
      const b = data[j];
      const xVals = alignedReturns.get(a.symbol)!;
      const yVals = alignedReturns.get(b.symbol)!;
      const corr = pearsonCorrelation(xVals, yVals);
      const cov = corr * stds.get(a.symbol)! * stds.get(b.symbol)!;
      const pairVariance = 2 * w * w * cov;
      totalVariance += pairVariance;

      pairs.push({
        symbolA: a.symbol,
        symbolB: b.symbol,
        nameA: a.displayName,
        nameB: b.displayName,
        colorA: a.color,
        colorB: b.color,
        correlation: corr,
        varianceContribution: pairVariance,
        varianceA: assetVariance.get(a.symbol)!,
        varianceB: assetVariance.get(b.symbol)!,
      });
    }
  }

  // Convert to percentage of total portfolio variance
  if (totalVariance > 0) {
    for (const pair of pairs) {
      pair.varianceContribution = (pair.varianceContribution / totalVariance) * 100;
      pair.varianceA = (pair.varianceA / totalVariance) * 100;
      pair.varianceB = (pair.varianceB / totalVariance) * 100;
    }
  }

  // Sort by absolute correlation descending (most correlated first)
  pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  return pairs;
}

// Format percentage for display
export function formatReturnPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
