'use client';

interface OpenTrade {
  tradeId: string;
  action: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  timestamp: string;
}

interface ClosedTrade {
  tradeId: string;
  action: string;
  entry: number;
  exit: number;
  pnl: number;
  isTP: boolean;
  duration: string;
  timestamp: string;
}

function fmtPrice(n: number) {
  return `$${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60 > 0 ? (m % 60) + 'min' : ''}`;
}

const th: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  color: '#555',
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid #2a2a2a',
};

const td: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  borderBottom: '1px solid #1e1e1e',
  fontFamily: 'monospace',
};

export function OpenTradeTable({ trades }: { trades: OpenTrade[] }) {
  if (trades.length === 0) {
    return <p style={{ color: '#555', fontSize: 13 }}>Nenhuma posição aberta.</p>;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['#', 'Ação', 'Entrada', 'SL', 'TP', 'Aberta há'].map(h => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {trades.map(t => (
            <tr key={t.tradeId}>
              <td style={td}>{t.tradeId}</td>
              <td style={{ ...td, color: t.action === 'BUY' ? '#00ff88' : '#ff4444', fontWeight: 700 }}>{t.action}</td>
              <td style={td}>{fmtPrice(t.entry)}</td>
              <td style={{ ...td, color: '#ff4444' }}>{fmtPrice(t.stopLoss)}</td>
              <td style={{ ...td, color: '#00ff88' }}>{fmtPrice(t.takeProfit)}</td>
              <td style={td}>{timeSince(t.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClosedTradeTable({ trades }: { trades: ClosedTrade[] }) {
  if (trades.length === 0) {
    return <p style={{ color: '#555', fontSize: 13 }}>Nenhum trade fechado ainda.</p>;
  }
  const last20 = trades.slice(0, 20);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {['Data/Hora', 'Ação', 'Entrada', 'Saída', 'Duração', 'PnL', 'Resultado'].map(h => <th key={h} style={th}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {last20.map((t, i) => {
            const pnlColor = t.pnl >= 0 ? '#00ff88' : '#ff4444';
            const sign = t.pnl >= 0 ? '+' : '';
            return (
              <tr key={i}>
                <td style={td}>{t.timestamp.slice(0, 16).replace('T', ' ')}</td>
                <td style={{ ...td, color: t.action === 'BUY' ? '#00ff88' : '#ff4444', fontWeight: 700 }}>{t.action}</td>
                <td style={td}>{fmtPrice(t.entry)}</td>
                <td style={td}>{fmtPrice(t.exit)}</td>
                <td style={td}>{t.duration}</td>
                <td style={{ ...td, color: pnlColor }}>{sign}{t.pnl.toFixed(2)} USDT</td>
                <td style={{ ...td, color: pnlColor, fontWeight: 700 }}>{t.isTP ? '✅ WIN' : '❌ LOSS'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
