import { store } from '../../../lib/store';
import { NextResponse } from 'next/server';

function calcEquity(closedTrades: Array<{ pnl: number }>): Array<{ index: number; equity: number }> {
  let acc = 0;
  return closedTrades.map((t, i) => {
    acc += t.pnl ?? 0;
    return { index: i + 1, equity: parseFloat(acc.toFixed(2)) };
  });
}

export async function GET() {
  const statusRaw = store.get('status');
  const analysesRaw = store.get('analyses') as string[];
  const openTradesHash = store.get('openTrades') as Record<string, string>;
  const closedRaw = store.get('closedTrades') as string[];
  const balanceRaw = store.get('balance') as string | null;

  const openTrades = Object.values(openTradesHash ?? {}).map(v => JSON.parse(v));
  const closedTrades = (closedRaw ?? []).map(v => JSON.parse(v));
  const parsedAnalyses = (analysesRaw ?? []).map(v => JSON.parse(v));
  const equity = calcEquity(closedTrades);

  return NextResponse.json({
    status: statusRaw ?? null,
    analyses: parsedAnalyses,
    openTrades,
    closedTrades,
    balance: balanceRaw ? JSON.parse(balanceRaw as string) : null,
    equity,
  });
}
