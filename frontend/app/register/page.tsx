'use client';

import { useWallet } from '@/components/WalletContext';
import RegisterForm from '@/components/RegisterForm';

export default function RegisterPage() {
  const { status, address, balance, connect } = useWallet();

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold mb-2">Register a Service</h1>
        <p className="text-secondary text-sm">
          List your x402-enabled endpoint on the Lodestar registry. AI agents will
          discover and pay for it autonomously — no integration required on their end.
        </p>
      </div>

      {/* Wallet status */}
      {status === 'not-installed' && (
        <div className="card p-6 mb-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Freighter wallet required</p>
            <p className="text-secondary text-xs mt-1">
              Install Freighter to sign the registration transaction.
            </p>
          </div>
          <a
            href="https://freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary shrink-0"
          >
            Install Freighter
          </a>
        </div>
      )}

      {status === 'not-connected' && (
        <div className="card p-6 mb-6 flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">Connect your wallet</p>
            <p className="text-secondary text-xs mt-1">
              Your address will be recorded as the service provider on-chain.
            </p>
          </div>
          <button onClick={connect} className="btn-primary shrink-0">
            Connect Wallet
          </button>
        </div>
      )}

      {status === 'connected' && (
        <div className="flex items-center justify-between border border-border rounded-xl px-4 py-3 mb-6 bg-white">
          <div>
            <p className="text-xs text-secondary">Connected as</p>
            <p className="mono text-sm font-medium mt-0.5 break-all">{address}</p>
          </div>
          <div className="text-right shrink-0 ml-4">
            <p className="text-xs text-secondary">Balance</p>
            <p className="mono text-sm font-medium text-accent mt-0.5">{balance} USDC</p>
          </div>
        </div>
      )}

      {status === 'connected' ? (
        <RegisterForm walletAddress={address} />
      ) : (
        <div className="card p-8 opacity-40 pointer-events-none">
          <div className="space-y-4">
            {['Service Name', 'Description', 'Endpoint URL'].map((f) => (
              <div key={f}>
                <p className="text-sm font-medium mb-1.5">{f}</p>
                <div className="h-10 bg-border rounded-lg" />
              </div>
            ))}
            <div className="h-10 bg-primary rounded-lg mt-2" />
          </div>
        </div>
      )}
    </div>
  );
}
