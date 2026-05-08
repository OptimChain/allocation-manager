// Twelve Data WebSocket client for real-time price streaming.
// Docs: https://twelvedata.com/docs/websocket/ws-real-time-price
//
// Endpoint:  wss://ws.twelvedata.com/v1/quotes/price?apikey=<KEY>
// Subscribe: { "action": "subscribe", "params": { "symbols": "AAPL,MSFT" } }
// Event:     { "event": "price", "symbol": "AAPL", "price": 175.43, "timestamp": ... }

const WS_URL = 'wss://ws.twelvedata.com/v1/quotes/price';

export interface PriceEvent {
  event: 'price';
  symbol: string;
  currency?: string;
  exchange?: string;
  type?: string;
  timestamp: number; // unix seconds
  price: number;
  bid?: number;
  ask?: number;
  day_volume?: number;
}

export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export type PriceListener = (event: PriceEvent) => void;
export type StatusListener = (status: WsStatus, info?: string) => void;

export class TwelveDataSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<PriceListener>();
  private statusListeners = new Set<StatusListener>();
  private subscribed = new Set<string>();
  private apiKey: string;
  private status: WsStatus = 'idle';
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manualClose = false;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  getSubscribed(): string[] {
    return Array.from(this.subscribed);
  }

  onPrice(listener: PriceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  connect(): void {
    if (this.ws && (this.status === 'open' || this.status === 'connecting')) return;
    this.manualClose = false;
    this.setStatus('connecting');

    const url = `${WS_URL}?apikey=${encodeURIComponent(this.apiKey)}`;
    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      this.setStatus('error', (err as Error).message);
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      // Resubscribe to any symbols requested before the socket opened.
      if (this.subscribed.size > 0) {
        this.sendSubscribe(Array.from(this.subscribed));
      }
      this.startHeartbeat();
    };

    this.ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.event === 'price' && typeof data.price !== 'undefined') {
          const evt: PriceEvent = {
            event: 'price',
            symbol: data.symbol,
            currency: data.currency,
            exchange: data.exchange,
            type: data.type,
            timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now() / 1000,
            price: typeof data.price === 'number' ? data.price : parseFloat(data.price),
            bid: data.bid !== undefined ? parseFloat(data.bid) : undefined,
            ask: data.ask !== undefined ? parseFloat(data.ask) : undefined,
            day_volume: data.day_volume !== undefined ? parseFloat(data.day_volume) : undefined,
          };
          this.listeners.forEach((l) => l(evt));
        } else if (data.event === 'subscribe-status' && data.status === 'error') {
          this.setStatus('error', data.message || 'subscribe error');
        }
      } catch {
        // ignore non-JSON heartbeats
      }
    };

    this.ws.onerror = () => {
      this.setStatus('error', 'socket error');
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.setStatus('closed');
      if (!this.manualClose) this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.manualClose = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus('closed');
  }

  subscribe(symbols: string[]): void {
    const fresh = symbols.filter((s) => !this.subscribed.has(s));
    fresh.forEach((s) => this.subscribed.add(s));
    if (fresh.length && this.status === 'open') this.sendSubscribe(fresh);
  }

  unsubscribe(symbols: string[]): void {
    const drop = symbols.filter((s) => this.subscribed.has(s));
    drop.forEach((s) => this.subscribed.delete(s));
    if (drop.length && this.ws && this.status === 'open') {
      this.ws.send(
        JSON.stringify({
          action: 'unsubscribe',
          params: { symbols: drop.join(',') },
        }),
      );
    }
  }

  setSymbols(symbols: string[]): void {
    const next = new Set(symbols);
    const toDrop = Array.from(this.subscribed).filter((s) => !next.has(s));
    const toAdd = symbols.filter((s) => !this.subscribed.has(s));
    if (toDrop.length) this.unsubscribe(toDrop);
    if (toAdd.length) this.subscribe(toAdd);
  }

  private sendSubscribe(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        action: 'subscribe',
        params: { symbols: symbols.join(',') },
      }),
    );
  }

  private setStatus(status: WsStatus, info?: string): void {
    this.status = status;
    this.statusListeners.forEach((l) => l(status, info));
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Twelve Data accepts a keep-alive `heartbeat` action; send every 10s.
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'heartbeat' }));
      }
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    const delay = Math.min(30_000, 1_000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}

let singleton: TwelveDataSocket | null = null;

export function getTwelveDataSocket(): TwelveDataSocket {
  if (!singleton) {
    const key = import.meta.env.VITE_TWELVE_DATA_API_KEY;
    if (!key) throw new Error('VITE_TWELVE_DATA_API_KEY environment variable is not set');
    singleton = new TwelveDataSocket(key);
  }
  return singleton;
}
