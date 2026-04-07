import type { Metadata } from 'next';
import './globals.css';
import Navbar from '@/components/Navbar';
import { WalletProvider } from '@/components/WalletContext';

export const metadata: Metadata = {
  title: 'Lodestar — Navigate the agent economy',
  description:
    'The on-chain discovery layer that lets AI agents find, evaluate, and pay for x402 services on Stellar — autonomously.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-background text-primary">
        <WalletProvider>
          <Navbar />
          <main>{children}</main>
          <footer className="border-t border-border mt-24 py-8 text-center text-sm text-secondary">
            Built on Stellar · Powered by x402 · Lodestar 2026
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
