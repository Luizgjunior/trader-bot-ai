import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'tradebot.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('Database not found at', DB_PATH);
  console.error('Run the bot first to create it.');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
try { db.exec('ALTER TABLE trades ADD COLUMN entry_price REAL'); } catch {}

interface TradeRow {
  id: number;
  created_at: string;
  action: string;
  size: number;
  stop_loss: number;
  take_profit: number;
  entry_price: number | null;
  confidence: number;
  reasoning: string;
  paper: number;
  order_id: string | null;
  pnl: number | null;
}

const trades = db.prepare(`
  SELECT id, created_at, action, size, stop_loss, take_profit, entry_price,
         confidence, reasoning, paper, order_id, pnl
  FROM trades
  ORDER BY id ASC
`).all() as unknown as TradeRow[];

const closedTrades = trades.filter(t => t.pnl !== null);
const openTrades = trades.filter(t => t.pnl === null);

// ── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function usd(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return sign + n.toFixed(2) + ' USDT';
}

function bar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function section(title: string): void {
  console.log('\n' + '─'.repeat(50));
  console.log(` ${title}`);
  console.log('─'.repeat(50));
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function calcWinRate(rows: TradeRow[]): number {
  if (rows.length === 0) return 0;
  const wins = rows.filter(t => (t.pnl ?? 0) > 0).length;
  return wins / rows.length;
}

function calcProfitFactor(rows: TradeRow[]): number {
  const profits = rows.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0);
  const losses = rows.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0);
  if (losses === 0) return profits > 0 ? Infinity : 0;
  return profits / losses;
}

function calcMaxDrawdown(rows: TradeRow[]): number {
  let peak = 0;
  let equity = 0;
  let maxDD = 0;
  for (const t of rows) {
    equity += t.pnl ?? 0;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calcByTier(rows: TradeRow[], lo: number, hi: number): { count: number; wins: number; pnl: number } {
  const tier = rows.filter(t => t.confidence >= lo && t.confidence < hi);
  return {
    count: tier.length,
    wins: tier.filter(t => (t.pnl ?? 0) > 0).length,
    pnl: tier.reduce((s, t) => s + (t.pnl ?? 0), 0),
  };
}

// ── Output ────────────────────────────────────────────────────────────────────

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║         TRADEBOT-AI — PERFORMANCE REPORT         ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log(`  Gerado em: ${new Date().toLocaleString('pt-BR')}`);
console.log(`  Modo: ${trades[0]?.paper ? 'PAPER TRADING' : 'LIVE'} | DB: ${DB_PATH}`);

section('ENTRADAS ABERTAS (aguardando fechamento)');
if (openTrades.length === 0) {
  console.log('  Nenhuma posição aberta no momento.');
} else {
  for (const t of [...openTrades].reverse()) {
    const tipo = t.action === 'BUY' ? '📈 COMPRA' : '📉 VENDA';
    const conf = (t.confidence * 100).toFixed(0) + '%';
    const date = t.created_at.slice(0, 16).replace('T', ' ');
    const entryStr = t.entry_price ? `$${t.entry_price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : 'N/A';
    console.log(`\n  ${tipo} | Aberta em: ${date} | Confiança: ${conf}`);
    console.log(`  Preço Entrada: ${entryStr}`);
    console.log(`  Stop Loss    : $${t.stop_loss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log(`  Take Profit  : $${t.take_profit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    console.log(`  Tamanho      : ${t.size} BTC`);
    if (t.reasoning) {
      console.log(`  Motivo     : ${t.reasoning.slice(0, 80)}${t.reasoning.length > 80 ? '…' : ''}`);
    }
  }
}

section('RESUMO GERAL');
console.log(`  Total de entradas : ${trades.length}`);
console.log(`  Fechadas (com PnL): ${closedTrades.length}`);
console.log(`  Abertas            : ${openTrades.length}`);

if (closedTrades.length === 0) {
  console.log('\n  Sem trades fechados para analisar métricas ainda.\n');
  process.exit(0);
}

const totalPnl = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
const winRate = calcWinRate(closedTrades);
const pf = calcProfitFactor(closedTrades);
const maxDD = calcMaxDrawdown(closedTrades);
const avgPnl = totalPnl / closedTrades.length;

console.log(`\n  PnL Total       : ${usd(totalPnl)}`);
console.log(`  PnL Médio/Trade : ${usd(avgPnl)}`);
console.log(`  Win Rate        : ${bar(winRate)} ${pct(winRate)} (${closedTrades.filter(t => (t.pnl ?? 0) > 0).length}W / ${closedTrades.filter(t => (t.pnl ?? 0) < 0).length}L)`);
console.log(`  Profit Factor   : ${pf === Infinity ? '∞' : pf.toFixed(2)}`);
console.log(`  Drawdown Máx    : ${usd(maxDD)}`);

section('WIN RATE POR TIPO DE SINAL');
for (const action of ['BUY', 'SELL'] as const) {
  const rows = closedTrades.filter(t => t.action === action);
  if (rows.length === 0) { console.log(`  ${action.padEnd(6)}: sem dados`); continue; }
  const wr = calcWinRate(rows);
  const pnl = rows.reduce((s, t) => s + (t.pnl ?? 0), 0);
  console.log(`  ${action.padEnd(6)}: ${bar(wr, 15)} ${pct(wr)} | ${rows.length} trades | PnL ${usd(pnl)}`);
}

section('PERFORMANCE POR CONFIDENCE TIER');
const tiers: Array<[number, number, string]> = [
  [0.70, 0.80, '0.70–0.79'],
  [0.80, 0.90, '0.80–0.89'],
  [0.90, 1.01, '0.90–1.00'],
];
let hasAnyTier = false;
for (const [lo, hi, label] of tiers) {
  const tier = calcByTier(closedTrades, lo, hi);
  if (tier.count === 0) {
    console.log(`  ${label}: sem dados`);
    continue;
  }
  hasAnyTier = true;
  const wr = tier.wins / tier.count;
  console.log(`  ${label}: ${bar(wr, 12)} ${pct(wr)} | ${tier.count} trades | PnL ${usd(tier.pnl)}`);
}
if (!hasAnyTier) console.log('  Nenhum trade com confiança no intervalo analisado.');

section('ÚLTIMAS 5 OPERAÇÕES');
const last5 = closedTrades.slice(-5).reverse();
for (const t of last5) {
  const pnlStr = t.pnl !== null ? usd(t.pnl) : 'aberto';
  const conf = (t.confidence * 100).toFixed(0) + '%';
  const date = t.created_at.slice(0, 16);
  console.log(`  [${date}] ${t.action.padEnd(4)} conf=${conf} pnl=${pnlStr}`);
  if (t.reasoning) {
    console.log(`            ${t.reasoning.slice(0, 70)}${t.reasoning.length > 70 ? '…' : ''}`);
  }
}

console.log('\n' + '─'.repeat(50) + '\n');
