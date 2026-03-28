import { kv } from '@vercel/kv';
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
      await kv.set('bot:status', { online: true, ...event, ts: Date.now() }, { ex: 600 });
      break;

    case 'analysis':
      await kv.lpush('bot:analyses', JSON.stringify(event));
      await kv.ltrim('bot:analyses', 0, 49);
      break;

    case 'trade_open':
      await kv.hset('bot:open_trades', { [event.tradeId]: JSON.stringify(event) });
      break;

    case 'trade_close':
      await kv.hdel('bot:open_trades', event.tradeId);
      await kv.lpush('bot:closed_trades', JSON.stringify(event));
      await kv.ltrim('bot:closed_trades', 0, 199);
      break;

    case 'balance':
      await kv.set('bot:balance', JSON.stringify(event));
      break;

    default:
      return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
