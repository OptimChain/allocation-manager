// Plaid Service
// Frontend service layer for Plaid Link integration

import { apiJson } from './http';

export interface PlaidAuthStatus {
  connected: boolean;
  itemId?: string;
  institutionName?: string;
  message: string;
}

export interface LinkTokenResponse {
  linkToken: string;
}

const fetchApi = apiJson;

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

export async function disconnectPlaid(): Promise<{ message: string }> {
  return fetchApi<{ message: string }>('/plaid-link?action=disconnect', {
    method: 'POST',
  });
}
