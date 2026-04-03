import { getCandles, getLastCandle } from '../core/candleStore';
import { fetchIndicators, type Indicators } from '../indicators/client';
import { getCurrentPosition, getBalance } from '../broker/bybit';
import { getRecentTrades } from '../database/db';

export interface TimeframeData {
  ema_trend: 'bullish' | 'bearish' | 'neutral';
  rsi: number;
  rsi_zone: 'overbought' | 'oversold' | 'neutral';
  macd_state: 'bullish' | 'bearish' | 'neutral';
  adx: number;
  adx_strength: 'strong_trend' | 'moderate_trend' | 'weak_trend' | 'no_trend';
  bb_position: 'above_upper' | 'near_upper' | 'middle' | 'near_lower' | 'below_lower';
  atr: number;
  volume_vs_avg?: 'high' | 'normal' | 'low';
}

export interface TradingContext {
  pair: string;
  currentPrice: number;
  m15: TimeframeData;
  h1: TimeframeData;
  h4: TimeframeData;
  d1: TimeframeData | null;
  timeframe_alignment: 'bullish' | 'bearish' | 'mixed';
  position: object | null;
  balance: number;
  recentTrades: object[];
  timestamp: string;
  dayOfWeek: string;
  hour: number;
}

function emaTrend(ind: Indicators): 'bullish' | 'bearish' | 'neutral' {
  if (ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200) return 'bullish';
  if (ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200) return 'bearish';
  return 'neutral';
}

function rsiZone(rsi: number): 'overbought' | 'oversold' | 'neutral' {
  if (rsi >= 70) return 'overbought';
  if (rsi <= 30) return 'oversold';
  return 'neutral';
}

function macdState(macdHist: number): 'bullish' | 'bearish' | 'neutral' {
  if (macdHist > 0) return 'bullish';
  if (macdHist < 0) return 'bearish';
  return 'neutral';
}

function adxStrength(adx: number): 'strong_trend' | 'moderate_trend' | 'weak_trend' | 'no_trend' {
  if (adx >= 40) return 'strong_trend';
  if (adx >= 25) return 'moderate_trend';
  if (adx >= 20) return 'weak_trend';
  return 'no_trend';
}

function bbPosition(price: number, bbUpper: number, bbLower: number): 'above_upper' | 'near_upper' | 'middle' | 'near_lower' | 'below_lower' {
  const range = bbUpper - bbLower;
  if (range === 0) return 'middle';
  const ratio = (price - bbLower) / range;
  if (price > bbUpper) return 'above_upper';
  if (ratio >= 0.8) return 'near_upper';
  if (ratio <= 0.2) return 'near_lower';
  if (price < bbLower) return 'below_lower';
  return 'middle';
}

function volumeVsAvg(volume: number, volumeSma: number): 'high' | 'normal' | 'low' {
  if (volumeSma === 0) return 'normal';
  const ratio = volume / volumeSma;
  if (ratio > 1.5) return 'high';
  if (ratio < 0.4) return 'low';  // era 0.7 — relaxado para gerar mais entradas
  return 'normal';
}

function buildTimeframeData(ind: Indicators, price: number): TimeframeData {
  return {
    ema_trend: emaTrend(ind),
    rsi: Math.round(ind.rsi * 10) / 10,
    rsi_zone: rsiZone(ind.rsi),
    macd_state: macdState(ind.macdHist),
    adx: Math.round(ind.adx * 10) / 10,
    adx_strength: adxStrength(ind.adx),
    bb_position: bbPosition(price, ind.bbUpper, ind.bbLower),
    atr: Math.round(ind.atr * 100) / 100,
  };
}

function assertIndicators(ind: Indicators, label: string): void {
  const nullFields = Object.entries(ind)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k);
  if (nullFields.length > 0) {
    throw new Error(`[Context] ${label} indicators com campos nulos: ${nullFields.join(', ')} — candles insuficientes`);
  }
}

export async function buildContext(pair: string): Promise<TradingContext> {
  const candles15  = getCandles(200, pair, '15');
  const candles60  = getCandles(200, pair, '60');
  const candles240 = getCandles(200, pair, '240');
  const candlesD1  = getCandles(200, pair, 'D');

  const [ind15, ind60, ind240, indD1Result, position, balance] = await Promise.all([
    fetchIndicators(candles15),
    fetchIndicators(candles60),
    fetchIndicators(candles240),
    candlesD1.length >= 50 ? fetchIndicators(candlesD1).catch(() => null) : Promise.resolve(null),
    getCurrentPosition(),
    getBalance(),
  ]);

  assertIndicators(ind15,  'M15');
  assertIndicators(ind60,  'H1');
  assertIndicators(ind240, 'H4');

  const lastCandle = getLastCandle(pair, '15');
  const currentPrice = lastCandle?.close ?? 0;

  const tf15  = buildTimeframeData(ind15,  currentPrice);
  const tf60  = buildTimeframeData(ind60,  currentPrice);
  const tf240 = buildTimeframeData(ind240, currentPrice);

  let tfD1: TimeframeData | null = null;
  if (indD1Result) {
    try {
      assertIndicators(indD1Result, 'D1');
      tfD1 = buildTimeframeData(indD1Result, currentPrice);
    } catch {
      tfD1 = null;
    }
  }

  // Use actual last candle volume for M15 (most recent)
  if (lastCandle && ind15.volumeSma > 0) {
    tf15.volume_vs_avg = volumeVsAvg(lastCandle.volume, ind15.volumeSma);
  }

  // Alinhamento relaxado: H1 + H4 precisam concordar (M15 pode divergir)
  let timeframe_alignment: 'bullish' | 'bearish' | 'mixed';
  if (tf60.ema_trend === 'bullish' && tf240.ema_trend === 'bullish') {
    timeframe_alignment = 'bullish';
  } else if (tf60.ema_trend === 'bearish' && tf240.ema_trend === 'bearish') {
    timeframe_alignment = 'bearish';
  } else {
    timeframe_alignment = 'mixed';
  }

  const recentTrades = getRecentTrades(5, pair);
  const now = new Date();

  return {
    pair,
    currentPrice,
    m15: tf15,
    h1:  tf60,
    h4:  tf240,
    d1:  tfD1,
    timeframe_alignment,
    position,
    balance,
    recentTrades,
    timestamp:  now.toISOString(),
    dayOfWeek:  now.toLocaleDateString('en-US', { weekday: 'long' }),
    hour:       now.getUTCHours(),
  };
}
