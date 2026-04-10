'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';

const links = [
  { href: '/registry', label: 'Registry' },
  { href: '/agents', label: 'Agents' },
  { href: '/register', label: 'Register' },
  { href: '/demo', label: 'Demo' },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border bg-background sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Lodestar
        </Link>

        <div className="flex items-center gap-8">
          <div className="hidden md:flex items-center gap-6">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`text-sm transition-colors ${
                  pathname === href
                    ? 'text-primary font-medium'
                    : 'text-secondary hover:text-primary'
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <a
              href="https://github.com/ritik4ever/lodestar#readme"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-secondary hover:text-primary transition-colors"
              title="Docs"
            >
              Docs
            </a>
            <a
              href="https://github.com/ritik4ever/lodestar"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors"
              title="GitHub"
            >
              <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
              </svg>
              GitHub
            </a>
          </div>
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
