import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'tradebot-ai Dashboard',
  description: 'Live trading dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: '#0f0f0f', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
