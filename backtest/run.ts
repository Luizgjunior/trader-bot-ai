import 'dotenv/config';
import { initDb, getDb } from '../src/database/db';
import { buildContext } from '../src/ai/contextBuilder';
import { askClaude } from '../src/ai/claude';
import { parseClaudeResponse } from '../src/ai/parser';

interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

async function runBacktest(): Promise<void> {
  initDb();
  const db = getDb();

  const candles = db.prepare(`
    SELECT * FROM candles ORDER BY timestamp ASC
  `).all() as Array<{ timestamp: number; close: number }>;

  console.log(`[Backtest] Running on ${candles.length} historical candles...`);

  const results: BacktestResult = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnl: 0,
  };

  // Simulate: every 50 candles, ask Claude for a decision
  for (let i = 50; i < candles.length; i += 15) {
    try {
      const context = await buildContext();
      const rawResponse = await askClaude(context);
      const decision = parseClaudeResponse(rawResponse);

      if (decision.action === 'HOLD' || decision.confidence < 0.7) continue;

      const entryPrice = candles[i].close;
      const futureCandle = candles[Math.min(i + 15, candles.length - 1)];
      const exitPrice = futureCandle.close;

      let pnl = 0;
      if (decision.action === 'BUY') {
        pnl = exitPrice - entryPrice;
      } else {
        pnl = entryPrice - exitPrice;
      }

      results.totalTrades++;
      results.totalPnl += pnl;
      if (pnl > 0) results.wins++;
      else results.losses++;

      console.log(`Trade ${results.totalTrades}: ${decision.action} @ ${entryPrice} → ${exitPrice} (PnL: ${pnl.toFixed(2)})`);
    } catch (err) {
      console.error('[Backtest] Error at candle', i, ':', (err as Error).message);
    }
  }

  results.winRate = results.totalTrades > 0
    ? (results.wins / results.totalTrades) * 100
    : 0;

  console.log('\n=== BACKTEST RESULTS ===');
  console.log(`Total trades: ${results.totalTrades}`);
  console.log(`Wins: ${results.wins} | Losses: ${results.losses}`);
  console.log(`Win rate: ${results.winRate.toFixed(1)}%`);
  console.log(`Total PnL: ${results.totalPnl.toFixed(2)} USDT`);
}

runBacktest().catch(console.error);
