export type DashboardEvent =
  | { type: 'heartbeat'; balance: number; pair: string; mode: string; timestamp: string }
  | { type: 'analysis'; action: string; confidence: number; reasoning: string; context: object; timestamp: string }
  | { type: 'trade_open'; tradeId: string; action: string; entry: number; stopLoss: number; takeProfit: number; size: number; confidence: number; timestamp: string }
  | { type: 'trade_close'; tradeId: string; action: string; entry: number; exit: number; pnl: number; isTP: boolean; duration: string; timestamp: string }
  | { type: 'balance'; usdt: number; timestamp: string };

export function reportToVercel(event: DashboardEvent): void {
  const url = process.env.DASHBOARD_URL;
  const secret = process.env.DASHBOARD_SECRET;
  if (!url) return;

  fetch(`${url}/api/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret ?? ''}`,
    },
    body: JSON.stringify(event),
  }).catch(console.error);
}
