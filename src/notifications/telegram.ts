import TelegramBot from 'node-telegram-bot-api';
import type { TradingContext } from '../ai/contextBuilder';
import type { ClaudeDecision } from '../ai/parser';
import type { ExecutionResult } from '../broker/orderManager';
import type { OpenPaperTrade } from '../database/db';
import { getDailyStats } from '../database/db';

let bot: TelegramBot | null = null;

function getBot(): TelegramBot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;

  if (!bot) {
    bot = new TelegramBot(token, { polling: false });
  }
  return bot;
}

export async function sendTelegram(message: string): Promise<void> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const instance = getBot();

  if (!instance || !chatId) {
    console.log(`[Telegram] (not configured) ${message}`);
    return;
  }

  try {
    await instance.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch {
    // Retry without markdown in case of formatting errors
    try {
      await instance.sendMessage(chatId, message);
    } catch (err2) {
      console.error('[Telegram] Failed to send message:', (err2 as Error).message);
    }
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function trendEmoji(trend: string): string {
  if (trend === 'bullish') return '🟢';
  if (trend === 'bearish') return '🔴';
  return '🟡';
}

function fmtPrice(price: number): string {
  return `$${price.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function duration(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}min`;
}

// ── Funções de formatação exportadas ─────────────────────────────────────────

/**
 * Evento 1 — Análise Claude (todo ciclo onde Claude foi consultado)
 */
export function formatAnalise(
  decision: ClaudeDecision,
  context: TradingContext,
  pair: string,
): string {
  const acaoEmoji = decision.action === 'BUY' ? '📈' : decision.action === 'SELL' ? '📉' : '⏸';
  const acaoPt = decision.action === 'BUY' ? 'COMPRA' : decision.action === 'SELL' ? 'VENDA' : 'AGUARDAR';
  const conf = `${(decision.confidence * 100).toFixed(0)}%`;
  const mtfLine = `M15: ${trendEmoji(context.m15.ema_trend)} | H1: ${trendEmoji(context.h1.ema_trend)} | H4: ${trendEmoji(context.h4.ema_trend)}`;
  return (
    `${acaoEmoji} *Análise ${pair}* — ${acaoPt}\n` +
    `${mtfLine}\n` +
    `ADX: ${context.h4.adx.toFixed(1)} | Vol: ${context.m15.volume_vs_avg}\n` +
    `Confiança: ${conf} | Preço: ${fmtPrice(context.currentPrice)}\n` +
    `Motivo: ${decision.reasoning}`
  );
}

/**
 * Evento 2 — Entrada executada (BUY ou SELL)
 */
export function formatEntrada(
  decision: ClaudeDecision,
  context: TradingContext,
  result: ExecutionResult,
  pair: string,
  testnet: boolean,
): string {
  const modo = testnet ? '🧪 PAPER' : '💰 REAL';
  const acaoEmoji = decision.action === 'BUY' ? '📈' : '📉';
  const acaoPt = decision.action === 'BUY' ? 'COMPRA' : 'VENDA';
  const mtfLine = `M15: ${trendEmoji(context.m15.ema_trend)} | H1: ${trendEmoji(context.h1.ema_trend)} | H4: ${trendEmoji(context.h4.ema_trend)}`;
  const asset = pair.replace('USDT', '');
  const sizeStr = result.size !== undefined ? `\nTamanho: ${result.size} ${asset}` : '';
  return (
    `${acaoEmoji} *${acaoPt} ${pair}* ${modo}\n` +
    `${mtfLine}\n` +
    `Confiança: ${(decision.confidence * 100).toFixed(0)}%\n` +
    `Entrada: ${fmtPrice(context.currentPrice)}\n` +
    `Stop Loss: ${fmtPrice(result.stopLoss ?? 0)}\n` +
    `Take Profit: ${fmtPrice(result.takeProfit ?? 0)}` +
    sizeStr + `\n` +
    `Motivo: ${decision.reasoning}`
  );
}

/**
 * Evento 3 — Fechamento de posição (TP ou SL atingido)
 */
/**
 * Evento 0 — Resumo consolidado multi-par (uma mensagem por ciclo M15)
 */
export function formatResumoMultiPar(
  resultados: Array<{
    pair: string;
    action: string;
    confidence: number;
    reasoning: string;
    blocked?: string;
  }>
): string {
  const linhas = resultados.map(r => {
    const emoji = r.action === 'BUY' ? '📈' : r.action === 'SELL' ? '📉' : '⏸';
    const conf = r.action !== 'HOLD' && !r.blocked
      ? ` ${(r.confidence * 100).toFixed(0)}%`
      : '';
    const motivo = r.blocked ?? (r.action === 'HOLD' ? 'aguardando setup' : r.reasoning);
    return `${emoji} *${r.pair}*${conf} — ${motivo}`;
  });
  const timestamp = new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const legenda =
    `\n\n_📖 Legenda:_\n` +
    `_⏸ = sem entrada no momento_\n` +
    `_mixed MTF = tendências divergentes entre M15/H1/H4_\n` +
    `_volume baixo = liquidez insuficiente para entrar_\n` +
    `_risco: HOLD = sinal fraco ou mercado instável_\n` +
    `_📈/📉 = ordem executada (compra/venda)_`;
  return `🕐 *Análise ${timestamp}*\n\n` + linhas.join('\n') + legenda;
}

export function formatFechamento(
  trade: OpenPaperTrade,
  exitPrice: number,
  pnl: number,
  isTP: boolean,
  pair: string,
  testnet: boolean,
): string {
  const modo = testnet ? '🧪 PAPER' : '💰 REAL';
  const icone = isTP ? '✅ *Take Profit atingido*' : '❌ *Stop Loss atingido*';
  const acaoEmoji = trade.action === 'BUY' ? '📈' : '📉';
  const acaoPt = trade.action === 'BUY' ? 'COMPRA' : 'VENDA';
  const entry = trade.entry_price ?? exitPrice;
  const pnlSign = pnl >= 0 ? '+' : '';
  const pnlPctVal = entry > 0 && trade.size > 0 ? (pnl / (entry * trade.size)) * 100 : 0;
  const dur = duration(trade.created_at);
  const stats = getDailyStats();
  const lossCount = stats.tradeCount - stats.winCount;
  const dayPnlSign = stats.pnl >= 0 ? '+' : '';
  return (
    `${icone} ${modo}\n` +
    `${acaoEmoji} ${acaoPt} ${pair} encerrada\n` +
    `Entrada: ${fmtPrice(entry)} → Saída: ${fmtPrice(exitPrice)}\n` +
    `Duração: ${dur}\n` +
    `PnL: ${pnlSign}${pnl.toFixed(2)} USDT (${fmtPct(pnlPctVal)})\n` +
    `Trades hoje: ${stats.winCount}W / ${lossCount}L | PnL dia: ${dayPnlSign}${stats.pnl.toFixed(2)} USDT`
  );
}
