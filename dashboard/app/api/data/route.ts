import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { NextResponse } from 'next/server';

const DB_PATH = path.join(process.cwd(), '..', 'data', 'tradebot.db');

function calcEquity(trades: Array<{ pnl: number }>) {
  let acc = 0;
  return trades.map((t, i) => {
    acc += t.pnl ?? 0;
    return { index: i + 1, equity: parseFloat(acc.toFixed(2)) };
  });
}

export async function GET() {
  if (!fs.existsSync(DB_PATH)) {
    return NextResponse.json({ error: 'Database not found' }, { status: 503 });
  }

  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');

  const closedTrades = db.prepare(`
    SELECT id, created_at, action, size, entry_price, stop_loss, take_profit, confidence, reasoning, pnl, paper
    FROM trades WHERE pnl IS NOT NULL ORDER BY id ASC
  `).all();

  const openTrades = db.prepare(`
    SELECT id, created_at, action, size, entry_price, stop_loss, take_profit, confidence, reasoning, paper
    FROM trades WHERE pnl IS NULL ORDER BY id DESC
  `).all();

  const lastSetting = db.prepare(`SELECT value FROM settings WHERE key = 'last_started_ts'`).get() as { value: string } | undefined;
  const online = lastSetting ? Date.now() - Number(lastSetting.value) < 5 * 60 * 1000 : false;

  const pairSetting = db.prepare(`SELECT value FROM settings WHERE key = 'pair'`).get() as { value: string } | undefined;

  db.close();

  return NextResponse.json({
    status: { online, pair: pairSetting?.value ?? 'BTCUSDT', mode: 'PAPER' },
    openTrades,
    closedTrades,
    equity: calcEquity(closedTrades as Array<{ pnl: number }>),
  });
}
