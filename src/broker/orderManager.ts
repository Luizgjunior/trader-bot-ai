import type { ClaudeDecision } from '../ai/parser';
import type { TradingContext } from '../ai/contextBuilder';
import { getCurrentPosition, placeMarketOrder, getBalance } from './bybit';
import { calculatePositionSize, calculateSLTP, validatePositionSize } from '../risk/sizer';
import { saveTradeRecord } from '../database/db';

export interface ExecutionResult {
  executed: boolean;
  reason?: string;
  orderId?: string;
  stopLoss?: number;
  takeProfit?: number;
  size?: number;
}

export async function executeDecision(decision: ClaudeDecision, context: TradingContext): Promise<ExecutionResult> {
  const paperMode = process.env.PAPER_TRADING === 'true';

  if (decision.action === 'HOLD') {
    return { executed: false, reason: 'HOLD signal' };
  }

  const position = await getCurrentPosition();

  if (position) {
    const sideMatch =
      (decision.action === 'BUY' && position.side === 'long') ||
      (decision.action === 'SELL' && position.side === 'short');

    if (sideMatch) {
      return { executed: false, reason: 'Position already open in same direction' };
    }
  }

  const { stopLoss, takeProfit } = calculateSLTP(
    decision.action as 'BUY' | 'SELL',
    context.currentPrice,
    context.m15.atr
  );

  // Sanity check: SL must be on the correct side of current price
  if (decision.action === 'BUY' && stopLoss >= context.currentPrice) {
    return { executed: false, reason: `Invalid SL for BUY: ${stopLoss} >= price ${context.currentPrice}` };
  }
  if (decision.action === 'SELL' && stopLoss <= context.currentPrice) {
    return { executed: false, reason: `Invalid SL for SELL: ${stopLoss} <= price ${context.currentPrice}` };
  }

  const balance = await getBalance();
  const size = calculatePositionSize(balance, stopLoss, context.currentPrice);

  const qtyCheck = validatePositionSize(size);
  if (!qtyCheck.valid) {
    return { executed: false, reason: qtyCheck.reason };
  }

  console.log(`[OrderManager] ${paperMode ? '[PAPER]' : '[LIVE]'} ${decision.action} qty=${size} SL=${stopLoss} TP=${takeProfit}`);

  if (paperMode) {
    saveTradeRecord({
      pair: context.pair,
      action: decision.action,
      size,
      stopLoss,
      takeProfit,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      paper: true,
      entryPrice: context.currentPrice,
    });
    return { executed: true, orderId: `PAPER-${Date.now()}`, stopLoss, takeProfit, size };
  }

  const orderId = await placeMarketOrder(
    decision.action.toLowerCase() as 'buy' | 'sell',
    size,
    stopLoss,
    takeProfit
  );

  saveTradeRecord({
    pair: context.pair,
    action: decision.action,
    size,
    stopLoss,
    takeProfit,
    confidence: decision.confidence,
    reasoning: decision.reasoning,
    paper: false,
    orderId,
  });

  return { executed: true, orderId, stopLoss, takeProfit, size };
}
