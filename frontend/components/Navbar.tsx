'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import WalletConnect from './WalletConnect';
import { useTheme } from './ThemeProvider';

const links = [
  { href: '/registry', label: 'Registry' },
  { href: '/agents', label: 'Agents' },
  { href: '/register', label: 'Register' },
  { href: '/demo', label: 'Demo' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();

  // Exact match for the home route, prefix match for nested routes so a link
  // stays highlighted on its sub-pages (e.g. /agents while on /agents/[address])
  // without "/" matching every path.
  const isActive = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="border-b border-border bg-background sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          aria-current={isActive('/') ? 'page' : undefined}
          className="text-lg font-semibold tracking-tight"
        >
          Lodestar
        </Link>

        <div className="flex items-center gap-8">
          <div className="hidden md:flex items-center gap-6">
            {links.map(({ href, label }) => {
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`text-sm transition-colors ${
                    active
                      ? 'text-primary font-medium'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-secondary hover:text-primary transition-colors"
              title="Toggle theme"
            >
              {theme === 'light' ? (
                <svg height="20" width="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"/>
                </svg>
              ) : (
                <svg height="20" width="20" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"/>
                </svg>
              )}
            </button>
            <a
              href="https://github.com/ritik4ever/lodestar/blob/main/README.md"
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
