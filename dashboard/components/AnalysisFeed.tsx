'use client';

interface Analysis {
  action: string;
  confidence: number;
  reasoning: string;
  context: {
    m15_trend: string;
    h1_trend: string;
    h4_trend: string;
    adx: number;
    price: number;
  };
  timestamp: string;
}

function trendEmoji(t: string) {
  if (t === 'bullish') return '🟢';
  if (t === 'bearish') return '🔴';
  return '🟡';
}

export default function AnalysisFeed({ analyses }: { analyses: Analysis[] }) {
  if (analyses.length === 0) {
    return <p style={{ color: '#555', fontSize: 13 }}>Nenhuma análise ainda.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {analyses.slice(0, 10).map((a, i) => {
        const actionColor = a.action === 'BUY' ? '#00ff88' : a.action === 'SELL' ? '#ff4444' : '#888';
        return (
          <div key={i} style={{
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: 6,
            padding: '10px 14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ color: actionColor, fontWeight: 700, fontSize: 13 }}>
                {a.action === 'BUY' ? '📈' : a.action === 'SELL' ? '📉' : '⏸'} {a.action}
                <span style={{ color: '#888', fontWeight: 400, marginLeft: 8 }}>
                  {(a.confidence * 100).toFixed(0)}% conf
                </span>
              </span>
              <span style={{ color: '#555', fontSize: 11, fontFamily: 'monospace' }}>
                {a.timestamp.slice(0, 16).replace('T', ' ')}
              </span>
            </div>
            {a.context && (
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4, fontFamily: 'monospace' }}>
                M15 {trendEmoji(a.context.m15_trend)} | H1 {trendEmoji(a.context.h1_trend)} | H4 {trendEmoji(a.context.h4_trend)} | ADX {a.context.adx?.toFixed(1)} | ${a.context.price?.toLocaleString('pt-BR')}
              </div>
            )}
            <div style={{ fontSize: 12, color: '#aaa', lineHeight: 1.4 }}>
              {a.reasoning}
            </div>
          </div>
        );
      })}
    </div>
  );
}
