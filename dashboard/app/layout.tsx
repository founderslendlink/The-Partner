import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The Partner — Dashboard',
  description: 'AI Business Operating System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
