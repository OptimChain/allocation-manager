/**
 * The no-API-key branch, in its own file so `config/api` can be mocked at
 * module scope — mocking it inside the main suite would need resetModules,
 * which loads a second React copy and breaks the testing-library renderer.
 */

jest.mock('../config/api', () => ({
  API_BASE: '/.netlify/functions',
  TWELVE_DATA_WS_KEY: undefined,
}));

import { renderHook } from '@testing-library/react';
import { useTwelveDataLivePrices } from './useTwelveDataLivePrices';

describe('useTwelveDataLivePrices without an API key', () => {
  it('goes to error with nothing streaming and never opens a socket', () => {
    const ctor = jest.fn();
    const original = global.WebSocket;
    (global as unknown as { WebSocket: unknown }).WebSocket = ctor;

    try {
      const { result } = renderHook(() => useTwelveDataLivePrices(['BTC/USD']));

      expect(result.current.status).toBe('error');
      // Empty `streaming` is what routes every symbol to the REST fallback.
      expect(result.current.streaming).toEqual([]);
      expect(ctor).not.toHaveBeenCalled();
    } finally {
      (global as unknown as { WebSocket: unknown }).WebSocket = original;
    }
  });
});
