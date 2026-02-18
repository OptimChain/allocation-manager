// Robinhood API Service
// Connects to Netlify functions for Robinhood data

const API_BASE = '/.netlify/functions';

// Auth types
export interface AuthStatus {
  authenticated: boolean;
  message: string;
  expiresAt?: string;
  expiresIn?: number;
  hasRefreshToken?: boolean;
  updatedAt?: string;
  error?: string;
  pendingVerification?: {
    type: 'mfa' | 'device';
    elapsedSeconds: number;
  };
}

export interface AuthResult {
  authenticated: boolean;
  message: string;
  requiresVerification?: boolean;
  requiresMFA?: boolean;
  verificationType?: 'device' | 'mfa';
  challengeType?: string;
  error?: string;
}

export interface Position {
  symbol: string;
  name: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  totalCost: number;
  currentValue: number;
  gain: number;
  gainPercent: number;
}

export interface Portfolio {
  accountNumber: string;
  buyingPower: number;
  cash: number;
  portfolioValue: number;
  extendedHoursValue: number;
  totalGain: number;
  positions: Position[];
}

export interface Order {
  id: string;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  type: string;
  quantity: number;
  price: number;
  state: string;
  createdAt: string;
  updatedAt: string;
}

export interface SymbolPnL {
  symbol: string;
  name: string;
  realizedPnL: number;
  totalBought: number;
  totalSold: number;
  buyCount: number;
  sellCount: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  remainingShares: number;
  remainingCostBasis: number;
}

export interface FilledOrder {
  id: string;
  symbol: string;
  name: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  total: number;
  createdAt: string;
}

export interface OrderPnL {
  totalRealizedPnL: number;
  totalBuyVolume: number;
  totalSellVolume: number;
  symbols: SymbolPnL[];
  orders: FilledOrder[];
}

// Order Book Snapshot types (from 5thstreetcapital blob store)
export interface SnapshotPosition {
  symbol: string;
  quantity: number;
  avg_buy_price: number;
  current_price: number;
  equity: number;
  profit_loss: number;
  profit_loss_pct: number;
}

export interface SnapshotOrder {
  order_id: string;
  symbol: string;
  side: string;
  order_type: string;
  trigger: string;
  state: string;
  quantity: number;
  limit_price: number;
  stop_price: number | null;
  created_at: string;
  updated_at: string;
}

export interface SymbolMarketData {
  metrics: {
    intraday_volatility: number;
    intraday_high: number;
    intraday_low: number;
    current_price: number;
    '30d_high': number;
    '30d_low': number;
  };
  orders: {
    active_buy: unknown;
    active_sell: unknown;
    order_history: unknown[];
  };
  last_signal: {
    signal: string;
    timestamp: string;
  };
  last_updated: string;
}

export interface MarketData {
  timestamp: string;
  symbols: Record<string, SymbolMarketData>;
}

export interface OrderBookSnapshot {
  timestamp: string;
  order_book: SnapshotOrder[];
  portfolio: {
    cash: {
      cash: number;
      cash_available_for_withdrawal: number;
      buying_power: number;
      tradeable_cash: number;
    };
    equity: number;
    market_value: number;
    positions: SnapshotPosition[];
    open_orders: SnapshotOrder[];
  };
  market_data: MarketData | null;
}

export interface BotAction {
  id: string;
  timestamp: string;
  type: string;
  status: string;
  symbol?: string;
  quantity?: number;
  price?: number;
  total?: number;
  message?: string;
  details?: string;
  dryRun?: boolean;
}

export interface BotStatus {
  status: string;
  actionsCount: number;
  lastAction: BotAction | null;
}

export interface BotAnalysis {
  timestamp: string;
  buyingPower: number;
  suggestions: Array<{
    type: string;
    symbol: string;
    reason: string;
    priority: string;
  }>;
  holdings: Array<{
    symbol: string;
    quantity: number;
    averageCost: number;
    currentPrice: number;
    gainPercent: number;
    value: number;
  }>;
}

export interface Quote {
  symbol: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  previousClose: number;
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

// Portfolio functions
export async function getPortfolio(): Promise<Portfolio> {
  return fetchApi<Portfolio>('/robinhood-portfolio?action=portfolio');
}

export async function getOrders(): Promise<Order[]> {
  return fetchApi<Order[]>('/robinhood-portfolio?action=orders');
}

export async function getOrderPnL(): Promise<OrderPnL> {
  return fetchApi<OrderPnL>('/robinhood-portfolio?action=pnl');
}

// Order Book Snapshot
export async function getOrderBookSnapshot(): Promise<OrderBookSnapshot> {
  return fetchApi<OrderBookSnapshot>('/order-book-snapshot');
}

export function sendSlackAlert(message: string, error?: string) {
  fetch(`${API_BASE}/alert-slack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, error, source: 'Trade Page' }),
  }).catch(() => {}); // fire-and-forget
}

// Bot functions
export async function getBotStatus(): Promise<BotStatus> {
  return fetchApi<BotStatus>('/robinhood-bot?action=status');
}

export async function getBotActions(limit: number = 50): Promise<{ actions: BotAction[]; total: number }> {
  return fetchApi<{ actions: BotAction[]; total: number }>(`/robinhood-bot?action=actions&limit=${limit}`);
}

export async function analyzePortfolio(): Promise<BotAnalysis> {
  return fetchApi<BotAnalysis>('/robinhood-bot?action=analyze');
}

export async function getQuote(symbol: string): Promise<Quote> {
  return fetchApi<Quote>(`/robinhood-bot?action=quote&symbol=${encodeURIComponent(symbol)}`);
}

export async function placeOrder(
  symbol: string,
  side: 'buy' | 'sell',
  quantity: number,
  dryRun: boolean = true
): Promise<{ status: string; message?: string; orderId?: string }> {
  return fetchApi('/robinhood-bot?action=order', {
    method: 'POST',
    body: JSON.stringify({ symbol, side, quantity, dryRun }),
  });
}

// Format currency
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// Format percentage
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// Get color class based on value
export function getGainColor(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-600';
}

// Get background color class based on value
export function getGainBgColor(value: number): string {
  if (value > 0) return 'bg-green-100';
  if (value < 0) return 'bg-red-100';
  return 'bg-gray-100';
}

// Auth functions
export async function getAuthStatus(): Promise<AuthStatus> {
  return fetchApi<AuthStatus>('/robinhood-auth?action=status');
}

export async function connectRobinhood(): Promise<AuthResult> {
  return fetchApi<AuthResult>('/robinhood-auth?action=connect');
}

export async function checkVerification(): Promise<AuthResult & { status?: string; elapsedSeconds?: number }> {
  return fetchApi<AuthResult & { status?: string; elapsedSeconds?: number }>('/robinhood-auth?action=verify');
}

export async function submitMFA(code: string): Promise<AuthResult> {
  return fetchApi<AuthResult>(`/robinhood-auth?action=mfa&code=${encodeURIComponent(code)}`);
}

export async function disconnectRobinhood(): Promise<AuthResult> {
  return fetchApi<AuthResult>('/robinhood-auth?action=disconnect');
}
