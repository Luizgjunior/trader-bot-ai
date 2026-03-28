import { redis } from '../../../lib/redis';
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
      await redis.set('bot:status', JSON.stringify({ online: true, ...event, ts: Date.now() }), 'EX', 600);
      break;

    case 'analysis':
      await redis.lpush('bot:analyses', JSON.stringify(event));
      await redis.ltrim('bot:analyses', 0, 49);
      break;

    case 'trade_open':
      await redis.hset('bot:open_trades', event.tradeId, JSON.stringify(event));
      break;

    case 'trade_close':
      await redis.hdel('bot:open_trades', event.tradeId);
      await redis.lpush('bot:closed_trades', JSON.stringify(event));
      await redis.ltrim('bot:closed_trades', 0, 199);
      break;

    case 'balance':
      await redis.set('bot:balance', JSON.stringify(event));
      break;

    default:
      return NextResponse.json({ error: 'Unknown event type' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
