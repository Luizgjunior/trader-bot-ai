/**
 * test-cycle.ts — simula um ciclo completo sem esperar candle M15 fechar
 * Uso: npx tsx test-cycle.ts
 */
import 'dotenv/config';
import { initDb } from './src/database/db';
import { fetchAndLoadHistoricalCandles, isStoreReady } from './src/core/candleStore';
import { buildContext } from './src/ai/contextBuilder';
import { askClaude } from './src/ai/claude';
import { parseClaudeResponse } from './src/ai/parser';

const PAIR    = process.env.TRADING_PAIR ?? 'BTCUSDT';
const TESTNET = process.env.BYBIT_TESTNET === 'true';

async function run() {
  console.log('=== TEST CYCLE ===');
  console.log(`Pair: ${PAIR} | Testnet: ${TESTNET}`);

  initDb();

  console.log('\n[1/5] Carregando candles históricos...');
  await fetchAndLoadHistoricalCandles(PAIR, TESTNET);

  if (!isStoreReady(50)) {
    console.error('[ERRO] Não há candles suficientes no store (min 50)');
    process.exit(1);
  }
  console.log('[1/5] OK — candles prontos');

  console.log('\n[2/5] Construindo contexto MTF...');
  const context = await buildContext();
  console.log(`[2/5] OK — currentPrice: ${context.currentPrice}`);
  console.log(`       M15: ${context.m15.ema_trend} | H1: ${context.h1.ema_trend} | H4: ${context.h4.ema_trend}`);
  console.log(`       Alignment: ${context.timeframe_alignment}`);
  console.log(`       Balance: $${context.balance}`);
  console.log(`       Position: ${context.position ? JSON.stringify(context.position) : 'nenhuma'}`);

  const tokenEstimate = Math.round(JSON.stringify(context).length / 4);
  console.log(`\n       Contexto: ${JSON.stringify(context).length} chars (~${tokenEstimate} tokens)`);

  console.log('\n[3/5] Chamando Claude (Haiku)...');
  const t0 = Date.now();
  const rawResponse = await askClaude(context);
  const elapsed = Date.now() - t0;
  console.log(`[3/5] OK — resposta em ${elapsed}ms`);
  console.log(`       Raw: ${rawResponse}`);

  console.log('\n[4/5] Parseando decisão...');
  const decision = parseClaudeResponse(rawResponse);
  console.log('[4/5] OK — decisão válida');

  console.log('\n=== DECISÃO FINAL ===');
  console.log(`  Ação:       ${decision.action}`);
  console.log(`  Confiança:  ${(decision.confidence * 100).toFixed(0)}%`);
  console.log(`  Stop Loss:  ${decision.stopLoss ?? 'N/A'}`);
  console.log(`  Take Profit:${decision.takeProfit ?? 'N/A'}`);
  console.log(`  Motivo:     ${decision.reasoning}`);
  console.log('====================\n');

  console.log('[5/5] Ciclo completo sem erros.');
}

run().catch((err) => {
  console.error('\n[ERRO FATAL]', err.message ?? err);
  process.exit(1);
});
