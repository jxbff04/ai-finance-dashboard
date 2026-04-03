import './globals.css';
import type { Metadata } from 'next';
import { Inter, Cormorant_Garamond } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { ModeProvider } from '@/lib/ModeContext';
import AppShell from '@/components/AppShell';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-cormorant',
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'BLACKJACK',
  description: 'Personal Finance Terminal',
  manifest: '/manifest.json',
  openGraph: {
    images: [{ url: 'https://bolt.new/static/og_default.png' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://bolt.new/static/og_default.png' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${cormorant.variable}`}>
      <body
        className="antialiased"
        style={{
          fontFamily: 'var(--font-inter), system-ui, sans-serif',
          backgroundColor: '#0A0A0A',
          color: '#EFEFEF',
        }}
      >
        <ModeProvider>
          <AppShell>
            {children}
          </AppShell>
        </ModeProvider>
<Toaster />
      </body>
    </html>
  );
}
