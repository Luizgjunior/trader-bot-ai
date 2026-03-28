import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env') });

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
const today = new Date().toISOString().slice(0, 10);
const todayTrades = closedTrades.filter(t => t.created_at.startsWith(today));

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

section('HOJE vs ACUMULADO');
{
  const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const todayWr = calcWinRate(todayTrades);
  const todayW = todayTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const todayL = todayTrades.filter(t => (t.pnl ?? 0) < 0).length;
  console.log(`  Hoje  — Trades: ${String(todayTrades.length).padStart(3)} | Win Rate: ${bar(todayWr, 10)} ${pct(todayWr)} (${todayW}W/${todayL}L) | PnL: ${usd(todayPnl)}`);
  console.log(`  Total — Trades: ${String(closedTrades.length).padStart(3)} | Win Rate: ${bar(winRate, 10)} ${pct(winRate)} (${closedTrades.filter(t => (t.pnl ?? 0) > 0).length}W/${closedTrades.filter(t => (t.pnl ?? 0) < 0).length}L) | PnL: ${usd(totalPnl)}`);
}

section('MELHOR E PIOR TRADE');
{
  const best = closedTrades.reduce((a, b) => (b.pnl ?? 0) > (a.pnl ?? 0) ? b : a);
  const worst = closedTrades.reduce((a, b) => (b.pnl ?? 0) < (a.pnl ?? 0) ? b : a);
  const fmt = (t: TradeRow) => {
    const entry = t.entry_price ? `$${t.entry_price.toFixed(2)}` : 'N/A';
    const date = t.created_at.slice(0, 16).replace('T', ' ');
    return `${date} | ${t.action} | Entry: ${entry} | PnL: ${usd(t.pnl ?? 0)} | conf: ${(t.confidence * 100).toFixed(0)}%`;
  };
  console.log(`  🏆 Melhor: ${fmt(best)}`);
  console.log(`  💀 Pior  : ${fmt(worst)}`);
}

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

section('ÚLTIMAS 10 OPERAÇÕES');
{
  const hdr = [
    'Data/Hora'.padEnd(16),
    'Ação'.padEnd(4),
    'Entry'.padStart(10),
    'SL'.padStart(10),
    'TP'.padStart(10),
    'PnL'.padStart(12),
    'Resultado',
  ].join('  ');
  console.log(`  ${hdr}`);
  console.log('  ' + '─'.repeat(hdr.length));
  const last10 = closedTrades.slice(-10).reverse();
  for (const t of last10) {
    const date = t.created_at.slice(0, 16).replace('T', ' ');
    const entry = t.entry_price ? `$${t.entry_price.toFixed(2)}` : 'N/A';
    const sl = `$${t.stop_loss.toFixed(2)}`;
    const tp = `$${t.take_profit.toFixed(2)}`;
    const pnlStr = t.pnl !== null ? usd(t.pnl) : '—';
    const resultado = (t.pnl ?? 0) > 0 ? '✅ WIN' : (t.pnl ?? 0) < 0 ? '❌ LOSS' : '⏸ EMPATE';
    const row = [
      date.padEnd(16),
      t.action.padEnd(4),
      entry.padStart(10),
      sl.padStart(10),
      tp.padStart(10),
      pnlStr.padStart(12),
      resultado,
    ].join('  ');
    console.log(`  ${row}`);
  }
}

console.log('\n' + '─'.repeat(50) + '\n');

// ── Telegram Report ───────────────────────────────────────────────────────────

async function sendReportToTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('[Report] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados — pulando envio.');
    return;
  }

  const mode = trades[0]?.paper ? 'PAPER' : 'LIVE';
  const pair = process.env.TRADING_PAIR ?? 'BTCUSDT';

  const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const losses = closedTrades.filter(t => (t.pnl ?? 0) < 0).length;
  const pfStr = pf === Infinity ? '∞' : pf.toFixed(2);

  const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const todayWr = calcWinRate(todayTrades);
  const todayW = todayTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const todayL = todayTrades.filter(t => (t.pnl ?? 0) < 0).length;

  const tierLines = tiers.map(([lo, hi, label]) => {
    const tier = calcByTier(closedTrades, lo, hi);
    if (tier.count === 0) return `${label}: sem dados`;
    const wr = ((tier.wins / tier.count) * 100).toFixed(1);
    const pnlStr = (tier.pnl >= 0 ? '+' : '') + tier.pnl.toFixed(2);
    return `${label}: ${wr}% WR | ${tier.count} trades | PnL ${pnlStr}`;
  }).join('\n');

  const lastTrade = closedTrades.length > 0 ? closedTrades[closedTrades.length - 1] : null;
  let lastLine = 'Nenhuma operação fechada';
  if (lastTrade) {
    const date = lastTrade.created_at.slice(0, 16).replace('T', ' ');
    const entry = lastTrade.entry_price ? `$${lastTrade.entry_price.toFixed(2)}` : 'N/A';
    const pnlVal = lastTrade.pnl ?? 0;
    const pnlStr = (pnlVal >= 0 ? '+' : '') + pnlVal.toFixed(2) + ' USDT';
    const icon = pnlVal > 0 ? '✅' : pnlVal < 0 ? '❌' : '⏸';
    lastLine = `${date} | ${lastTrade.action} | Entry: ${entry} | PnL: ${pnlStr} ${icon}`;
  }

  const text = [
    `📊 *RELATÓRIO TRADEBOT-AI*`,
    `Par: ${pair} | Modo: ${mode}`,
    ``,
    `*Geral*`,
    `Total trades: ${trades.length} | Fechados: ${closedTrades.length} | Abertos: ${openTrades.length}`,
    `PnL Total: ${(totalPnl >= 0 ? '+' : '') + totalPnl.toFixed(2)} USDT`,
    `Win Rate: ${(winRate * 100).toFixed(1)}% (${wins}W / ${losses}L)`,
    `Profit Factor: ${pfStr}`,
    `Drawdown Máx: ${maxDD.toFixed(2)} USDT`,
    ``,
    `*Hoje*`,
    `Trades: ${todayTrades.length} | Win Rate: ${(todayWr * 100).toFixed(1)}% | PnL: ${(todayPnl >= 0 ? '+' : '') + todayPnl.toFixed(2)} USDT`,
    ``,
    `*Por Confidence*`,
    tierLines,
    ``,
    `*Última operação*`,
    lastLine,
  ].join('\n');

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (res.ok) {
      console.log('[Report] Relatório enviado ao Telegram com sucesso.');
    } else {
      const err = await res.text();
      console.error('[Report] Erro ao enviar Telegram:', err);
    }
  } catch (e) {
    console.error('[Report] Falha na requisição Telegram:', e);
  }
}

sendReportToTelegram();
