// Financial statements & fundamentals data for the News tab.
//
// Curated, statement-grounded fundamentals per stock, organized around the
// dimensions that matter when reading a company's financial statements:
// revenue, risk factors, cost of capital, cost structure, and the supply
// chains the business depends on. Each dimension carries headline stat tiles
// plus sub-categories drawn from the filings.
//
// Figures come from each company's own results releases and SEC filings —
// the documents linked in `statements` below. Fiscal calendars differ, so the
// `asOf` field names the latest reported period per stock rather than a shared
// one. Cost-of-capital metrics are marked "est." where they are analyst
// estimates rather than reported line items.

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
    asOf: 'Q2 2026',
    currency: 'USD',
    statements: [
      {
        id: 'hood-q2-2026',
        title: 'Robinhood Reports Second Quarter 2026 Results',
        period: 'Q2 2026',
        date: '2026-07-29',
        type: 'Earnings',
        url: 'https://investors.robinhood.com/news-releases/news-release-details/robinhood-reports-second-quarter-2026-results',
      },
      {
        id: 'hood-10q-q2-2026',
        title: 'Form 10-Q (Q2 2026)',
        period: 'Q2 2026',
        date: '2026-07-30',
        type: '10-Q',
        url: 'https://www.sec.gov/Archives/edgar/data/1783879/000178387926000114/hood-20260630.htm',
      },
      {
        id: 'hood-10k-2025',
        title: 'Form 10-K (FY2025)',
        period: 'FY2025',
        date: '2026-02-18',
        type: '10-K',
        url: 'https://www.sec.gov/Archives/edgar/data/1783879/000178387926000023/hood-20251231.htm',
      },
    ],
    categories: {
      revenue: {
        summary:
          'Q2 2026 net revenue $1.31B, up 32%, and the mix has flipped: event contracts went from $10M to $156M in a year while crypto fell 38%. FY2025 closed at $4.47B.',
        tiles: [
          {
            label: 'Q2 net revenue',
            value: '$1.31B',
            change: '+32% YoY',
            trend: 'up',
          },
          {
            label: 'Transaction revenue',
            value: '$776M',
            change: '+44% YoY',
            trend: 'up',
          },
          {
            label: 'Platform assets',
            value: '$368.7B',
            change: '+32% YoY',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Options',
            detail: 'Q2 $342M, up 29% on 43% more contracts traded per trader',
            tags: ['transaction', 'largest driver'],
            trend: 'up',
          },
          {
            name: 'Event contracts',
            detail: '$156M against $10M a year ago — now 12% of total revenue',
            tags: ['transaction', 'fastest growth'],
            trend: 'up',
          },
          {
            name: 'Equities',
            detail: 'Q2 $129M, up 95% on higher notional volume per trader',
            tags: ['transaction'],
            trend: 'up',
          },
          {
            name: 'Cryptocurrencies',
            detail: '$100M, down 38% on lower market-maker rebates and fewer traders',
            tags: ['transaction', 'volatile'],
            trend: 'down',
          },
          {
            name: 'Net interest revenue',
            detail:
              '$389M, up 9% — margin interest nearly doubled to $215M as securities lending fell to $10M',
            tags: ['rate-sensitive'],
            trend: 'up',
          },
          {
            name: 'Gold & other',
            detail:
              'Other revenue $143M, including $54M of Gold subscriptions across 4.84M subscribers',
            tags: ['recurring'],
            trend: 'up',
          },
          {
            name: 'Customer growth',
            detail: '28.4M funded customers and $21.7B of net deposits in the quarter',
            tags: ['growth'],
            trend: 'up',
          },
        ],
      },
      risk: {
        summary:
          'Event contracts are now 12% of revenue and the subject of litigation that could stop the product outright. Rates cut the other way: Robinhood sizes a 100bp move at $350M of annual revenue.',
        tiles: [
          {
            label: 'Event contracts',
            value: '12%',
            note: 'of Q2 revenue',
            trend: 'down',
          },
          {
            label: 'Rate sensitivity',
            value: '$350M',
            note: 'per 100 bps',
            trend: 'flat',
          },
          {
            label: 'Transaction mix',
            value: '59%',
            note: 'of revenue',
            trend: 'down',
          },
        ],
        subcategories: [
          {
            name: 'Event-contract litigation',
            detail:
              'Tribal RICO claims in California and a Wisconsin suit calling the contracts illegal sports betting',
            tags: ['regulatory', 'product risk'],
          },
          {
            name: 'Transaction-revenue concentration',
            detail: '59% of net revenue, with options alone at 26%',
            tags: ['concentration'],
          },
          {
            name: 'Interest-rate risk',
            detail:
              'A 100bp move is worth $350M a year, up from $247M twelve months ago',
            tags: ['macro'],
          },
          {
            name: 'Crypto regulation',
            detail:
              'California DFAL licence applications still pending; assets gated in New York and Texas',
            tags: ['regulatory', 'crypto'],
          },
          {
            name: 'Legacy investigations',
            detail:
              'DOJ, SEC, FINRA and state AG matters over the early-2021 trading restrictions remain open',
            tags: ['regulatory'],
          },
          {
            name: 'Cybersecurity & operational',
            detail:
              'Custody of customer cash, securities and crypto, plus reliance on third parties for key functions',
            tags: ['operational'],
          },
        ],
      },
      costOfCapital: {
        summary:
          'Robinhood took on real debt for the first time — $2.2B of zero-coupon converts due 2029 at a 0.43% effective rate — while keeping $4.9B of revolvers undrawn and a $1.5B buyback authorization live.',
        tiles: [
          {
            label: 'Convertible notes',
            value: '$2.2B',
            note: '0% due 2029',
            trend: 'flat',
          },
          { label: 'Effective rate', value: '0.43%', trend: 'up' },
          {
            label: 'Buyback',
            value: '$1.5B',
            note: 'authorized Mar 2026',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Zero-coupon converts',
            detail:
              '$2.2B issued in June 2026 at a ~$174.42 conversion price, with capped calls lifting the cap to ~$237.85',
            tags: ['debt', 'dilution'],
          },
          {
            name: 'Undrawn revolvers',
            detail: '$4.875B of committed capacity with nothing drawn',
            tags: ['liquidity'],
          },
          {
            name: 'Credit-card funding',
            detail:
              '$959M outstanding through a consolidated trust at 5.06%, plus a $500M ABS deal in July',
            tags: ['debt'],
          },
          {
            name: 'Buybacks',
            detail:
              '$414M repurchased in Q2, including $290M alongside the convertible offering',
            tags: ['capital return'],
            trend: 'up',
          },
          {
            name: 'Cost of equity',
            detail:
              'Beta above 2 on a five-year monthly basis (est.), so equity dominates the blended cost',
            tags: ['estimate'],
          },
        ],
      },
      costs: {
        summary:
          'Opex grew 33% against revenue up 32%, so operating leverage went flat. G&A rose 51%, operations nearly doubled, and credit-loss provisions doubled as the card book scaled. A 10% headcount cut in June cost $23M.',
        tiles: [
          {
            label: 'Q2 opex',
            value: '$734M',
            change: '+33% YoY',
            trend: 'down',
          },
          {
            label: 'Adj. EBITDA margin',
            value: '57%',
            change: '+2 pp YoY',
            trend: 'up',
          },
          {
            label: 'Restructuring',
            value: '$23M',
            note: '10% of staff',
            trend: 'down',
          },
        ],
        subcategories: [
          {
            name: 'Technology & development',
            detail: '$256M, up 20% — still the largest operating line',
            tags: ['largest opex'],
          },
          {
            name: 'General & administrative',
            detail: '$199M, up 51% — the sharpest cost increase this quarter',
            tags: ['pressure point'],
            trend: 'down',
          },
          {
            name: 'Operations',
            detail: '$57M, nearly double a year ago',
            tags: ['pressure point'],
            trend: 'down',
          },
          {
            name: 'Provision for credit losses',
            detail: '$56M, doubled as the credit card book scales',
            tags: ['credit'],
            trend: 'down',
          },
          {
            name: 'Stock-based compensation',
            detail: '$105M, or 8% of revenue',
            tags: ['non-cash'],
          },
          {
            name: 'June restructuring',
            detail: 'About 10% of full-time staff cut, for a $23M charge',
            tags: ['one-off'],
          },
        ],
      },
      supplyChain: {
        summary:
          'The fintech supply chain: market makers that set the rebate rates, self-clearing through Robinhood Securities, a network of program banks holding swept cash, and Coastal Community Bank issuing the credit card.',
        tiles: [
          { label: 'Order routing', value: 'PFOF', trend: 'flat' },
          { label: 'Clearing', value: 'Self-cleared', trend: 'up' },
          { label: 'Card issuer', value: 'Coastal Bank', trend: 'flat' },
        ],
        subcategories: [
          {
            name: 'Market-maker rebates',
            detail:
              'Crypto revenue fell 38% largely because market-maker rebate rates dropped — a direct pricing dependency',
            tags: ['revenue input', 'concentration'],
            trend: 'down',
          },
          {
            name: 'Clearing & custody',
            detail:
              'Robinhood Securities self-clears, with $1.24B on deposit at clearing organizations',
            tags: ['in-house'],
          },
          {
            name: 'Securities lending',
            detail: '$19.95B re-pledged to third parties, but revenue fell to $10M',
            tags: ['net interest'],
            trend: 'down',
          },
          {
            name: 'Bank sweep network',
            detail:
              'An off-balance-sheet program of partner banks; $6B moved out of sweep in February to fund margin lending',
            tags: ['net interest'],
          },
          {
            name: 'Credit card issuing',
            detail: 'Coastal Community Bank funds up to $500M of receivables',
            tags: ['partner'],
          },
          {
            name: 'Acquisitions',
            detail:
              'Bitstamp for crypto, TradePMR for RIA custody ($50B of assets), and WonderFi from June 2026',
            tags: ['integration'],
          },
        ],
      },
    },
  },
  {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    sector: 'Technology · Consumer Electronics',
    asOf: 'Q3 FY2026',
    currency: 'USD',
    statements: [
      {
        id: 'aapl-q3-fy2026',
        title: 'Apple Reports Third Quarter Results',
        period: 'Q3 FY2026',
        date: '2026-07-30',
        type: 'Earnings',
        url: 'https://www.apple.com/newsroom/2026/07/apple-reports-third-quarter-results/',
      },
      {
        id: 'aapl-10q-q3-fy2026',
        title: 'Form 10-Q (Q3 FY2026)',
        period: 'Q3 FY2026',
        date: '2026-07-31',
        type: '10-Q',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm',
      },
      {
        id: 'aapl-10k-fy2025',
        title: 'Form 10-K (FY2025)',
        period: 'FY2025',
        date: '2025-10-31',
        type: '10-K',
        url: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm',
      },
    ],
    categories: {
      revenue: {
        summary:
          'Q3 FY2026 revenue $109.4B, up 16% — Apple’s fastest growth in years, with Greater China back up 22% after a down FY2025. The full FY2025 year closed at $416.2B (+6%) and Services cleared $100B for the first time.',
        tiles: [
          {
            label: 'Q3 FY2026 revenue',
            value: '$109.4B',
            change: '+16% YoY',
            trend: 'up',
          },
          {
            label: 'FY2025 revenue',
            value: '$416.2B',
            change: '+6% YoY',
            trend: 'up',
          },
          {
            label: 'Q3 Services',
            value: '$30.7B',
            change: '+12% YoY',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'iPhone',
            detail: 'Q3 revenue $54.3B, up 22%; still ~50% of the top line',
            tags: ['products', 'concentration'],
            trend: 'up',
          },
          {
            name: 'Services',
            detail: 'FY2025 $109.2B (+14%) at a record 75.4% gross margin',
            tags: ['recurring', 'high margin'],
            trend: 'up',
          },
          {
            name: 'Mac',
            detail: 'Q3 revenue $10.4B, up 29% on the Apple-silicon refresh',
            tags: ['products'],
            trend: 'up',
          },
          {
            name: 'iPad',
            detail: 'Q3 revenue $6.2B, down 6% YoY',
            tags: ['products'],
            trend: 'down',
          },
          {
            name: 'Wearables, Home & Accessories',
            detail: 'Q3 revenue $7.9B, up 7% after a 4% decline in FY2025',
            tags: ['products'],
          },
          {
            name: 'Greater China',
            detail: 'Nine-month FY2026 sales $64.8B, up 30% after a soft FY2025',
            tags: ['geography', 'turnaround'],
            trend: 'up',
          },
        ],
      },
      risk: {
        summary:
          'Two things reshaped the risk picture this year: memory and advanced-semiconductor costs that Apple says it expects to intensify, and EU rules that have already cost €500M and now shape where Siri AI can ship.',
        tiles: [
          { label: 'Component costs', value: 'Intensifying', trend: 'down' },
          { label: 'iPhone share', value: '50%', trend: 'down' },
          { label: 'EU DMA fine', value: '€500M', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'Component supply & cost',
            detail:
              'Filings flag NAND, DRAM and advanced-semi shortages and expect the squeeze to intensify',
            tags: ['supply', 'margins'],
          },
          {
            name: 'iPhone dependence',
            detail: 'One product line was 50.4% of FY2025 revenue',
            tags: ['concentration'],
          },
          {
            name: 'EU Digital Markets Act',
            detail:
              '€500M fine under appeal; a second case carries fines up to 10% of worldwide sales',
            tags: ['regulatory'],
          },
          {
            name: 'Siri AI availability',
            detail:
              'Interoperability obligations may keep features out of some jurisdictions',
            tags: ['regulatory', 'AI'],
          },
          {
            name: 'Google search payments',
            detail:
              'US antitrust remedies on appeal could end the search-distribution payments',
            tags: ['regulatory'],
          },
          {
            name: 'Tariffs',
            detail:
              'IEEPA tariffs struck down in Feb 2026 with refunds flowing back; Section 301 and 232 exposure remains',
            tags: ['macro'],
          },
          {
            name: 'Greater China',
            detail: '15.5% of FY2025 revenue and a core manufacturing base',
            tags: ['geopolitical'],
          },
        ],
      },
      costOfCapital: {
        summary:
          '$146.5B of cash and securities against $84.3B of debt — a ~$62B net cash position, rated AA+/Aaa, funding a fresh $100B buyback authorization and a raised dividend.',
        tiles: [
          { label: 'Net cash', value: '$62.2B', trend: 'up' },
          { label: 'Credit', value: 'AA+ / Aaa', trend: 'up' },
          {
            label: 'Buyback',
            value: '$100B',
            note: 'new authorization',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Net cash position',
            detail:
              '$146.5B of cash and marketable securities vs $84.3B of total debt at June 27, 2026',
            tags: ['liquidity'],
          },
          {
            name: 'Legacy low-cost debt',
            detail:
              'Term debt carries at $82.3B but trades at $71.2B — a 0.03%–5.75% coupon stack',
            tags: ['debt'],
          },
          {
            name: 'Buybacks',
            detail:
              '$100B authorization added in April 2026; $61.8B repurchased in the first nine months',
            tags: ['capital return'],
            trend: 'up',
          },
          {
            name: 'Dividend',
            detail: 'Raised 4% to $0.27 a quarter',
            tags: ['capital return'],
            trend: 'up',
          },
          {
            name: 'Cost of equity',
            detail: 'Beta near 1.09 on a five-year monthly basis (est.)',
            tags: ['estimate'],
          },
        ],
      },
      costs: {
        summary:
          'Gross margin hit 50.1% in Q3 FY2026, but roughly 2 points of that was tariff refunds. The durable signal is R&D up 32% YoY on AI infrastructure, breaking a decade of flat 8%-of-sales discipline.',
        tiles: [
          {
            label: 'Q3 gross margin',
            value: '50.1%',
            note: 'incl. ~2pp refunds',
            change: '+3.6 pp YoY',
            trend: 'up',
          },
          {
            label: 'Q3 R&D',
            value: '$11.7B',
            change: '+32% YoY',
            trend: 'up',
          },
          { label: 'Q3 op. margin', value: '32.6%', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Products COGS',
            detail:
              'Components and assembly; memory prices are now lifting unit costs',
            tags: ['largest cost'],
            trend: 'down',
          },
          {
            name: 'Services margin',
            detail: 'A record 75.4% in FY2025 and holding at 75.6% in Q3',
            tags: ['high margin'],
            trend: 'up',
          },
          {
            name: 'R&D',
            detail:
              '$34.6B in FY2025, then up 32% YoY in Q3 on AI infrastructure',
            tags: ['investment'],
            trend: 'up',
          },
          {
            name: 'SG&A',
            detail: '$27.6B in FY2025, steady at 7% of sales',
            tags: ['fixed'],
          },
          {
            name: 'Tariff refunds',
            detail:
              'IEEPA repayments booked against cost of sales, worth $0.11 of Q3 EPS',
            tags: ['one-off'],
          },
        ],
      },
      supplyChain: {
        summary:
          'Apple names no suppliers in its filings, but describes single-source partners across the US, Asia and Europe and final assembly concentrated in Asia. The visible move this year is stockpiling: component inventory went from $2.1B to $7.6B in nine months.',
        tiles: [
          {
            label: 'Component inventory',
            value: '$7.6B',
            change: '3.6x since Sept',
            trend: 'up',
          },
          {
            label: 'Purchase obligations',
            value: '$56.2B',
            note: 'FY2025',
            trend: 'flat',
          },
          { label: 'US commitment', value: '$600B', note: '4 years', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'Manufacturing footprint',
            detail:
              'Outsourced partners in China, India, Japan, South Korea, Taiwan and Vietnam, plus US sourcing',
            tags: ['assembly'],
          },
          {
            name: 'Vendor concentration',
            detail:
              'Two vendors held 47% and 22% of non-trade receivables at June 27, 2026',
            tags: ['concentration'],
          },
          {
            name: 'Component stockpiling',
            detail:
              'Component inventory rose to $7.6B from $2.1B while finished goods stayed flat',
            tags: ['supply'],
            trend: 'up',
          },
          {
            name: 'Memory & advanced semis',
            detail:
              'NAND and DRAM tightness feeds straight into products gross margin',
            tags: ['components'],
            trend: 'down',
          },
          {
            name: 'US manufacturing program',
            detail:
              'A $600B four-year commitment; over 100M TSMC Arizona chips planned for 2026',
            tags: ['de-risking'],
            trend: 'up',
          },
          {
            name: 'AI compute capacity',
            detail:
              'Data-center and third-party cloud capacity is constrained with longer lead times',
            tags: ['infra', 'AI'],
          },
        ],
      },
    },
  },
  {
    ticker: 'NVDA',
    name: 'NVIDIA Corp.',
    sector: 'Technology · Semiconductors',
    asOf: 'Q1 FY2027',
    currency: 'USD',
    statements: [
      {
        id: 'nvda-q1-fy2027',
        title: 'Financial Results for First Quarter Fiscal 2027',
        period: 'Q1 FY2027',
        date: '2026-05-20',
        type: 'Earnings',
        url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2027',
      },
      {
        id: 'nvda-10q-q1-fy2027',
        title: 'Form 10-Q (Q1 FY2027)',
        period: 'Q1 FY2027',
        date: '2026-05-20',
        type: '10-Q',
        url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000052/nvda-20260426.htm',
      },
      {
        id: 'nvda-10k-fy2026',
        title: 'Form 10-K (FY2026)',
        period: 'FY2026',
        date: '2026-02-25',
        type: '10-K',
        url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm',
      },
    ],
    categories: {
      revenue: {
        summary:
          'Q1 FY2027 revenue $81.6B, up 85%, with Data Center at $75.2B. FY2026 closed at $215.9B (+65%). Q2 is guided to $91B — and that guide assumes no Data Center compute revenue from China at all.',
        tiles: [
          {
            label: 'Q1 FY2027 revenue',
            value: '$81.6B',
            change: '+85% YoY',
            trend: 'up',
          },
          {
            label: 'Data Center',
            value: '$75.2B',
            change: '+92% YoY',
            trend: 'up',
          },
          {
            label: 'Q2 guidance',
            value: '$91B',
            note: '±2%',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Data Center',
            detail:
              'Q1 $75.2B — hyperscale $37.9B, AI clouds and enterprise $37.4B',
            tags: ['dominant', 'concentration'],
            trend: 'up',
          },
          {
            name: 'Networking',
            detail: 'FY2026 $31.4B, up 142% — the fastest-growing line',
            tags: ['attach rate'],
            trend: 'up',
          },
          {
            name: 'Edge computing',
            detail: 'Gaming, ProViz and Automotive together $6.4B in Q1, up 29%',
            tags: ['products'],
            trend: 'up',
          },
          {
            name: 'FY2026 full year',
            detail: 'Revenue $215.9B (+65%) on net income of $120.1B',
            tags: ['record'],
            trend: 'up',
          },
          {
            name: 'China',
            detail:
              '$4.55B in Q1, 5.6% of revenue, and excluded from forward guidance',
            tags: ['geography'],
            trend: 'down',
          },
          {
            name: 'Rubin platform',
            detail: 'Production shipments start in the second half of FY2027',
            tags: ['roadmap'],
            trend: 'up',
          },
        ],
      },
      risk: {
        summary:
          'Concentration got materially worse: three direct customers were 54% of Q1 revenue. China Data Center compute is effectively zero and excluded from guidance, and $119B of supply commitments bet hard on the AI capex cycle holding.',
        tiles: [
          {
            label: 'Top 3 customers',
            value: '54%',
            note: 'of Q1 revenue',
            trend: 'down',
          },
          {
            label: 'China revenue',
            value: '5.6%',
            note: 'of Q1',
            trend: 'down',
          },
          { label: 'Supply commitments', value: '$119B', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'Customer concentration',
            detail:
              'Three direct customers were 21%, 17% and 16% of Q1 revenue, against two at 30% a year ago',
            tags: ['concentration'],
          },
          {
            name: 'China export controls',
            detail:
              'No Hopper Data Center shipments in Q1 versus $4.6B a year ago; H200 licences granted but no revenue yet',
            tags: ['geopolitical'],
          },
          {
            name: 'Uncodified revenue share',
            detail:
              'US officials expect 15% or more of licensed China sales, still not written into any regulation',
            tags: ['geopolitical', 'regulatory'],
          },
          {
            name: 'AI capex cycle',
            detail:
              '$119B of supply commitments, $95B due inside FY2027, against customers who may struggle to finance buildouts',
            tags: ['cyclical'],
          },
          {
            name: 'Circular financing',
            detail:
              '$17.5B invested in private AI companies in FY2026 plus $3.5B of land and power guarantees',
            tags: ['related demand'],
          },
          {
            name: 'Competition',
            detail:
              'AMD, Huawei and Intel, plus hyperscalers designing their own accelerators',
            tags: ['competitive'],
          },
        ],
      },
      costOfCapital: {
        summary:
          'A $25B bond deal in June 2026 ended the debt-light era, though NVIDIA still holds ~$80B of cash and securities and threw off $96.7B of free cash flow in FY2026. Buyback capacity sits near $118B.',
        tiles: [
          { label: 'FY2026 free cash flow', value: '$96.7B', trend: 'up' },
          {
            label: 'New debt',
            value: '$25B',
            note: 'June 2026',
            trend: 'flat',
          },
          { label: 'Buyback capacity', value: '~$118B', trend: 'up' },
        ],
        subcategories: [
          {
            name: 'June 2026 notes',
            detail:
              '$25B across seven tranches at 4.25%–5.625%, maturing 2028 through 2056',
            tags: ['debt'],
          },
          {
            name: 'Liquidity',
            detail:
              '$80.6B of cash and marketable securities at April 26, 2026, before the bond deal',
            tags: ['liquidity'],
          },
          {
            name: 'Free cash flow',
            detail: '$96.7B in FY2026, and $48.6B in Q1 FY2027 alone',
            tags: ['self-funded'],
            trend: 'up',
          },
          {
            name: 'Capital return',
            detail:
              '$80B added to the buyback in May 2026; dividend raised to $0.25 a share',
            tags: ['capital return'],
            trend: 'up',
          },
          {
            name: 'Cost of equity',
            detail: 'Beta around 2.2 on a five-year basis (est.)',
            tags: ['estimate'],
          },
        ],
      },
      costs: {
        summary:
          'FY2026 gross margin fell to 71.1% on the Blackwell system transition and a $4.5B H20 write-off, then snapped back to 74.9% in Q1 FY2027. R&D rose 43% while opex fell as a share of revenue.',
        tiles: [
          {
            label: 'FY2026 gross margin',
            value: '71.1%',
            change: '-3.9 pp YoY',
            trend: 'down',
          },
          {
            label: 'Q1 gross margin',
            value: '74.9%',
            change: 'recovered',
            trend: 'up',
          },
          {
            label: 'FY2026 R&D',
            value: '$18.5B',
            change: '+43% YoY',
            trend: 'up',
          },
        ],
        subcategories: [
          {
            name: 'Wafer, packaging & memory',
            detail:
              'Cost of revenue spans fabrication, CoWoS packaging, assembly and test, memory, tariffs and shipping',
            tags: ['largest cost'],
          },
          {
            name: 'H20 charge',
            detail:
              '$4.5B written off against China export licences, part of $7.2B of FY2026 inventory provisions',
            tags: ['one-off'],
          },
          {
            name: 'Blackwell transition',
            detail:
              'Full-rack systems carry more third-party content than the Hopper HGX boards they replaced',
            tags: ['mix'],
            trend: 'down',
          },
          {
            name: 'R&D',
            detail: '$18.5B in FY2026, up 43%, and $6.3B in Q1 alone',
            tags: ['investment'],
            trend: 'up',
          },
          {
            name: 'Operating leverage',
            detail: 'Opex is 10.7% of revenue, down from 12.6% a year earlier',
            tags: ['op. leverage'],
            trend: 'up',
          },
        ],
      },
      supplyChain: {
        summary:
          'The 10-K names the whole chain: TSMC and Samsung for wafers, SK Hynix, Micron and Samsung for memory, CoWoS for packaging, and Foxconn, Wistron and Fabrinet for assembly. $119B of commitments locks in capacity.',
        tiles: [
          {
            label: 'Commitments',
            value: '$119B',
            note: '$95B in FY27',
            trend: 'flat',
          },
          { label: 'Foundries', value: 'TSMC + Samsung', trend: 'flat' },
          { label: 'Packaging', value: 'CoWoS', trend: 'down' },
        ],
        subcategories: [
          {
            name: 'Foundries',
            detail:
              'TSMC is the primary source, with Samsung named as a qualified second',
            tags: ['single source', 'foundry'],
          },
          {
            name: 'CoWoS packaging',
            detail:
              'The confirmed advanced-packaging technology and the industry’s tightest bottleneck',
            tags: ['bottleneck'],
          },
          {
            name: 'HBM memory',
            detail: 'SK Hynix, Micron and Samsung are all qualified suppliers',
            tags: ['components'],
          },
          {
            name: 'Assembly & test',
            detail: 'Foxconn, Wistron and Fabrinet build the final systems',
            tags: ['assembly'],
          },
          {
            name: 'Locked capacity',
            detail:
              '$119B of supply commitments with $95B payable inside FY2027; inventory up to $25.8B',
            tags: ['committed spend'],
          },
          {
            name: 'Lead times',
            detail:
              'Over 12 months, with premiums and deposits paid to secure capacity',
            tags: ['constraint'],
            trend: 'down',
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
