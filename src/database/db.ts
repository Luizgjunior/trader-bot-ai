// Uses Node.js built-in SQLite (available since Node 22, stable in Node 22 LTS)
// No external dependency or native compilation required.
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'tradebot.db');

let db: DatabaseSync | null = null;

export function initDb(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new DatabaseSync(DB_PATH);

  // WAL mode: allows concurrent reads+writes without locking errors
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA busy_timeout=3000;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      timestamp INTEGER PRIMARY KEY,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      action TEXT NOT NULL,
      size REAL NOT NULL,
      stop_loss REAL NOT NULL,
      take_profit REAL NOT NULL,
      confidence REAL NOT NULL,
      reasoning TEXT,
      paper INTEGER NOT NULL DEFAULT 1,
      order_id TEXT,
      pnl REAL,
      entry_price REAL
    );
  `);

  // Migration: adiciona entry_price em DBs antigos que não tinham a coluna
  try { db.exec('ALTER TABLE trades ADD COLUMN entry_price REAL'); } catch {}

  console.log(`[DB] Initialized at ${DB_PATH}`);
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized — call initDb() first');
  return db;
}

export interface TradeRecord {
  action: string;
  size: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasoning: string;
  paper: boolean;
  orderId?: string;
  pnl?: number;
  entryPrice?: number;
}

export function saveTradeRecord(trade: TradeRecord): void {
  getDb().prepare(`
    INSERT INTO trades (action, size, stop_loss, take_profit, confidence, reasoning, paper, order_id, pnl, entry_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trade.action, trade.size, trade.stopLoss, trade.takeProfit,
    trade.confidence, trade.reasoning, trade.paper ? 1 : 0,
    trade.orderId ?? null, trade.pnl ?? null, trade.entryPrice ?? null
  );
}

export function getRecentTrades(limit = 5): TradeRecord[] {
  return getDb().prepare(`
    SELECT action, size, stop_loss as stopLoss, take_profit as takeProfit,
           confidence, reasoning, paper, order_id as orderId, pnl
    FROM trades ORDER BY id DESC LIMIT ?
  `).all(limit) as unknown as TradeRecord[];
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as unknown as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export interface OpenPaperTrade {
  id: number;
  action: string;
  size: number;
  stop_loss: number;
  take_profit: number;
  entry_price: number | null;
  created_at: string;
}

export function getOpenPaperTrades(): OpenPaperTrade[] {
  return getDb().prepare(`
    SELECT id, action, size, stop_loss, take_profit, entry_price, created_at
    FROM trades WHERE paper = 1 AND pnl IS NULL
  `).all() as unknown as OpenPaperTrade[];
}

export function closePaperTrade(id: number, pnl: number): void {
  getDb().prepare(`UPDATE trades SET pnl = ? WHERE id = ?`).run(pnl, id);
}

export function getDailyPnl(): number {
  const row = getDb().prepare(`
    SELECT COALESCE(SUM(pnl), 0) as total
    FROM trades
    WHERE date(created_at) = date('now') AND pnl IS NOT NULL
  `).get() as unknown as { total: number };
  return row.total;
}

export interface DailyStats {
  tradeCount: number;
  winCount: number;
  winRate: number;
  pnl: number;
}

export function getDailyStats(): DailyStats {
  const row = getDb().prepare(`
    SELECT
      COUNT(*) as tradeCount,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as winCount,
      COALESCE(SUM(pnl), 0) as pnl
    FROM trades
    WHERE date(created_at) = date('now') AND pnl IS NOT NULL
  `).get() as unknown as { tradeCount: number; winCount: number | null; pnl: number };

  const tradeCount = row.tradeCount;
  const winCount = row.winCount ?? 0;
  const winRate = tradeCount > 0 ? winCount / tradeCount : 0;
  return { tradeCount, winCount, winRate, pnl: row.pnl };
}
