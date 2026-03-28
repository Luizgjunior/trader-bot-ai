import 'dotenv/config';
import { connectWebSocket } from './websocket';
import { fetchAndLoadHistoricalCandles, isStoreReady } from './candleStore';
import { initDb, getSetting, setSetting, getOpenPaperTrades, closePaperTrade } from '../database/db';
import { buildContext } from '../ai/contextBuilder';
import { askClaude } from '../ai/claude';
import { parseClaudeResponse } from '../ai/parser';
import { checkRisk } from '../risk/sizer';
import { executeDecision } from '../broker/orderManager';
import { sendTelegram } from '../notifications/telegram';

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

function trendEmoji(trend: string): string {
  if (trend === 'bullish') return '🟢';
  if (trend === 'bearish') return '🔴';
  return '🟡';
}

function actionPtBr(action: string): string {
  if (action === 'BUY')  return 'COMPRA';
  if (action === 'SELL') return 'VENDA';
  return 'AGUARDAR';
}

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

    const icone = hitTP ? '✅ Take Profit' : '🛑 Stop Loss';
    const sinal = pnl >= 0 ? '+' : '';
    await sendTelegram(
      `${icone} atingido 🧪 PAPER\n` +
      `${actionPtBr(trade.action)} encerrada • Preço: $${exitPrice.toLocaleString('pt-BR')}\n` +
      `PnL: ${sinal}${pnl.toFixed(4)} USDT`
    );
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

    // ── Filtro: hora bloqueada (baixa liquidez) ──────────────────────────
    if (BLOCKED_HOURS.has(context.hour)) {
      console.log(`[Loop] Hora ${context.hour}h UTC bloqueada — pulando ciclo`);
      return;
    }

    // ── Pré-filtro: timeframes desalinhados ──────────────────────────────
    if (context.timeframe_alignment === 'mixed') {
      console.log('[Loop] Timeframes desalinhados (mixed) — chamada Claude cancelada');
      consecutiveHolds++;
      _checkCircuit();
      return;
    }

    if (context.h4.ema_trend === 'neutral') {
      console.log('[Loop] H4 neutro — tendência principal indefinida, chamada Claude cancelada');
      consecutiveHolds++;
      _checkCircuit();
      return;
    }

    // ── Filtro ADX: evita mercados laterais ──────────────────────────────
    if (context.h4.adx_strength === 'no_trend') {
      console.log(`[Loop] H4 ADX fraco (${context.h4.adx.toFixed(1)}) — mercado lateral, chamada Claude cancelada`);
      consecutiveHolds++;
      _checkCircuit();
      return;
    }

    // ── Filtro Volume: evita candles sem liquidez ─────────────────────────
    if (context.m15.volume_vs_avg === 'low') {
      console.log('[Loop] Volume M15 baixo — aguardando liquidez');
      return;
    }
    // ────────────────────────────────────────────────────────────────────

    // Verifica se alguma posição paper atingiu SL ou TP
    await checkPaperClosures(context.currentPrice);

    console.log('[Loop] Nova candle fechada — rodando ciclo IA...');

    const rawResponse = await askClaude(context);
    const decision = parseClaudeResponse(rawResponse);

    console.log(`[Loop] Decisão Claude: ${decision.action} (confiança: ${decision.confidence})`);
    console.log(`[Loop] Alinhamento: M15: ${context.m15.ema_trend} | H1: ${context.h1.ema_trend} | H4: ${context.h4.ema_trend}`);

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
      const acao = actionPtBr(decision.action);
      const mtfLine = `M15: ${trendEmoji(context.m15.ema_trend)} | H1: ${trendEmoji(context.h1.ema_trend)} | H4: ${trendEmoji(context.h4.ema_trend)}`;
      const modo = TESTNET ? '🧪 TESTE' : '💰 REAL';
      const msg =
        `✅ *${acao}* ${PAIR} ${modo}\n` +
        `${mtfLine}\n` +
        `Confiança: ${(decision.confidence * 100).toFixed(0)}%\n` +
        `Preço atual: $${context.currentPrice.toLocaleString('pt-BR')}\n` +
        `Stop Loss: $${result.stopLoss?.toLocaleString('pt-BR')}\n` +
        `Take Profit: $${result.takeProfit?.toLocaleString('pt-BR')}\n` +
        `Motivo: ${decision.reasoning}`;
      await sendTelegram(msg);
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
    console.log(`[Loop] ${HOLD_CIRCUIT_THRESHOLD} HOLDs seguidos — pausando Claude por ${HOLD_CIRCUIT_SKIP} candles M15 (~${HOLD_CIRCUIT_SKIP * 15}min)`);
  }
}

async function main(): Promise<void> {
  console.log('=== tradebot-ai iniciando ===');
  console.log(`Par: ${PAIR} | Timeframes: M15, H1, H4 | Testnet: ${TESTNET}`);

  initDb();
  await fetchAndLoadHistoricalCandles(PAIR, TESTNET);

  const FIVE_MINUTES = 5 * 60 * 1000;
  const lastStarted = getSetting('last_started_ts');
  const now = Date.now();
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
