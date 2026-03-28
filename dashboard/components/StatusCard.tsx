'use client';

interface StatusCardProps {
  label: string;
  value: string | number;
  color?: string;
  mono?: boolean;
}

export default function StatusCard({ label, value, color, mono }: StatusCardProps) {
  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: 8,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </span>
      <span style={{
        fontSize: 22,
        fontWeight: 700,
        color: color ?? '#e0e0e0',
        fontFamily: mono ? 'monospace' : 'inherit',
      }}>
        {value}
      </span>
    </div>
  );
}
