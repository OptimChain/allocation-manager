/**
 * Twelve Data grants streaming entitlement per symbol. The socket opens and
 * stays healthy while rejecting most symbols, so connection status alone can't
 * tell a caller whether a symbol will ever tick — that only shows up in the
 * `subscribe-status` frame. These tests pin that parsing down, because getting
 * it wrong silently pins the un-entitled symbols to the previous daily close.
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useTwelveDataLivePrices } from './useTwelveDataLivePrices';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = 3;
  }

  // ---- test helpers ----
  open() {
    this.readyState = FakeWebSocket.OPEN;
    act(() => this.onopen?.());
  }

  emit(msg: unknown) {
    act(() => this.onmessage?.({ data: JSON.stringify(msg) }));
  }

  get subscribeRequests(): string[][] {
    return this.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.action === 'subscribe')
      .map((m) => m.params.symbols.split(','));
  }
}

const originalWebSocket = global.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  (global as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  (global as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
});

/** The exact frame the live API returns for this account's plan. */
const PARTIAL_ACCEPT = {
  event: 'subscribe-status',
  status: 'warning',
  success: [
    { symbol: 'BTC/USD', exchange: 'Binance', type: 'DIGITAL_CURRENCY' },
    { symbol: 'QQQ', exchange: 'NASDAQ', type: 'EXCHANGE_TRADED_FUND' },
  ],
  fails: [{ symbol: 'NET' }, { symbol: 'AMZN' }, { symbol: 'VOO' }],
};

describe('useTwelveDataLivePrices', () => {
  it('reports only the symbols the server confirmed on a partial accept', async () => {
    const symbols = ['BTC/USD', 'QQQ', 'NET', 'AMZN', 'VOO'];
    const { result } = renderHook(() => useTwelveDataLivePrices(symbols));

    FakeWebSocket.instances[0].open();
    await waitFor(() => expect(result.current.status).toBe('open'));

    FakeWebSocket.instances[0].emit(PARTIAL_ACCEPT);

    await waitFor(() => expect(result.current.streaming).toEqual(['BTC/USD', 'QQQ']));

    // The rejected symbols must not be reported as streaming — that is the
    // signal ComparePage uses to route them to REST polling instead.
    expect(result.current.streaming).not.toContain('NET');
    expect(result.current.streaming).not.toContain('AMZN');
    expect(result.current.streaming).not.toContain('VOO');
  });

  it('stays "open" during a partial accept, so status cannot imply coverage', async () => {
    const { result } = renderHook(() => useTwelveDataLivePrices(['BTC/USD', 'NET']));

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].emit(PARTIAL_ACCEPT);

    await waitFor(() => expect(result.current.streaming.length).toBeGreaterThan(0));
    expect(result.current.status).toBe('open');
  });

  it('records price ticks for streamed symbols', async () => {
    const { result } = renderHook(() => useTwelveDataLivePrices(['BTC/USD']));

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].emit({
      event: 'price',
      symbol: 'BTC/USD',
      timestamp: 1786581300,
      price: 63593.06,
    });

    await waitFor(() =>
      expect(result.current.prices['BTC/USD']).toEqual({
        price: 63593.06,
        timestamp: 1786581300 * 1000,
      }),
    );
  });

  it('drops confirmations when the socket closes so callers fall back to REST', async () => {
    const { result } = renderHook(() => useTwelveDataLivePrices(['BTC/USD', 'QQQ']));

    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.emit(PARTIAL_ACCEPT);
    await waitFor(() => expect(result.current.streaming).toEqual(['BTC/USD', 'QQQ']));

    act(() => ws.onclose?.());

    await waitFor(() => expect(result.current.streaming).toEqual([]));
    expect(result.current.status).toBe('closed');
  });

  it('treats an all-success frame as full coverage', async () => {
    const { result } = renderHook(() => useTwelveDataLivePrices(['BTC/USD']));

    FakeWebSocket.instances[0].open();
    FakeWebSocket.instances[0].emit({
      event: 'subscribe-status',
      status: 'ok',
      success: [{ symbol: 'BTC/USD' }],
      fails: [],
    });

    await waitFor(() => expect(result.current.streaming).toEqual(['BTC/USD']));
  });
});
