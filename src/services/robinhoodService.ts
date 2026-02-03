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

export async function importToken(accessToken: string, refreshToken?: string): Promise<AuthResult> {
  return fetchApi<AuthResult>('/robinhood-auth?action=import', {
    method: 'POST',
    body: JSON.stringify({ accessToken, refreshToken }),
  });
}

export interface TokenData {
  hasToken: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  expired?: boolean;
  error?: string;
}

export async function getStoredToken(): Promise<TokenData> {
  return fetchApi<TokenData>('/robinhood-auth?action=gettoken');
}
