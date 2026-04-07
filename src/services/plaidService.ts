// Plaid Service
// Frontend service layer for Plaid Link integration

import type { Portfolio } from './robinhoodService';

const API_BASE = '/.netlify/functions';

export interface PlaidAuthStatus {
  connected: boolean;
  itemId?: string;
  institutionName?: string;
  message: string;
}

export interface LinkTokenResponse {
  linkToken: string;
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

export async function createLinkToken(): Promise<LinkTokenResponse> {
  return fetchApi<LinkTokenResponse>('/plaid-link?action=create-link-token');
}

export async function exchangePublicToken(publicToken: string): Promise<PlaidAuthStatus> {
  return fetchApi<PlaidAuthStatus>('/plaid-link?action=exchange-token', {
    method: 'POST',
    body: JSON.stringify({ publicToken }),
  });
}

export async function getPlaidStatus(): Promise<PlaidAuthStatus> {
  return fetchApi<PlaidAuthStatus>('/plaid-link?action=status');
}

export async function getPlaidPortfolio(): Promise<Portfolio> {
  return fetchApi<Portfolio>('/plaid-link?action=holdings');
}

export async function disconnectPlaid(): Promise<{ message: string }> {
  return fetchApi<{ message: string }>('/plaid-link?action=disconnect', {
    method: 'POST',
  });
}
