'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface EquityPoint { index: number; equity: number }

export default function EquityChart({ data }: { data: EquityPoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#444', padding: 40 }}>
        Sem trades fechados ainda
      </div>
    );
  }

  const color = (data[data.length - 1]?.equity ?? 0) >= 0 ? '#00ff88' : '#ff4444';

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#222" />
        <XAxis dataKey="index" tick={{ fill: '#555', fontSize: 11 }} />
        <YAxis tick={{ fill: '#555', fontSize: 11 }} />
        <Tooltip
          contentStyle={{ background: '#1a1a1a', border: '1px solid #333', color: '#e0e0e0' }}
          formatter={(v: number) => [`${v >= 0 ? '+' : ''}${v.toFixed(2)} USDT`, 'PnL acumulado']}
        />
        <Line type="monotone" dataKey="equity" stroke={color} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
