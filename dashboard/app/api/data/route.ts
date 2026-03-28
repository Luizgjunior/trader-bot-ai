import { kv } from '@vercel/kv';
import { NextResponse } from 'next/server';

function calcEquity(closedTrades: Array<{ pnl: number }>): Array<{ index: number; equity: number }> {
  let acc = 0;
  return closedTrades.map((t, i) => {
    acc += t.pnl ?? 0;
    return { index: i + 1, equity: parseFloat(acc.toFixed(2)) };
  });
}

export async function GET() {
  const [status, analyses, openTradesHash, closedRaw, balanceRaw] = await Promise.all([
    kv.get('bot:status'),
    kv.lrange('bot:analyses', 0, 9),
    kv.hgetall('bot:open_trades'),
    kv.lrange('bot:closed_trades', 0, 199),
    kv.get('bot:balance'),
  ]);

  const openTrades = openTradesHash
    ? Object.values(openTradesHash).map(v => JSON.parse(v as string))
    : [];

  const closedTrades = (closedRaw as string[]).map(v => JSON.parse(v)).reverse();

  const parsedAnalyses = (analyses as string[]).map(v => JSON.parse(v));

  const equity = calcEquity(closedTrades);

  return NextResponse.json({
    status,
    analyses: parsedAnalyses,
    openTrades,
    closedTrades,
    balance: balanceRaw ? JSON.parse(balanceRaw as string) : null,
    equity,
  });
}
