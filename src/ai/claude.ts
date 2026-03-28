import Anthropic from '@anthropic-ai/sdk';
import type { TradingContext } from './contextBuilder';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `Expert crypto trader. Analyze M15/H1/H4 semantic signals and return ONE valid JSON — no markdown, no text outside JSON.
Format: {"action":"BUY"|"SELL"|"HOLD","confidence":<0.0-1.0>,"reasoning":"<1-2 frases em português do Brasil>"}
MANDATORY: reasoning always in Brazilian Portuguese (pt-BR).
MTF rules: BUY only if H4+H1 ema_trend bullish. SELL only if H4+H1 ema_trend bearish. HOLD if timeframe_alignment mixed. +0.10 bonus when M15+H1+H4 all aligned.
Entry quality: no BUY if rsi_zone overbought; no SELL if rsi_zone oversold. Prefer macd_state confirming trend. Higher confidence if adx_strength strong_trend/moderate_trend; avoid if no_trend. BUY prefers bb_position near_lower/middle; SELL prefers near_upper/middle.
General: min confidence 0.70 for BUY/SELL. HOLD if setup unclear. Never open in same direction as existing position.
Examples:
{"action":"BUY","confidence":0.82,"reasoning":"H4 e H1 em tendência altista confirmada com MACD positivo e RSI neutro no M15. ADX forte indica momentum sólido para entrada comprada."}
{"action":"SELL","confidence":0.75,"reasoning":"Tendência de baixa alinhada nos três timeframes com RSI sobrecomprado revertendo. Boa oportunidade de venda no topo da Bollinger."}`;

async function callClaude(userMessage: string): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');
  return block.text;
}

export async function askClaude(context: TradingContext): Promise<string> {
  const userMessage = `Analyze this multi-timeframe market data and provide a trading decision:\n\n${JSON.stringify(context)}`;

  // Retry once on invalid JSON
  try {
    return await callClaude(userMessage);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('invalid JSON') || msg.includes('failed validation')) {
      console.warn('[Claude] First attempt invalid, retrying...');
      return await callClaude(userMessage);
    }
    throw err;
  }
}
