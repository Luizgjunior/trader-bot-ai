import { store } from '../../../lib/store';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const secret = process.env.DASHBOARD_SECRET;
  const auth = req.headers.get('authorization');
  if (!auth || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const event = await req.json();
  const { type } = event;

  switch (type) {
    case 'heartbeat':
      store.set('status', { online: true, ...event, ts: Date.now() });
      break;

    case 'analysis':
      store.lpush('analyses', JSON.stringify(event));
      store.ltrim('analyses', 49);
      break;

    case 'trade_open':
      store.hset(event.tradeId, JSON.stringify(event));
      break;

    case 'trade_close':
      store.hdel(event.tradeId);
      store.lpush('closedTrades', JSON.stringify(event));
      store.ltrim('closedTrades', 199);
      break;

    case 'balance':
      store.set('balance', JSON.stringify(event));
      break;

    default:
      return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
