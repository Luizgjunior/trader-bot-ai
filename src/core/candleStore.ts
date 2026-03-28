import { bybit as BybitExchange } from 'ccxt';
import { getDb } from '../database/db';

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
const stores = new Map<Timeframe, Candle[]>([
  ['15', []],
  ['60', []],
  ['240', []],
]);

export function addCandle(candle: Candle, tf: Timeframe = '15'): void {
  const store = stores.get(tf)!;
  store.push(candle);
  if (store.length > MAX_CANDLES) store.shift();
  if (tf === '15') persistCandle(candle); // only persist M15 to DB
}

export function getCandles(limit = 50, tf: Timeframe = '15'): Candle[] {
  return stores.get(tf)!.slice(-limit);
}

export function getLastCandle(tf: Timeframe = '15'): Candle | undefined {
  const store = stores.get(tf)!;
  return store[store.length - 1];
}

export function isStoreReady(minCandles = 50): boolean {
  return stores.get('15')!.length >= minCandles;
}

function persistCandle(candle: Candle): void {
  getDb().prepare(`
    INSERT OR REPLACE INTO candles (timestamp, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
}

export function loadHistoricalCandles(): void {
  const rows = getDb().prepare(`
    SELECT * FROM candles ORDER BY timestamp DESC LIMIT ?
  `).all(MAX_CANDLES) as unknown as Candle[];

  stores.get('15')!.push(...rows.reverse());
  console.log(`[CandleStore] Loaded ${stores.get('15')!.length} M15 candles from DB`);
}

export async function fetchAndLoadHistoricalCandles(
  pair: string,
  testnet: boolean
): Promise<void> {
  console.log('[CandleStore] Fetching 200 historical candles for M15, H1, H4...');

  const exchange = new BybitExchange({
    enableRateLimit: true,
    options: { defaultType: 'linear' },
  });
  if (testnet) exchange.setSandboxMode(true);

  const symbol = `${pair.slice(0, -4)}/${pair.slice(-4)}:USDT`;

  for (const tf of TIMEFRAMES) {
    const ccxtTf = tf === '15' ? '15m' : tf === '60' ? '1h' : '4h';
    const ohlcv = await exchange.fetchOHLCV(symbol, ccxtTf, undefined, 200);

    const store = stores.get(tf)!;
    store.length = 0; // clear before refill

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
          INSERT OR REPLACE INTO candles (timestamp, open, high, low, close, volume)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(candle.timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
      }

      store.push(candle);
    }

    store.sort((a, b) => a.timestamp - b.timestamp);
    while (store.length > MAX_CANDLES) store.shift();

    console.log(`[CandleStore] ${TF_LABEL[tf]}: ${store.length} candles loaded`);
  }
}
