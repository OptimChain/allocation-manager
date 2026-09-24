import type { PnLPeriod } from '../services/robinhoodService';

export const PNL_PERIODS: { label: string; value: PnLPeriod }[] = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: '5Y', value: '5Y' },
];

export const PERIOD_LABEL: Record<PnLPeriod, string> = {
  '1W': 'last week', '1M': 'last month', '3M': 'last 3 months',
  '6M': 'last 6 months', '1Y': 'last year', '5Y': 'last 5 years',
};
