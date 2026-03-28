import 'dotenv/config';
import { connectWebSocket } from './websocket';
import { fetchAndLoadHistoricalCandles, isStoreReady } from './candleStore';
import { initDb, getSetting, setSetting, getOpenPaperTrades, closePaperTrade, getDailyStats } from '../database/db';
import { buildContext, type TradingContext } from '../ai/contextBuilder';
import { askClaude } from '../ai/claude';
import { parseClaudeResponse } from '../ai/parser';
import { checkRisk } from '../risk/sizer';
import { checkTrailingStop } from '../risk/trailingStop';
import { executeDecision } from '../broker/orderManager';
import { sendTelegram, formatAnalise, formatEntrada, formatFechamento } from '../notifications/telegram';
import { getBalance } from '../broker/bybit';

const PAIR = process.env.TRADING_PAIR ?? 'BTCUSDT';
const TESTNET = process.env.BYBIT_TESTNET === 'true';

// Blocked hours (UTC) — low-liquidity periods to avoid trading
// Format: comma-separated hours e.g. "0,1,2,3,4" or leave empty to disable
const BLOCKED_HOURS_RAW = process.env.BLOCKED_HOURS ?? '';
const BLOCKED_HOURS: Set<number> = BLOCKED_HOURS_RAW
  ? new Set(BLOCKED_HOURS_RAW.split(',').map(h => parseInt(h.trim(), 10)))
  : new Set();

// ── Proteção de créditos ────────────────────────────────────────────────────
// Evita chamar a API Claude desnecessariamente
const HOLD_CIRCUIT_THRESHOLD = 3;   // HOLDs consecutivos para acionar o circuito
const HOLD_CIRCUIT_SKIP = 4;        // candles M15 a pular após o circuito (= 1h)

let isProcessing = false;
let consecutiveHolds = 0;
let candleCount = 0;
let skipUntilCandle = 0;
// ───────────────────────────────────────────────────────────────────────────


async function checkPaperClosures(currentPrice: number): Promise<void> {
  const open = getOpenPaperTrades();
  for (const trade of open) {
    const isBuy = trade.action === 'BUY';
    const hitTP = isBuy ? currentPrice >= trade.take_profit : currentPrice <= trade.take_profit;
    const hitSL = isBuy ? currentPrice <= trade.stop_loss  : currentPrice >= trade.stop_loss;

    if (!hitTP && !hitSL) continue;

    const exitPrice = hitTP ? trade.take_profit : trade.stop_loss;
    const entry = trade.entry_price ?? exitPrice;
    const pnl = isBuy
      ? (exitPrice - entry) * trade.size
      : (entry - exitPrice) * trade.size;

    closePaperTrade(trade.id, pnl);

    const durationMs = Date.now() - new Date(trade.created_at).getTime();
    const durMin = Math.round(durationMs / 60_000);
    const durStr = durMin < 60 ? `${durMin}min` : `${Math.floor(durMin / 60)}h${durMin % 60 > 0 ? (durMin % 60) + 'min' : ''}`;
    const icone = hitTP ? '✅ TP' : '🛑 SL';
    await sendTelegram(formatFechamento(trade, exitPrice, pnl, hitTP, PAIR, TESTNET));
    console.log(`[Paper] Trade #${trade.id} fechado — ${icone} | PnL: ${pnl.toFixed(4)}`);
  }
}

async function onCandleClose(): Promise<void> {
  if (isProcessing) return;
  if (!isStoreReady(50)) {
    console.log('[Loop] Aguardando 50 candles...');
    return;
  }

  candleCount++;

  // ── Circuit breaker: pausa após N HOLDs consecutivos ──────────────────
  if (candleCount < skipUntilCandle) {
    const restantes = skipUntilCandle - candleCount;
    console.log(`[Loop] Circuito aberto — pulando Claude (${restantes} candle(s) restante(s))`);
    return;
  }

  isProcessing = true;

  try {
    const context = await buildContext();

    await maybeSendDailySummary(context);
    await maybeAlertInactivity();

    // ── Monitoramento de posições abertas (roda todo ciclo) ──────────────
    await checkPaperClosures(context.currentPrice);
    for (const trade of getOpenPaperTrades()) {
      const update = checkTrailingStop(trade, context.currentPrice);
      if (update) {
        console.log(`[Trailing] Trade #${trade.id} — ${update}`);
        const acaoPt = trade.action === 'BUY' ? 'COMPRA' : 'VENDA';
        await sendTelegram(`🔄 *Trailing Stop* #${trade.id} (${acaoPt})\n${update}`);
      }
    }

    // ── Filtro: hora bloqueada (baixa liquidez) ──────────────────────────
    if (BLOCKED_HOURS.has(context.hour)) {
      logCycle(context, `bloqueado (${context.hour}h UTC)`);
      return;
    }

    // ── Pré-filtro: timeframes desalinhados ──────────────────────────────
    if (context.timeframe_alignment === 'mixed') {
      logCycle(context, 'cancelado (mixed)');
      consecutiveHolds++;
      _checkCircuit();
      return;
    }

    if (context.h4.ema_trend === 'neutral') {
      logCycle(context, 'cancelado (H4 neutro)');
      consecutiveHolds++;
      _checkCircuit();
      return;
    }

    // ── Filtro ADX: evita mercados laterais ──────────────────────────────
    if (context.h4.adx_strength === 'no_trend') {
      logCycle(context, `cancelado (ADX fraco ${context.h4.adx.toFixed(1)})`);
      consecutiveHolds++;
      _checkCircuit();
      return;
    }

    // ── Filtro Volume: evita candles sem liquidez ─────────────────────────
    if (context.m15.volume_vs_avg === 'low') {
      logCycle(context, 'aguardando liquidez');
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    logCycle(context, 'Claude chamado');

    const rawResponse = await askClaude(context);
    const decision = parseClaudeResponse(rawResponse);

    console.log(`[Loop] Decisão Claude: ${decision.action} (confiança: ${decision.confidence})`);
    await sendTelegram(formatAnalise(decision, context, PAIR));

    if (decision.action === 'HOLD') {
      consecutiveHolds++;
      _checkCircuit();
    } else {
      consecutiveHolds = 0;
    }

    const riskCheck = await checkRisk(decision);

    if (!riskCheck.allowed) {
      console.warn(`[Loop] Operação bloqueada pelo gerenciador de risco: ${riskCheck.reason}`);
      return;
    }

    const result = await executeDecision(decision, context);

    if (result.executed) {
      setSetting('last_activity_ts', String(Date.now()));
      await sendTelegram(formatEntrada(decision, context, result, PAIR, TESTNET));
    }
  } catch (err) {
    console.error('[Loop] Erro no ciclo:', err);
    await sendTelegram(`⚠️ Erro no bot: ${(err as Error).message}`);
  } finally {
    isProcessing = false;
  }
}

function _checkCircuit(): void {
  if (consecutiveHolds >= HOLD_CIRCUIT_THRESHOLD) {
    skipUntilCandle = candleCount + HOLD_CIRCUIT_SKIP;
    consecutiveHolds = 0;
    const msg = `⏸ *Circuit breaker ativado* — ${HOLD_CIRCUIT_THRESHOLD} HOLDs seguidos\nClaude pausado por ${HOLD_CIRCUIT_SKIP} candles M15 (~${HOLD_CIRCUIT_SKIP * 15}min)`;
    console.log(`[Loop] ${HOLD_CIRCUIT_THRESHOLD} HOLDs seguidos — pausando Claude por ${HOLD_CIRCUIT_SKIP} candles M15 (~${HOLD_CIRCUIT_SKIP * 15}min)`);
    sendTelegram(msg).catch(() => {});
  }
}

function nowUTC(): string {
  const d = new Date();
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function logCycle(context: TradingContext, outcome: string): void {
  const mtf = context.timeframe_alignment === 'mixed' ? 'mixed' : context.timeframe_alignment;
  console.log(`[Loop] ${nowUTC()} UTC | MTF: ${mtf} | ADX: ${context.h4.adx.toFixed(1)} | Vol: ${context.m15.volume_vs_avg} | → ${outcome}`);
}

async function maybeAlertInactivity(): Promise<void> {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const lastTs = getSetting('last_activity_ts');
  if (!lastTs) return;
  if (Date.now() - Number(lastTs) < TWENTY_FOUR_HOURS) return;
  setSetting('last_activity_ts', String(Date.now())); // reset antes de enviar para não repetir
  await sendTelegram(
    '⚠️ Bot ativo há 24h sem trades. Filtros muito restritivos ou mercado lateral prolongado.'
  );
  console.log('[Loop] Alerta inatividade enviado — 24h sem nenhum trade executado');
}

async function maybeSendDailySummary(context: TradingContext): Promise<void> {
  if (context.hour !== 23 || new Date().getUTCMinutes() < 45) return;
  const today = new Date().toISOString().slice(0, 10);
  if (getSetting('last_daily_summary_date') === today) return;
  const stats = getDailyStats();
  setSetting('last_daily_summary_date', today);
  const sign = stats.pnl >= 0 ? '+' : '';
  const wr = stats.tradeCount > 0 ? `${(stats.winRate * 100).toFixed(0)}%` : 'N/A';
  await sendTelegram(
    `📊 *Resumo do dia:* ${stats.tradeCount} trades | Win rate ${wr} | PnL: ${sign}${stats.pnl.toFixed(2)} USDT`
  );
  console.log(`[Loop] Resumo diário enviado — ${stats.tradeCount} trades | Win rate ${wr} | PnL: ${sign}${stats.pnl.toFixed(2)} USDT`);
}

async function main(): Promise<void> {
  console.log('=== tradebot-ai iniciando ===');
  console.log(`Par: ${PAIR} | Timeframes: M15, H1, H4 | Testnet: ${TESTNET}`);

  initDb();

  const openAtStart = getOpenPaperTrades();
  if (openAtStart.length > 0) {
    console.log(`[Loop] Posição paper anterior detectada — monitorando SL/TP (${openAtStart.length} trade(s) aberto(s))`);
  }

  await fetchAndLoadHistoricalCandles(PAIR, TESTNET);

  const FIVE_MINUTES = 5 * 60 * 1000;
  const lastStarted = getSetting('last_started_ts');
  const now = Date.now();

  // Inicializa janela de inatividade na primeira execução
  if (!getSetting('last_activity_ts')) {
    setSetting('last_activity_ts', String(now));
  }
  if (!lastStarted || now - Number(lastStarted) > FIVE_MINUTES) {
    setSetting('last_started_ts', String(now));
    const modo = TESTNET ? '🧪 Testnet (paper)' : '💰 Mainnet (real)';
    await sendTelegram(
      `🤖 *tradebot-ai iniciado*\n` +
      `Par: ${PAIR} | TF: M15/H1/H4\n` +
      `Modo: ${modo}\n` +
      `Proteção: pré-filtro MTF + ADX + volume + circuit breaker ativo`
    );
  } else {
    console.log('[Loop] Notificação de início suprimida (enviada há menos de 5min)');
  }

  connectWebSocket(PAIR, TESTNET, onCandleClose);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
