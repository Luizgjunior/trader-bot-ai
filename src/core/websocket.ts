import { WebSocket } from 'ws';
import { addCandle, type Candle, type Timeframe } from './candleStore';

const BYBIT_WS_TESTNET = 'wss://stream-testnet.bybit.com/v5/public/linear';
const BYBIT_WS_MAINNET = 'wss://stream.bybit.com/v5/public/linear';

let ws: WebSocket | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let onCandleClose: (() => void) | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let pongTimer: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.ping();
      pongTimer = setTimeout(() => {
        console.warn('[WS] Pong timeout — forçando reconexão...');
        ws?.terminate();
      }, 10_000);
    }
  }, 30_000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (pongTimer)      { clearTimeout(pongTimer);       pongTimer = null; }
}

export function connectWebSocket(
  pair: string,
  testnet: boolean,
  onClose: () => void
): void {
  onCandleClose = onClose;
  const url = testnet ? BYBIT_WS_TESTNET : BYBIT_WS_MAINNET;
  const topics = [`kline.15.${pair}`, `kline.60.${pair}`, `kline.240.${pair}`];

  console.log(`[WS] Connecting to ${url} — topics: ${topics.join(', ')}`);

  if (ws) {
    ws.removeAllListeners();
    ws.terminate();
    ws = null;
  }

  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('[WS] Connected');
    ws!.send(JSON.stringify({ op: 'subscribe', args: topics }));
    startHeartbeat();
    reconnectAttempts = 0;
  });

  ws.on('pong', () => {
    if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
  });

  ws.on('message', (raw: Buffer) => {
    handleMessage(raw.toString());
  });

  ws.on('close', () => {
    stopHeartbeat();
    console.warn('[WS] Disconnected — reconnecting in 5s...');
    scheduleReconnect(pair, testnet, onClose);
  });

  ws.on('error', (err: Error) => {
    console.error('[WS] Error:', err.message);
  });
}

function handleMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw);
    if (!msg.data || !msg.topic) return;

    // topic format: "kline.15.BTCUSDT" → tf = "15"
    const tf = msg.topic.split('.')[1] as Timeframe;

    for (const kline of msg.data) {
      if (!kline.confirm) continue; // only closed candles

      const candle: Candle = {
        timestamp: Number(kline.start),
        open: parseFloat(kline.open),
        high: parseFloat(kline.high),
        low: parseFloat(kline.low),
        close: parseFloat(kline.close),
        volume: parseFloat(kline.volume),
      };

      addCandle(candle, tf);

      // Only trigger AI cycle on M15 close
      if (tf === '15') onCandleClose?.();
    }
  } catch (err) {
    console.error('[WS] Failed to parse message:', err);
  }
}

function scheduleReconnect(
  pair: string,
  testnet: boolean,
  onClose: () => void
): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(5000 * Math.pow(2, reconnectAttempts), 60_000);
  reconnectAttempts++;
  console.warn(`[WS] Reconectando em ${delay / 1000}s (tentativa ${reconnectAttempts})...`);
  reconnectTimer = setTimeout(() => {
    connectWebSocket(pair, testnet, onClose);
  }, delay);
}

export function disconnectWebSocket(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectAttempts = 0;
  ws?.close();
}
