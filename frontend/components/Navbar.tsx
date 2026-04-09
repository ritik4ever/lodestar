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
          <WalletConnect />
        </div>
      </div>
    </nav>
  );
}
