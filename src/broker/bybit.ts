import { bybit as BybitExchange, type Position as CcxtPosition } from 'ccxt';

let exchange: BybitExchange | null = null;

function getExchange(): BybitExchange {
  if (exchange) return exchange;

  const testnet = process.env.BYBIT_TESTNET === 'true';

  exchange = new BybitExchange({
    apiKey: process.env.BYBIT_API_KEY,
    secret: process.env.BYBIT_API_SECRET,
    enableRateLimit: true,
    options: {
      defaultType: 'linear',
    },
  });

  if (testnet) {
    exchange.setSandboxMode(true);
  }

  return exchange;
}

export async function getBalance(): Promise<number> {
  if (process.env.PAPER_TRADING === 'true') return 10000;

  const ex = getExchange();
  const balance = await ex.fetchBalance();
  return balance['USDT']?.free ?? 0;
}

export interface Position {
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
}

export async function getCurrentPosition(): Promise<Position | null> {
  if (process.env.PAPER_TRADING === 'true') return null;

  const ex = getExchange();
  const pair = process.env.TRADING_PAIR ?? 'BTCUSDT';
  const symbol = `${pair.slice(0, -4)}/${pair.slice(-4)}:USDT`;

  const positions = await ex.fetchPositions([symbol]);
  const open = positions.find((p: CcxtPosition) => p.contracts && Number(p.contracts) > 0);

  if (!open) return null;

  return {
    side: open.side as 'long' | 'short',
    size: Number(open.contracts),
    entryPrice: Number(open.entryPrice),
    unrealizedPnl: Number(open.unrealizedPnl),
  };
}

export async function placeMarketOrder(
  side: 'buy' | 'sell',
  qty: number,
  stopLoss: number,
  takeProfit: number
): Promise<string> {
  const ex = getExchange();
  const pair = process.env.TRADING_PAIR ?? 'BTCUSDT';
  const symbol = `${pair.slice(0, -4)}/${pair.slice(-4)}:USDT`;

  const order = await ex.createOrder(symbol, 'market', side, qty, undefined, {
    stopLoss: { triggerPrice: stopLoss },
    takeProfit: { triggerPrice: takeProfit },
  });

  return order.id;
}

export async function closePosition(): Promise<void> {
  const ex = getExchange();
  const pair = process.env.TRADING_PAIR ?? 'BTCUSDT';
  const symbol = `${pair.slice(0, -4)}/${pair.slice(-4)}:USDT`;

  const positions = await ex.fetchPositions([symbol]);
  const open = positions.find((p: CcxtPosition) => p.contracts && Number(p.contracts) > 0);
  if (!open) return;

  const closeSide = open.side === 'long' ? 'sell' : 'buy';
  await ex.createOrder(symbol, 'market', closeSide, Number(open.contracts), undefined, {
    reduceOnly: true,
  });
}
