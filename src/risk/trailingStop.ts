import { getDb } from '../database/db';
import type { OpenPaperTrade } from '../database/db';

function updateStopLoss(id: number, newSL: number): void {
  getDb().prepare('UPDATE trades SET stop_loss = ? WHERE id = ?').run(newSL, id);
}

/**
 * Aplica trailing stop por software a uma posição paper aberta.
 * - Quando preço atinge 50% do caminho ao TP: move SL para breakeven (entry)
 * - Quando preço atinge 75% do caminho ao TP: move SL para 30% do TP
 * O SL só avança na direção favorável (nunca recua).
 * Retorna uma string descritiva se atualizou, null caso contrário.
 */
export function checkTrailingStop(trade: OpenPaperTrade, currentPrice: number): string | null {
  const entry = trade.entry_price;
  if (entry === null) return null;

  const isBuy = trade.action === 'BUY';
  const tpDistance = isBuy
    ? trade.take_profit - entry
    : entry - trade.take_profit;

  if (tpDistance <= 0) return null;

  const progress = isBuy
    ? (currentPrice - entry) / tpDistance
    : (entry - currentPrice) / tpDistance;

  if (progress < 0.50) return null;

  let newSL: number;
  let label: string;

  if (progress >= 0.75) {
    newSL = isBuy
      ? parseFloat((entry + tpDistance * 0.30).toFixed(2))
      : parseFloat((entry - tpDistance * 0.30).toFixed(2));
    label = `trailing 75% → SL 30% TP ($${newSL})`;
  } else {
    newSL = parseFloat(entry.toFixed(2));
    label = `trailing 50% → breakeven ($${newSL})`;
  }

  // SL só avança na direção favorável
  if (isBuy  && newSL <= trade.stop_loss) return null;
  if (!isBuy && newSL >= trade.stop_loss) return null;

  updateStopLoss(trade.id, newSL);
  return label;
}
