import { bybit as BybitExchange } from 'ccxt';
import { getDb } from '../database/db';

export const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '15' | '60' | '240';
export const TIMEFRAMES: Timeframe[] = ['15', '60', '240'];
const TF_LABEL: Record<Timeframe, string> = { '15': 'M15', '60': 'H1', '240': 'H4' };

const MAX_CANDLES = 200;

// Chave composta: "BTCUSDT_15", "ETHUSDT_60", etc.
const stores = new Map<string, Candle[]>();

function storeKey(pair: string, tf: Timeframe): string {
  return `${pair}_${tf}`;
}

function getStore(pair: string, tf: Timeframe): Candle[] {
  const k = storeKey(pair, tf);
  if (!stores.has(k)) stores.set(k, []);
  return stores.get(k)!;
}

export function addCandle(candle: Candle, pair: string, tf: Timeframe = '15'): void {
  const store = getStore(pair, tf);
  store.push(candle);
  if (store.length > MAX_CANDLES) store.shift();
  if (tf === '15') persistCandle(candle, pair);
}

export function getCandles(limit = 50, pair: string, tf: Timeframe = '15'): Candle[] {
  return getStore(pair, tf).slice(-limit);
}

export function getLastCandle(pair: string, tf: Timeframe = '15'): Candle | undefined {
  const store = getStore(pair, tf);
  return store[store.length - 1];
}

export function isStoreReady(minCandles = 50, pair: string): boolean {
  return getStore(pair, '15').length >= minCandles;
}

function persistCandle(candle: Candle, pair: string): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO candles (pair, timestamp, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(pair, candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
}

export function loadHistoricalCandles(): void {
  for (const pair of PAIRS) {
    const rows = getDb().prepare(`
      SELECT * FROM candles WHERE pair = ? ORDER BY timestamp DESC LIMIT ?
    `).all(pair, MAX_CANDLES) as unknown as (Candle & { pair: string })[];

    const store = getStore(pair, '15');
    store.push(...rows.map(r => ({
      timestamp: r.timestamp,
      open:      r.open,
      high:      r.high,
      low:       r.low,
      close:     r.close,
      volume:    r.volume,
    })).reverse());

    console.log(`[CandleStore] Loaded ${store.length} M15 candles for ${pair} from DB`);
  }
}

export async function fetchAndLoadHistoricalCandles(
  pair: string,
  testnet: boolean
): Promise<void> {
  console.log(`[CandleStore] Fetching 200 historical candles for ${pair} — M15, H1, H4...`);

  const exchange = new BybitExchange({
    enableRateLimit: true,
    options: { defaultType: 'linear' },
  });
  if (testnet) exchange.setSandboxMode(true);

  const symbol = `${pair.slice(0, -4)}/${pair.slice(-4)}:USDT`;

  for (const tf of TIMEFRAMES) {
    const ccxtTf = tf === '15' ? '15m' : tf === '60' ? '1h' : '4h';
    const ohlcv = await exchange.fetchOHLCV(symbol, ccxtTf, undefined, 200);

    const store = getStore(pair, tf);
    store.length = 0;

    for (const bar of ohlcv) {
      const candle: Candle = {
        timestamp: bar[0] as number,
        open:      bar[1] as number,
        high:      bar[2] as number,
        low:       bar[3] as number,
        close:     bar[4] as number,
        volume:    bar[5] as number,
      };

      if (tf === '15') {
        getDb().prepare(`
          INSERT OR REPLACE INTO candles (pair, timestamp, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(pair, candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
      }

      store.push(candle);
    }

    store.sort((a, b) => a.timestamp - b.timestamp);
    while (store.length > MAX_CANDLES) store.shift();

    console.log(`[CandleStore] ${pair} ${TF_LABEL[tf]}: ${store.length} candles loaded`);
  }
}
