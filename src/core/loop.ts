import 'dotenv/config';
import { connectWebSocket } from './websocket';
import { PAIRS, fetchAndLoadHistoricalCandles, isStoreReady } from './candleStore';
import { initDb, getSetting, setSetting, getOpenPaperTrades, closePaperTrade, getDailyStats } from '../database/db';
import { buildContext, type TradingContext } from '../ai/contextBuilder';
import { askClaude } from '../ai/claude';
import { parseClaudeResponse } from '../ai/parser';
import { checkRisk } from '../risk/sizer';
import { checkTrailingStop } from '../risk/trailingStop';
import { executeDecision } from '../broker/orderManager';
import { sendTelegram, formatAnalise, formatEntrada, formatFechamento } from '../notifications/telegram';

const TESTNET = process.env.BYBIT_TESTNET === 'true';

// Blocked hours (UTC) — low-liquidity periods to avoid trading
// Format: comma-separated hours e.g. "0,1,2,3,4" or leave empty to disable
const BLOCKED_HOURS_RAW = process.env.BLOCKED_HOURS ?? '';
const BLOCKED_HOURS: Set<number> = BLOCKED_HOURS_RAW
  ? new Set(BLOCKED_HOURS_RAW.split(',').map(h => parseInt(h.trim(), 10)))
  : new Set();

// ── Proteção de créditos ────────────────────────────────────────────────────
const HOLD_CIRCUIT_THRESHOLD = 3;   // HOLDs consecutivos para acionar o circuito
const HOLD_CIRCUIT_SKIP = 4;        // candles M15 a pular após o circuito (= 1h)

interface PairState {
  isProcessing: boolean;
  consecutiveHolds: number;
  candleCount: number;
  skipUntilCandle: number;
}

const pairState = new Map<string, PairState>();

function getState(pair: string): PairState {
  if (!pairState.has(pair)) {
    pairState.set(pair, { isProcessing: false, consecutiveHolds: 0, candleCount: 0, skipUntilCandle: 0 });
  }
  return pairState.get(pair)!;
}
// ───────────────────────────────────────────────────────────────────────────


async function checkPaperClosures(pair: string, currentPrice: number): Promise<void> {
  const open = getOpenPaperTrades(pair);
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

    const icone = hitTP ? '✅ TP' : '🛑 SL';
    await sendTelegram(formatFechamento(trade, exitPrice, pnl, hitTP, pair, TESTNET));
    console.log(`[Paper] ${pair} Trade #${trade.id} fechado — ${icone} | PnL: ${pnl.toFixed(4)}`);
  }
}

async function onCandleClose(pair: string): Promise<void> {
  const state = getState(pair);

  if (state.isProcessing) return;
  if (!isStoreReady(50, pair)) {
    console.log(`[Loop] ${pair} Aguardando 50 candles...`);
    return;
  }

  state.candleCount++;

  // ── Circuit breaker: pausa após N HOLDs consecutivos ──────────────────
  if (state.candleCount < state.skipUntilCandle) {
    const restantes = state.skipUntilCandle - state.candleCount;
    console.log(`[Loop] ${pair} Circuito aberto — pulando Claude (${restantes} candle(s) restante(s))`);
    return;
  }

  state.isProcessing = true;

  try {
    const context = await buildContext(pair);

    await maybeSendDailySummary(context);
    await maybeAlertInactivity();

    // ── Monitoramento de posições abertas (roda todo ciclo) ──────────────
    await checkPaperClosures(pair, context.currentPrice);
    for (const trade of getOpenPaperTrades(pair)) {
      const update = checkTrailingStop(trade, context.currentPrice);
      if (update) {
        console.log(`[Trailing] ${pair} Trade #${trade.id} — ${update}`);
        const acaoPt = trade.action === 'BUY' ? 'COMPRA' : 'VENDA';
        await sendTelegram(`🔄 *Trailing Stop* ${pair} #${trade.id} (${acaoPt})\n${update}`);
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
      state.consecutiveHolds++;
      _checkCircuit(pair, state);
      return;
    }

    if (context.h4.ema_trend === 'neutral') {
      logCycle(context, 'cancelado (H4 neutro)');
      state.consecutiveHolds++;
      _checkCircuit(pair, state);
      return;
    }

    // ── Filtro ADX: evita mercados laterais ──────────────────────────────
    if (context.h4.adx_strength === 'no_trend') {
      logCycle(context, `cancelado (ADX fraco ${context.h4.adx.toFixed(1)})`);
      state.consecutiveHolds++;
      _checkCircuit(pair, state);
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

    console.log(`[Loop] ${pair} Decisão Claude: ${decision.action} (confiança: ${decision.confidence})`);
    await sendTelegram(formatAnalise(decision, context, pair));

    if (decision.action === 'HOLD') {
      state.consecutiveHolds++;
      _checkCircuit(pair, state);
    } else {
      state.consecutiveHolds = 0;
    }

    const riskCheck = await checkRisk(decision);

    if (!riskCheck.allowed) {
      console.warn(`[Loop] ${pair} Operação bloqueada pelo gerenciador de risco: ${riskCheck.reason}`);
      return;
    }

    const result = await executeDecision(decision, context);

    if (result.executed) {
      setSetting('last_activity_ts', String(Date.now()));
      await sendTelegram(formatEntrada(decision, context, result, pair, TESTNET));
    }
  } catch (err) {
    console.error(`[Loop] ${pair} Erro no ciclo:`, err);
    await sendTelegram(`⚠️ Erro no bot (${pair}): ${(err as Error).message}`);
  } finally {
    state.isProcessing = false;
  }
}

function _checkCircuit(pair: string, state: PairState): void {
  if (state.consecutiveHolds >= HOLD_CIRCUIT_THRESHOLD) {
    state.skipUntilCandle = state.candleCount + HOLD_CIRCUIT_SKIP;
    state.consecutiveHolds = 0;
    const msg = `⏸ *Circuit breaker ativado* (${pair}) — ${HOLD_CIRCUIT_THRESHOLD} HOLDs seguidos\nClaude pausado por ${HOLD_CIRCUIT_SKIP} candles M15 (~${HOLD_CIRCUIT_SKIP * 15}min)`;
    console.log(`[Loop] ${pair} ${HOLD_CIRCUIT_THRESHOLD} HOLDs seguidos — pausando Claude por ${HOLD_CIRCUIT_SKIP} candles M15 (~${HOLD_CIRCUIT_SKIP * 15}min)`);
    sendTelegram(msg).catch(() => {});
  }
}

function nowUTC(): string {
  const d = new Date();
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

function logCycle(context: TradingContext, outcome: string): void {
  const mtf = context.timeframe_alignment === 'mixed' ? 'mixed' : context.timeframe_alignment;
  console.log(`[Loop] ${nowUTC()} UTC | ${context.pair} | MTF: ${mtf} | ADX: ${context.h4.adx.toFixed(1)} | Vol: ${context.m15.volume_vs_avg} | → ${outcome}`);
}

async function maybeAlertInactivity(): Promise<void> {
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  const lastTs = getSetting('last_activity_ts');
  if (!lastTs) return;
  if (Date.now() - Number(lastTs) < TWENTY_FOUR_HOURS) return;
  setSetting('last_activity_ts', String(Date.now()));
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
  console.log(`Pares: ${PAIRS.join(', ')} | Timeframes: M15, H1, H4 | Testnet: ${TESTNET}`);

  initDb();

  const openAtStart = getOpenPaperTrades();
  if (openAtStart.length > 0) {
    console.log(`[Loop] Posições paper anteriores detectadas — monitorando SL/TP (${openAtStart.length} trade(s) aberto(s))`);
  }

  for (const pair of PAIRS) {
    await fetchAndLoadHistoricalCandles(pair, TESTNET);
  }

  const FIVE_MINUTES = 5 * 60 * 1000;
  const lastStarted = getSetting('last_started_ts');
  const now = Date.now();

  if (!getSetting('last_activity_ts')) {
    setSetting('last_activity_ts', String(now));
  }
  if (!lastStarted || now - Number(lastStarted) > FIVE_MINUTES) {
    setSetting('last_started_ts', String(now));
    const modo = TESTNET ? '🧪 Testnet (paper)' : '💰 Mainnet (real)';
    await sendTelegram(
      `🤖 *tradebot-ai iniciado*\n` +
      `Pares: ${PAIRS.join(', ')}\n` +
      `TF: M15/H1/H4 | Modo: ${modo}\n` +
      `Proteção: pré-filtro MTF + ADX + volume + circuit breaker ativo`
    );
  } else {
    console.log('[Loop] Notificação de início suprimida (enviada há menos de 5min)');
  }

  connectWebSocket(PAIRS, TESTNET, onCandleClose);
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
