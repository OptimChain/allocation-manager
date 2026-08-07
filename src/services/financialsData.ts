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
    ticker: 'NET',
    name: 'Cloudflare, Inc.',
    sector: 'Technology · Internet Infrastructure',
    asOf: 'Q2 2026',
    currency: 'USD',
    statements: [
      {
        id: 'net-q2-2026',
        title: 'Second Quarter 2026 Financial Results',
        period: 'Q2 2026',
        date: '2026-08-06',
        type: 'Earnings',
        url: 'https://www.cloudflare.com/press/press-releases/2026/cloudflare-announces-second-quarter-2026-financial-results/',
      },
      {
        id: 'net-q1-2026',
        title: 'First Quarter 2026 Financial Results',
        period: 'Q1 2026',
        date: '2026-05-07',
        type: 'Earnings',
        url: 'https://www.cloudflare.com/press/press-releases/2026/cloudflare-announces-first-quarter-2026-financial-results/',
      },
      {
        id: 'net-fy2025',
        title: 'Q4 & Fiscal Year 2025 Financial Results',
        period: 'Q4 & FY2025',
        date: '2026-02-10',
        type: 'Earnings',
        url: 'https://www.cloudflare.com/press/press-releases/2026/cloudflare-announces-fourth-quarter-and-fiscal-year-2025-financial-results/',
      },
    ],
    categories: {
      revenue: {
        summary:
          'Q2 2026 revenue $696.1M, up 36% YoY — an acceleration on FY2025’s $2,167.9M (+30%). Growth is coming from enterprise expansion rather than new logos, and full-year guidance was raised to $2.86–2.87B.',
        tiles: [
          {
            label: 'Q2 2026 revenue',
            value: '$696.1M',
            change: '+36% YoY',
            trend: 'up',
          },
          {
            label: 'FY2026 guidance',
            value: '$2.87B',
            change: 'raised',
            trend: 'up',
          },
          {
            label: 'Large customers',
            value: '4,698',
            change: '+27% YoY',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Large customers ($100k+)',
            detail: '4,698 accounts at quarter end, now 73% of total revenue',
            tags: ['enterprise', 'largest driver'],
            trend: 'up',
          },
          {
            name: 'Dollar-based net retention',
            detail: '120%, up from 118% last quarter and 114% a year ago',
            tags: ['expansion'],
            trend: 'up',
          },
          {
            name: 'Current RPO',
            detail: 'Contracted-but-unrecognized revenue up 35% YoY',
            tags: ['backlog', 'visibility'],
            trend: 'up',
          },
          {
            name: 'Developer platform & Workers AI',
            detail:
              'Over 5.5M developers; serverless GPU inference in 180+ cities',
            tags: ['AI', 'fastest growth'],
            trend: 'up',
          },
          {
            name: 'Application & network services',
            detail: 'CDN, DDoS, WAF and Zero Trust — the core subscription base',
            tags: ['core', 'recurring'],
          },
          {
            name: 'AI content monetization',
            detail: 'AI Crawl Control and pay-per-crawl — early and unpriced',
            tags: ['AI', 'emerging'],
            trend: 'up',
          },
        ],
      },
      risk: {
        summary:
          'Growth is not in question; margins and execution are. Gross margin fell 310bps YoY as the GPU and network build scaled, a 20% workforce cut is still landing, and the November 2025 outage made concentration a public issue.',
        tiles: [
          {
            label: 'Gross margin',
            value: '71.8%',
            change: '-310 bps YoY',
            trend: 'down',
          },
          { label: 'Restructuring', value: 'In flight', trend: 'down' },
          { label: 'Outage exposure', value: 'Systemic', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'Margin compression',
            detail:
              'GAAP gross margin 71.8% vs 74.9% a year ago as GPUs and capacity scale',
            tags: ['margins'],
          },
          {
            name: 'Restructuring execution',
            detail:
              'Over 1,100 roles cut; headcount down from 5,483 to ~4,700, finishing in Q3',
            tags: ['execution', 'one-off'],
          },
          {
            name: 'Systemic outage exposure',
            detail:
              'The November 2025 outage took down large parts of the web and drew concentration scrutiny',
            tags: ['operational'],
          },
          {
            name: 'Hyperscaler competition',
            detail:
              'AWS, Azure and Google can bundle CDN and security inside broader cloud deals',
            tags: ['competitive'],
          },
          {
            name: 'AI monetization is unproven',
            detail:
              'Pay-per-crawl and edge inference revenue are early relative to the capex behind them',
            tags: ['AI'],
          },
          {
            name: 'Valuation',
            detail:
              'Shares trade at record highs, above the average published price target',
            tags: ['market'],
          },
        ],
      },
      costOfCapital: {
        summary:
          '$4.16B of cash and securities against $1.75B of zero-coupon converts due 2030 — capital raised at no cash interest, paid for in dilution. No dividend or buyback; free cash flow now funds part of the network build.',
        tiles: [
          {
            label: 'Cash & securities',
            value: '$4.16B',
            trend: 'up',
          },
          {
            label: 'Convertible notes',
            value: '$1.75B',
            note: '0% due 2030',
            trend: 'flat',
          },
          { label: 'Beta', value: '~1.7', note: 'est.', trend: 'flat' },
        ],
        subcategories: [
          {
            name: 'Zero-coupon converts',
            detail:
              '$1.75B due June 2030, no cash interest, ~$247.67 conversion price',
            tags: ['debt', 'dilution'],
          },
          {
            name: 'Liquidity',
            detail:
              '$4,162.8M in cash and available-for-sale securities at June 30, 2026',
            tags: ['liquidity'],
          },
          {
            name: 'Free cash flow',
            detail: 'Q2 free cash flow $56.4M, 8% of revenue, up from 6%',
            tags: ['self-funded'],
            trend: 'up',
          },
          {
            name: 'No capital return',
            detail:
              'No dividend or buyback; stock-based comp dilutes rather than offsets',
            tags: ['equity-heavy'],
          },
        ],
      },
      costs: {
        summary:
          'Non-GAAP operating income was $96.1M (13.8% of revenue), but GAAP swung to a $205.7M loss on a $150.7M restructuring charge. Network capex is guided to 14–15% of revenue for the year.',
        tiles: [
          {
            label: 'Non-GAAP op. margin',
            value: '13.8%',
            change: '-30 bps YoY',
            trend: 'down',
          },
          {
            label: 'Restructuring',
            value: '$150.7M',
            note: 'Q2',
            trend: 'down',
          },
          {
            label: 'Network capex',
            value: '14–15%',
            note: 'of revenue',
            trend: 'down',
          },
        ],
        subcategories: [
          {
            name: 'Cost of revenue',
            detail:
              'Bandwidth, colocation and the GPU fleet — the driver of the margin step-down',
            tags: ['largest cost'],
          },
          {
            name: 'Restructuring charges',
            detail: '$140–150M across 2026, roughly $40M of it non-cash',
            tags: ['one-off'],
          },
          {
            name: 'Network capex',
            detail: '9% of revenue in Q1, guided to 14–15% for the full year',
            tags: ['capex'],
          },
          {
            name: 'Stock-based compensation',
            detail: 'The main gap between GAAP and non-GAAP results',
            tags: ['non-cash'],
          },
          {
            name: 'R&D and go-to-market',
            detail: 'Enterprise sales build-out alongside the AI product push',
            tags: ['investment'],
          },
        ],
      },
      supplyChain: {
        summary:
          'Cloudflare owns more of its stack than most software companies — a self-built network in 330+ cities across 125+ countries — but still leans on colocation and transit partners, server ODMs, and NVIDIA silicon for inference.',
        tiles: [
          { label: 'Network', value: '330+ cities', trend: 'up' },
          { label: 'Inference GPUs', value: '180+ cities', trend: 'up' },
          { label: 'Model', value: 'Self-built', trend: 'flat' },
        ],
        subcategories: [
          {
            name: 'Global network',
            detail:
              '330+ cities in 125+ countries, with every service running on every server',
            tags: ['owned', 'moat'],
          },
          {
            name: 'Colocation & interconnection',
            detail:
              'Leased rack space, internet-exchange peering and transit providers',
            tags: ['dependency'],
          },
          {
            name: 'NVIDIA GPUs',
            detail: 'Inference hardware deployed to 180+ cities for Workers AI',
            tags: ['components', 'AI'],
          },
          {
            name: 'Server ODMs & components',
            detail:
              'Custom servers; CPU, memory and SSD pricing feeds straight into gross margin',
            tags: ['components'],
          },
          {
            name: 'AI model partners',
            detail:
              'Anthropic and Google partnerships underpin the agent tooling',
            tags: ['AI', 'partners'],
          },
        ],
      },
    },
  },
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
