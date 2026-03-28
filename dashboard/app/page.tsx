'use client';

import { useEffect, useState, useCallback } from 'react';
import StatusCard from '../components/StatusCard';
import EquityChart from '../components/EquityChart';
import { OpenTradeTable, ClosedTradeTable } from '../components/TradeTable';
import AnalysisFeed from '../components/AnalysisFeed';

interface DashboardData {
  status: {
    online: boolean;
    pair: string;
    mode: string;
    balance: number;
    ts: number;
  } | null;
  analyses: Array<{
    action: string;
    confidence: number;
    reasoning: string;
    context: { m15_trend: string; h1_trend: string; h4_trend: string; adx: number; price: number };
    timestamp: string;
  }>;
  openTrades: Array<{
    tradeId: string; action: string; entry: number;
    stopLoss: number; takeProfit: number; timestamp: string;
  }>;
  closedTrades: Array<{
    tradeId: string; action: string; entry: number; exit: number;
    pnl: number; isTP: boolean; duration: string; timestamp: string;
  }>;
  balance: { usdt: number; timestamp: string } | null;
  equity: Array<{ index: number; equity: number }>;
}

function calcMetrics(closed: DashboardData['closedTrades']) {
  if (closed.length === 0) return { totalPnl: 0, winRate: 0, maxDD: 0, wins: 0, losses: 0 };
  const totalPnl = closed.reduce((s, t) => s + t.pnl, 0);
  const wins = closed.filter(t => t.pnl > 0).length;
  const losses = closed.filter(t => t.pnl < 0).length;
  const winRate = closed.length > 0 ? wins / closed.length : 0;
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of closed) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  return { totalPnl, winRate, maxDD, wins, losses };
}

const section: React.CSSProperties = {
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: 10,
  padding: '20px 24px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  color: '#666',
  textTransform: 'uppercase',
  letterSpacing: 1,
  marginBottom: 16,
  fontWeight: 600,
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastUpdate(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secAgo = lastUpdate ? Math.round((now - lastUpdate) / 1000) : null;
  const online = data?.status?.online ?? false;
  const metrics = calcMetrics(data?.closedTrades ?? []);
  const balance = data?.balance?.usdt ?? data?.status?.balance ?? 0;
  const pair = data?.status?.pair ?? 'BTCUSDT';
  const mode = data?.status?.mode ?? '—';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>🤖 tradebot-ai</h1>
          <span style={{
            padding: '3px 10px',
            borderRadius: 20,
            fontSize: 11,
            fontWeight: 700,
            background: online ? '#003320' : '#330000',
            color: online ? '#00ff88' : '#ff4444',
            border: `1px solid ${online ? '#00ff88' : '#ff4444'}`,
          }}>
            {online ? '● ONLINE' : '○ OFFLINE'}
          </span>
          <span style={{ color: '#555', fontSize: 12 }}>{pair} | {mode}</span>
        </div>
        <div style={{ color: '#555', fontSize: 12 }}>
          {error
            ? <span style={{ color: '#ff4444' }}>Erro: {error}</span>
            : secAgo !== null
              ? `Última atualização: ${secAgo}s atrás`
              : 'Carregando...'}
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <StatusCard label="Saldo USDT" value={`$${balance.toFixed(2)}`} color="#00ff88" mono />
        <StatusCard label="Total Trades" value={(data?.closedTrades.length ?? 0) + (data?.openTrades.length ?? 0)} />
        <StatusCard
          label="Win Rate"
          value={data?.closedTrades.length ? `${(metrics.winRate * 100).toFixed(1)}% (${metrics.wins}W/${metrics.losses}L)` : '—'}
          color={metrics.winRate >= 0.5 ? '#00ff88' : '#ff4444'}
        />
        <StatusCard
          label="PnL Total"
          value={data?.closedTrades.length ? `${metrics.totalPnl >= 0 ? '+' : ''}${metrics.totalPnl.toFixed(2)} USDT` : '—'}
          color={metrics.totalPnl >= 0 ? '#00ff88' : '#ff4444'}
          mono
        />
        <StatusCard
          label="Drawdown Máx"
          value={metrics.maxDD > 0 ? `-${metrics.maxDD.toFixed(2)} USDT` : '—'}
          color="#ff8844"
          mono
        />
      </div>

      {/* ── Equity chart ── */}
      <div style={{ ...section, marginBottom: 20 }}>
        <div style={sectionTitle}>Equity Curve</div>
        <EquityChart data={data?.equity ?? []} />
      </div>

      {/* ── Open trades ── */}
      <div style={{ ...section, marginBottom: 20 }}>
        <div style={sectionTitle}>Posições Abertas ({data?.openTrades.length ?? 0})</div>
        <OpenTradeTable trades={data?.openTrades ?? []} />
      </div>

      {/* ── Closed trades ── */}
      <div style={{ ...section, marginBottom: 20 }}>
        <div style={sectionTitle}>Últimos 20 Trades Fechados</div>
        <ClosedTradeTable trades={data?.closedTrades ?? []} />
      </div>

      {/* ── Analysis feed ── */}
      <div style={section}>
        <div style={sectionTitle}>Últimas Análises do Claude</div>
        <AnalysisFeed analyses={data?.analyses ?? []} />
      </div>

    </div>
  );
}
