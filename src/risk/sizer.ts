import type { ClaudeDecision } from '../ai/parser';
import { getDailyPnl } from '../database/db';

const MIN_CONFIDENCE = 0.70;

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export function checkRisk(decision: ClaudeDecision): RiskCheckResult {
  if (decision.action === 'HOLD') {
    return { allowed: false, reason: 'HOLD signal' };
  }

  if (decision.confidence < MIN_CONFIDENCE) {
    return {
      allowed: false,
      reason: `Confidence ${(decision.confidence * 100).toFixed(0)}% below minimum ${MIN_CONFIDENCE * 100}%`,
    };
  }

  const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT ?? '0.02');
  const dailyPnl = getDailyPnl();

  if (dailyPnl < -dailyLossLimit) {
    return {
      allowed: false,
      reason: `Daily loss limit reached (PnL: ${(dailyPnl * 100).toFixed(2)}%)`,
    };
  }

  return { allowed: true };
}

export function calculatePositionSize(
  balance: number,
  stopLoss: number,
  currentPrice: number
): number {
  const maxRisk = parseFloat(process.env.MAX_RISK_PER_TRADE ?? '0.01');
  const riskAmount = balance * maxRisk;
  const stopDistance = Math.abs(currentPrice - stopLoss);

  if (stopDistance === 0) return 0;

  const qty = riskAmount / stopDistance;
  const minQty = parseFloat(process.env.MIN_QTY ?? '0.001');
  const maxQty = parseFloat(process.env.MAX_QTY ?? '10');
  return parseFloat(Math.min(Math.max(qty, minQty), maxQty).toFixed(3));
}

export interface SLTPResult {
  stopLoss: number;
  takeProfit: number;
}

export function calculateSLTP(
  action: 'BUY' | 'SELL',
  currentPrice: number,
  atr: number
): SLTPResult {
  const atrMultiplier = parseFloat(process.env.ATR_SL_MULTIPLIER ?? '1.5');
  const rrRatio = parseFloat(process.env.RR_RATIO ?? '2.0');

  const slDistance = atr * atrMultiplier;
  const tpDistance = slDistance * rrRatio;

  if (action === 'BUY') {
    return {
      stopLoss: parseFloat((currentPrice - slDistance).toFixed(2)),
      takeProfit: parseFloat((currentPrice + tpDistance).toFixed(2)),
    };
  } else {
    return {
      stopLoss: parseFloat((currentPrice + slDistance).toFixed(2)),
      takeProfit: parseFloat((currentPrice - tpDistance).toFixed(2)),
    };
  }
}

export function validatePositionSize(qty: number): { valid: boolean; reason?: string } {
  const minQty = parseFloat(process.env.MIN_QTY ?? '0.001');
  const maxQty = parseFloat(process.env.MAX_QTY ?? '10');

  if (qty < minQty) return { valid: false, reason: `Qty ${qty} below minimum ${minQty}` };
  if (qty > maxQty) return { valid: false, reason: `Qty ${qty} above maximum ${maxQty}` };
  return { valid: true };
}
