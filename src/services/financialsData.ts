// Financial statements & fundamentals data for the News tab.
//
// Curated, statement-grounded fundamentals per stock, organized around the
// dimensions that matter when reading a company's financial statements:
// revenue, risk factors, cost of capital, cost structure, and the supply
// chains the business depends on. Each dimension carries headline stat tiles
// plus sub-categories drawn from the filings.
//
// HOOD figures are sourced from Robinhood's Q4 & FY2025 results release
// (investors.robinhood.com). AAPL/NVDA use their most recent fiscal-year
// headline figures. Cost-of-capital metrics are marked "est." where they are
// analyst estimates rather than reported line items.

export type Trend = 'up' | 'down' | 'flat';

export interface StatTile {
  label: string;
  value: string;
  change?: string;
  trend?: Trend;
  note?: string;
}

export interface SubCategory {
  name: string;
  detail: string;
  tags?: string[];
  trend?: Trend;
}

export interface CategoryData {
  summary: string;
  tiles: StatTile[];
  subcategories: SubCategory[];
}

export type CategoryKey =
  | 'revenue'
  | 'risk'
  | 'costOfCapital'
  | 'costs'
  | 'supplyChain';

export interface StatementDoc {
  id: string;
  title: string;
  period: string;
  date: string; // ISO
  type: 'Earnings' | '10-K' | '10-Q' | 'Shareholder Letter' | 'Press Release';
  url: string;
}

export interface StockFinancials {
  ticker: string;
  name: string;
  sector: string;
  asOf: string;
  currency: string;
  categories: Record<CategoryKey, CategoryData>;
  statements: StatementDoc[];
}

export const CATEGORY_ORDER: CategoryKey[] = [
  'revenue',
  'risk',
  'costOfCapital',
  'costs',
  'supplyChain',
];

export const CATEGORY_META: Record<
  CategoryKey,
  { label: string; blurb: string }
> = {
  revenue: { label: 'Revenue', blurb: 'Top-line growth and its composition' },
  risk: { label: 'Risk', blurb: 'Risk factors surfaced from the filings' },
  costOfCapital: {
    label: 'Cost of Capital',
    blurb: 'Funding mix, leverage and discount rate',
  },
  costs: { label: 'Costs', blurb: 'Operating cost structure' },
  supplyChain: {
    label: 'Supply Chain',
    blurb: 'Dependencies the business relies on',
  },
};

export const STOCKS: StockFinancials[] = [
  {
    ticker: 'HOOD',
    name: 'Robinhood Markets',
    sector: 'Financial Services · Brokerage',
    asOf: 'Q4 & FY2025',
    currency: 'USD',
    statements: [
      {
        id: 'hood-fy2025',
        title: 'Q4 & Full Year 2025 Results',
        period: 'Q4 & FY2025',
        date: '2026-02-10',
        type: 'Earnings',
        url: 'https://investors.robinhood.com/static-files/981b25a2-29b9-48f5-8839-9273b2e353d9',
      },
      {
        id: 'hood-10q-q3-2025',
        title: 'Form 10-Q (Q3 2025)',
        period: 'Q3 2025',
        date: '2025-11-06',
        type: '10-Q',
        url: 'https://investors.robinhood.com/static-files/b662fc95-91a1-490f-ba2a-0a5439afc2f0',
      },
      {
        id: 'hood-fy2024',
        title: 'Q4 & Full Year 2024 Results',
        period: 'Q4 & FY2024',
        date: '2025-02-12',
        type: 'Earnings',
        url: 'https://investors.robinhood.com/static-files/7aaec8f2-484e-4160-b0e9-c3016aa4b482',
      },
    ],
    categories: {
      revenue: {
        summary:
          'Record $4.5B FY2025 net revenue (+52% YoY); a record $1.28B in Q4. Growth led by options and net interest, with crypto giving back gains.',
        tiles: [
          {
            label: 'FY2025 net revenue',
            value: '$4.5B',
            change: '+52% YoY',
            trend: 'up',
          },
          {
            label: 'Q4 net revenue',
            value: '$1.28B',
            change: '+27% YoY',
            trend: 'up',
          },
          {
            label: 'Q4 transaction rev',
            value: '$776M',
            change: '+15% YoY',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Options',
            detail: 'Q4 options revenue $314M, up 41% YoY',
            tags: ['transaction', 'largest driver'],
            trend: 'up',
          },
          {
            name: 'Cryptocurrencies',
            detail: 'Q4 crypto revenue $221M, down 38% YoY',
            tags: ['transaction', 'volatile'],
            trend: 'down',
          },
          {
            name: 'Other transaction',
            detail: 'Q4 $147M, up over 300% YoY',
            tags: ['transaction', 'fastest growth'],
            trend: 'up',
          },
          {
            name: 'Equities',
            detail: 'Q4 equities revenue $94M, up 54% YoY',
            tags: ['transaction'],
            trend: 'up',
          },
          {
            name: 'Net interest revenue',
            detail: 'Interest on margin, cash sweep and securities lending',
            tags: ['rate-sensitive'],
          },
          {
            name: 'Other (Gold & services)',
            detail: 'Gold subscriptions and other platform revenue',
            tags: ['recurring'],
            trend: 'up',
          },
        ],
      },
      risk: {
        summary:
          'Earnings skew to volatile transaction revenue (crypto swung -38% in Q4) atop heavy regulatory exposure and rate-sensitive net interest income.',
        tiles: [
          { label: 'Revenue concentration', value: 'High', trend: 'down' },
          { label: 'Regulatory exposure', value: 'Elevated', trend: 'down' },
          { label: 'Rate sensitivity', value: 'Material', trend: 'flat' },
        ],
        subcategories: [
          {
            name: 'Transaction-revenue volatility',
            detail:
              'Crypto & options tied to market cycles; crypto fell 38% YoY in Q4',
            tags: ['concentration'],
          },
          {
            name: 'Regulatory & legal',
            detail:
              'SEC/FINRA oversight, PFOF scrutiny, prior regulatory accruals',
            tags: ['regulatory'],
          },
          {
            name: 'Crypto regulatory uncertainty',
            detail: 'Evolving digital-asset rules across US and EU',
            tags: ['regulatory', 'crypto'],
          },
          {
            name: 'Interest-rate risk',
            detail: 'Net interest revenue moves with the Fed rate path',
            tags: ['macro'],
          },
          {
            name: 'Cybersecurity & operational',
            detail: 'Custody, outages and security incidents on a retail app',
            tags: ['operational'],
          },
        ],
      },
      costOfCapital: {
        summary:
          'Predominantly equity-funded with minimal long-term debt; a high-beta name, so the implied cost of equity — and discount rate — runs well above market.',
        tiles: [
          { label: 'Levered beta', value: '~2.3', note: 'est.', trend: 'flat' },
          { label: 'Long-term debt', value: 'Minimal', trend: 'up' },
          {
            label: 'Cost of equity',
            value: '~13–15%',
            note: 'est.',
            trend: 'down',
          },
        ],
        subcategories: [
          {
            name: 'Capital structure',
            detail: 'Largely equity-financed; small convertible/debt footprint',
            tags: ['equity-heavy'],
          },
          {
            name: 'Cost of equity',
            detail: 'Elevated by high beta and earnings volatility (est.)',
            tags: ['estimate'],
          },
          {
            name: 'Buybacks',
            detail: 'Share repurchase authorization returns capital',
            tags: ['capital return'],
          },
          {
            name: 'Cash & investments',
            detail: 'Large corporate cash balance funds operations internally',
            tags: ['liquidity'],
          },
        ],
      },
      costs: {
        summary:
          'Operating costs led by technology & development, stock-based compensation and marketing; prior-year results carried one-off regulatory accruals.',
        tiles: [
          { label: 'Cost trend', value: 'Rising', trend: 'down' },
          { label: 'SBC', value: 'Significant', trend: 'flat' },
          { label: 'Op. leverage', value: 'Improving', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Technology & development',
            detail: 'Engineering headcount and platform build-out',
            tags: ['largest opex'],
          },
          {
            name: 'Stock-based compensation',
            detail: 'Material non-cash expense diluting GAAP margins',
            tags: ['non-cash'],
          },
          {
            name: 'Brokerage & transaction',
            detail: 'Clearing, exchange and market-data costs',
            tags: ['variable'],
          },
          {
            name: 'Marketing',
            detail: 'Customer acquisition and incentive programs',
            tags: ['growth'],
          },
          {
            name: 'Regulatory accruals',
            detail: 'Prior periods included one-off settlement accruals',
            tags: ['one-off'],
          },
        ],
      },
      supplyChain: {
        summary:
          'A fintech "supply chain": order-flow market makers, self-clearing, bank sweep partners, crypto liquidity venues and cloud infrastructure.',
        tiles: [
          { label: 'Order routing', value: 'PFOF', trend: 'flat' },
          { label: 'Clearing', value: 'Self-cleared', trend: 'up' },
          { label: 'Infra', value: 'Cloud', trend: 'flat' },
        ],
        subcategories: [
          {
            name: 'Market makers (PFOF)',
            detail: 'Wholesalers (e.g. Citadel Securities) pay for order flow',
            tags: ['revenue input', 'concentration'],
          },
          {
            name: 'Clearing & custody',
            detail: 'Robinhood Securities self-clears equities & options',
            tags: ['in-house'],
          },
          {
            name: 'Bank sweep network',
            detail: 'Partner banks hold FDIC-insured swept cash',
            tags: ['net interest'],
          },
          {
            name: 'Crypto liquidity',
            detail: 'External venues and market makers for digital assets',
            tags: ['crypto'],
          },
          {
            name: 'Cloud & data',
            detail: 'Cloud infrastructure and market-data vendors',
            tags: ['infra'],
          },
        ],
      },
    },
  },
  {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    sector: 'Technology · Consumer Electronics',
    asOf: 'FY2024',
    currency: 'USD',
    statements: [
      {
        id: 'aapl-10k-2024',
        title: 'Form 10-K (FY2024)',
        period: 'FY2024',
        date: '2024-11-01',
        type: '10-K',
        url: 'https://investor.apple.com/sec-filings/default.aspx',
      },
    ],
    categories: {
      revenue: {
        summary:
          'FY2024 revenue $391B (+2% YoY). Modest hardware growth offset by a record Services segment approaching $100B.',
        tiles: [
          {
            label: 'FY2024 revenue',
            value: '$391B',
            change: '+2% YoY',
            trend: 'up',
          },
          { label: 'Services', value: '~$96B', change: 'record', trend: 'up' },
          { label: 'Net income', value: '$93.7B', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'iPhone',
            detail: 'Largest product line, ~half of revenue',
            tags: ['products', 'concentration'],
          },
          {
            name: 'Services',
            detail: 'App Store, iCloud, ads, payments — high margin & recurring',
            tags: ['recurring', 'high margin'],
            trend: 'up',
          },
          {
            name: 'Mac & iPad',
            detail: 'Compute hardware refreshed on Apple silicon',
            tags: ['products'],
          },
          {
            name: 'Wearables & Home',
            detail: 'Watch, AirPods and accessories',
            tags: ['products'],
          },
        ],
      },
      risk: {
        summary:
          'Heavy dependence on iPhone and on Greater China for both sales and manufacturing; regulatory pressure on the App Store.',
        tiles: [
          { label: 'Product concentration', value: 'High', trend: 'down' },
          { label: 'China exposure', value: 'Elevated', trend: 'down' },
          { label: 'Regulatory', value: 'Rising', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'iPhone dependence',
            detail: 'Single product drives roughly half of revenue',
            tags: ['concentration'],
          },
          {
            name: 'Greater China',
            detail: 'Key market and manufacturing base; geopolitical risk',
            tags: ['geopolitical'],
          },
          {
            name: 'App Store regulation',
            detail: 'EU DMA and antitrust actions pressure Services fees',
            tags: ['regulatory'],
          },
          {
            name: 'FX',
            detail: 'Strong dollar weighs on international revenue',
            tags: ['macro'],
          },
        ],
      },
      costOfCapital: {
        summary:
          'Blue-chip balance sheet: low beta, cheap investment-grade debt and enormous buybacks give a low weighted cost of capital.',
        tiles: [
          { label: 'Beta', value: '~1.2', note: 'est.', trend: 'up' },
          { label: 'Credit', value: 'AA+', trend: 'up' },
          { label: 'Buybacks', value: 'Very large', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Low-cost debt',
            detail: 'Investment-grade bonds fund returns cheaply',
            tags: ['debt'],
          },
          {
            name: 'Capital return',
            detail: 'Tens of billions in annual buybacks + dividends',
            tags: ['capital return'],
          },
          {
            name: 'Cash generation',
            detail: 'Massive free cash flow lowers external funding needs',
            tags: ['liquidity'],
          },
        ],
      },
      costs: {
        summary:
          'Product COGS dominates; disciplined R&D (~$31B) and SG&A keep operating margin near 30%.',
        tiles: [
          { label: 'Gross margin', value: '~46%', trend: 'up' },
          { label: 'R&D', value: '~$31B', trend: 'flat' },
          { label: 'Op. margin', value: '~31%', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Product COGS',
            detail: 'Components and assembly for hardware',
            tags: ['largest cost'],
          },
          {
            name: 'R&D',
            detail: 'Silicon, devices and future products',
            tags: ['investment'],
          },
          {
            name: 'SG&A',
            detail: 'Retail, marketing and administration',
            tags: ['fixed'],
          },
        ],
      },
      supplyChain: {
        summary:
          'Concentrated hardware supply chain: TSMC for chips, Foxconn/Pegatron for assembly, plus displays and memory from Asian suppliers.',
        tiles: [
          { label: 'Fab', value: 'TSMC', trend: 'flat' },
          { label: 'Assembly', value: 'Foxconn', trend: 'flat' },
          { label: 'Geography', value: 'Asia-heavy', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'TSMC',
            detail: 'Sole leading-edge foundry for Apple silicon',
            tags: ['single source'],
          },
          {
            name: 'Foxconn / Pegatron',
            detail: 'Final assembly, concentrated in China & India',
            tags: ['assembly'],
          },
          {
            name: 'Displays & memory',
            detail: 'Samsung, LG, SK Hynix supply panels and NAND',
            tags: ['components'],
          },
          {
            name: 'India diversification',
            detail: 'Shifting a share of assembly out of China',
            tags: ['de-risking'],
            trend: 'up',
          },
        ],
      },
    },
  },
  {
    ticker: 'NVDA',
    name: 'NVIDIA Corp.',
    sector: 'Technology · Semiconductors',
    asOf: 'FY2025',
    currency: 'USD',
    statements: [
      {
        id: 'nvda-10k-2025',
        title: 'Form 10-K (FY2025)',
        period: 'FY2025',
        date: '2025-02-26',
        type: '10-K',
        url: 'https://investor.nvidia.com/financial-info/sec-filings/default.aspx',
      },
    ],
    categories: {
      revenue: {
        summary:
          'FY2025 revenue $130.5B (+114% YoY), overwhelmingly Data Center as AI accelerator demand outstripped supply.',
        tiles: [
          {
            label: 'FY2025 revenue',
            value: '$130.5B',
            change: '+114% YoY',
            trend: 'up',
          },
          { label: 'Data Center', value: '~$115B', trend: 'up' },
          { label: 'Gross margin', value: '~75%', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Data Center',
            detail: 'GPUs & systems for AI training/inference — ~88% of revenue',
            tags: ['dominant', 'concentration'],
            trend: 'up',
          },
          {
            name: 'Gaming',
            detail: 'GeForce consumer GPUs',
            tags: ['legacy core'],
          },
          {
            name: 'Professional Viz',
            detail: 'Workstation and design GPUs',
            tags: ['niche'],
          },
          {
            name: 'Automotive',
            detail: 'Autonomous and in-vehicle compute',
            tags: ['emerging'],
            trend: 'up',
          },
        ],
      },
      risk: {
        summary:
          'Extreme demand tied to the AI cycle, concentrated hyperscaler customers, and export-control exposure to China.',
        tiles: [
          { label: 'Customer concentration', value: 'High', trend: 'down' },
          { label: 'Export controls', value: 'Material', trend: 'down' },
          { label: 'Cyclicality', value: 'High', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'Hyperscaler concentration',
            detail: 'A handful of cloud buyers drive a large share of revenue',
            tags: ['concentration'],
          },
          {
            name: 'China export controls',
            detail: 'US restrictions limit advanced-GPU sales to China',
            tags: ['geopolitical'],
          },
          {
            name: 'AI-cycle demand',
            detail: 'Growth depends on sustained AI capex',
            tags: ['cyclical'],
          },
          {
            name: 'Competition',
            detail: 'Custom silicon and rival accelerators',
            tags: ['competitive'],
          },
        ],
      },
      costOfCapital: {
        summary:
          'Net-cash balance sheet and huge free cash flow; higher beta than mega-cap peers reflects growth and cyclicality.',
        tiles: [
          { label: 'Beta', value: '~1.7', note: 'est.', trend: 'flat' },
          { label: 'Net cash', value: 'Positive', trend: 'up' },
          { label: 'FCF', value: 'Very high', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Self-funded',
            detail: 'Operations funded from cash flow, little net debt',
            tags: ['equity-heavy'],
          },
          {
            name: 'Elevated cost of equity',
            detail: 'Higher beta lifts the discount rate (est.)',
            tags: ['estimate'],
          },
          {
            name: 'Buybacks',
            detail: 'Large repurchase program returns capital',
            tags: ['capital return'],
          },
        ],
      },
      costs: {
        summary:
          'Fabless model: wafer and packaging costs sit in COGS at ~75% gross margin, with heavy R&D reinvestment.',
        tiles: [
          { label: 'Gross margin', value: '~75%', trend: 'up' },
          { label: 'R&D', value: 'Rising fast', trend: 'up' },
          { label: 'Op. margin', value: '~62%', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Wafer & packaging',
            detail: 'TSMC fabrication and CoWoS advanced packaging',
            tags: ['largest cost'],
          },
          {
            name: 'HBM memory',
            detail: 'High-bandwidth memory bundled with accelerators',
            tags: ['components'],
          },
          {
            name: 'R&D',
            detail: 'Next-gen GPU architectures and software stack',
            tags: ['investment'],
          },
        ],
      },
      supplyChain: {
        summary:
          'Deeply dependent on TSMC fabrication, CoWoS packaging capacity and HBM memory — each a potential bottleneck.',
        tiles: [
          { label: 'Fab', value: 'TSMC', trend: 'down' },
          { label: 'Packaging', value: 'CoWoS', trend: 'down' },
          { label: 'Memory', value: 'HBM', trend: 'flat' },
        ],
        subcategories: [
          {
            name: 'TSMC',
            detail: 'Sole advanced foundry — key single point of dependency',
            tags: ['single source'],
          },
          {
            name: 'CoWoS packaging',
            detail: 'Advanced-packaging capacity is the tightest bottleneck',
            tags: ['bottleneck'],
          },
          {
            name: 'HBM suppliers',
            detail: 'SK Hynix, Samsung and Micron supply HBM stacks',
            tags: ['components'],
          },
          {
            name: 'System integrators',
            detail: 'Foxconn and ODMs build server systems',
            tags: ['assembly'],
          },
        ],
      },
    },
  },
];

// ---- Favorites persistence (statement IDs) --------------------------------

const FAVORITES_KEY = 'news:favorite-statements';

export function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function getStock(ticker: string): StockFinancials | undefined {
  return STOCKS.find((s) => s.ticker === ticker);
}

export function allStatements(): Array<StatementDoc & { ticker: string }> {
  return STOCKS.flatMap((s) =>
    s.statements.map((d) => ({ ...d, ticker: s.ticker }))
  );
}
