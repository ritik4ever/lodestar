import type { Metadata, Viewport } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { WalletProvider } from '@/components/WalletContext';
import { ThemeProvider } from '@/components/ThemeProvider';

export const viewport: Viewport = {
  themeColor: '#FAFAF7',
  width: 'device-width',
  initialScale: 1,
};

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lodestar.app';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: 'Lodestar — Navigate the agent economy',
    template: '%s | Lodestar',
  },
  description:
    'The on-chain discovery layer that lets AI agents find, evaluate, and pay for x402 services on Stellar — autonomously.',
  openGraph: {
    type: 'website',
    siteName: 'Lodestar',
    title: 'Lodestar — Navigate the agent economy',
    description:
      'The on-chain discovery layer that lets AI agents find, evaluate, and pay for x402 services on Stellar — autonomously.',
    url: baseUrl,
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'Lodestar — Navigate the agent economy',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lodestar — Navigate the agent economy',
    description:
      'The on-chain discovery layer that lets AI agents find, evaluate, and pay for x402 services on Stellar — autonomously.',
    images: ['/opengraph-image'],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-primary">
        <ThemeProvider>
          <WalletProvider>
            <Navbar />
            <main>{children}</main>
            <footer className="border-t border-border mt-24 py-8 text-center text-sm text-secondary">
              Built on Stellar · Powered by x402 · Lodestar 2026
            </footer>
          </WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
