import axios from 'axios';
import type { Candle } from '../core/candleStore';

const INDICATORS_URL = process.env.INDICATORS_URL ?? 'http://localhost:5001';

export interface Indicators {
  rsi: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  ema20: number;
  ema50: number;
  ema200: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr: number;
  volumeSma: number;
  adx: number;
}

export async function fetchIndicators(candles: Candle[]): Promise<Indicators> {
  const payload = {
    candles: candles.map((c) => ({
      t: c.timestamp,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    })),
  };

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await axios.post<Indicators>(`${INDICATORS_URL}/indicators`, payload, {
        timeout: 8000,
      });
      return data;
    } catch {
      if (attempt === MAX_RETRIES) {
        throw new Error('Python indicators server unreachable — is it running?');
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error('Python indicators server unreachable — is it running?');
}
