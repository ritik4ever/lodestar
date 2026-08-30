import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';

// Mock dependencies required by agent.js on import
vi.mock('dotenv/config', () => ({}));
vi.mock('pino', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock('@stellar/stellar-sdk', () => ({
  default: {
    Keypair: {
      fromSecret: () => ({
        publicKey: () => 'GAGENTMOCKADDRESS0000000000000000000000000000000000000000000',
      }),
    },
  },
}));
vi.mock('@x402/core/client', () => ({
  x402Client: class { register() { return this; } },
  x402HTTPClient: class { encodePaymentSignatureHeader() { return {}; } },
}));
vi.mock('@x402/stellar', () => ({ createEd25519Signer: () => ({}) }));
vi.mock('@x402/stellar/exact/client', () => ({ ExactStellarScheme: class {} }));

// Set initial env so top-level evaluation of agent.js succeeds
process.env.AGENT_STELLAR_SECRET = 'STEST0000000000000000000000000000000000000000000000000000';
process.env.STELLAR_RPC_URL      = 'https://mock-rpc.example.com';
process.env.LODESTAR_API_URL     = 'http://localhost:9999';

const { loadSecret } = await import('./agent.js');

describe('loadSecret', () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  beforeEach(() => {
    // Reset secret-related env vars
    delete process.env.AGENT_STELLAR_SECRET;
    delete process.env.AGENT_STELLAR_SECRET_FILE;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  describe('environment variable secret (AGENT_STELLAR_SECRET)', () => {
    it('returns the secret when AGENT_STELLAR_SECRET is provided', () => {
      const mockSecret = 'SVALIDSECRETKEY00000000000000000000000000000000000000000000';
      process.env.AGENT_STELLAR_SECRET = mockSecret;

      const secret = loadSecret();
      expect(secret).toBe(mockSecret);
    });

    it('returns exact secret preserving valid alphanumeric characters', () => {
      const secretValue = 'SCURRENTSTELLARSECRETEXAMPLE1234567890ABCDEF';
      process.env.AGENT_STELLAR_SECRET = secretValue;

      expect(loadSecret()).toBe(secretValue);
    });
  });

  describe('configuration conflicts and missing values', () => {
    it('throws error when neither AGENT_STELLAR_SECRET nor AGENT_STELLAR_SECRET_FILE is set', () => {
      delete process.env.AGENT_STELLAR_SECRET;
      delete process.env.AGENT_STELLAR_SECRET_FILE;

      expect(() => loadSecret()).toThrow(
        'Missing AGENT_STELLAR_SECRET or AGENT_STELLAR_SECRET_FILE'
      );
    });

    it('throws error when both AGENT_STELLAR_SECRET and AGENT_STELLAR_SECRET_FILE are set', () => {
      process.env.AGENT_STELLAR_SECRET = 'SENVSECRET123';
      process.env.AGENT_STELLAR_SECRET_FILE = '/path/to/secret.txt';

      expect(() => loadSecret()).toThrow(
        'Set only one of AGENT_STELLAR_SECRET or AGENT_STELLAR_SECRET_FILE, not both'
      );
    });
  });

  describe('file secret (AGENT_STELLAR_SECRET_FILE)', () => {
    const secretFilePath = '/secrets/agent_secret.key';
    const rawSecret = 'SFILESECRETKEY9876543210';

    it('throws when the secret file cannot be read (e.g. ENOENT)', () => {
      process.env.AGENT_STELLAR_SECRET_FILE = secretFilePath;
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      expect(() => loadSecret()).toThrow(
        `Failed to read AGENT_STELLAR_SECRET_FILE: ENOENT: no such file or directory`
      );
    });

    it('throws when the secret file read fails due to permission error (EACCES)', () => {
      process.env.AGENT_STELLAR_SECRET_FILE = secretFilePath;
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      expect(() => loadSecret()).toThrow(
        `Failed to read AGENT_STELLAR_SECRET_FILE: EACCES: permission denied`
      );
    });

    it('reads and trims whitespace, newlines, and carriage returns from file content', () => {
      process.env.AGENT_STELLAR_SECRET_FILE = secretFilePath;
      vi.spyOn(fs, 'readFileSync').mockReturnValue(`  \r\n\t  ${rawSecret}  \n\t\r  `);
      vi.spyOn(fs, 'statSync').mockReturnValue({ mode: 0o600 });
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

      const secret = loadSecret();
      expect(secret).toBe(rawSecret);
    });

    describe('POSIX file permissions and numeric boundaries (non-Windows)', () => {
      beforeEach(() => {
        process.env.AGENT_STELLAR_SECRET_FILE = secretFilePath;
        vi.spyOn(fs, 'readFileSync').mockReturnValue(rawSecret);
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      });

      it.each([
        { modeName: '0o600 (owner rw)', mode: 0o600 },
        { modeName: '0o400 (owner r)', mode: 0o400 },
        { modeName: '0o700 (owner rwx)', mode: 0o700 },
        { modeName: '0o620 (group write only)', mode: 0o620 },
        { modeName: '0o610 (group exec only)', mode: 0o610 },
        { modeName: '0o602 (other write only)', mode: 0o602 },
        { modeName: '0o601 (other exec only)', mode: 0o601 },
        { modeName: '0o633 (group/other wx only)', mode: 0o633 },
        { modeName: '0o000 (no permissions)', mode: 0o000 },
      ])('allows safe mode $modeName', ({ mode }) => {
        vi.spyOn(fs, 'statSync').mockReturnValue({ mode });

        const result = loadSecret();
        expect(result).toBe(rawSecret);
      });

      it.each([
        { modeName: '0o640 (group read)', mode: 0o640 },
        { modeName: '0o440 (owner and group read)', mode: 0o440 },
        { modeName: '0o750 (owner rwx, group rx)', mode: 0o750 },
        { modeName: '0o040 (group read bit boundary)', mode: 0o040 },
        { modeName: '0o604 (other read)', mode: 0o604 },
        { modeName: '0o404 (owner and other read)', mode: 0o404 },
        { modeName: '0o705 (owner rwx, other rx)', mode: 0o705 },
        { modeName: '0o004 (other read bit boundary)', mode: 0o004 },
        { modeName: '0o644 (standard file readable by all)', mode: 0o644 },
        { modeName: '0o666 (rw for user/group/other)', mode: 0o666 },
        { modeName: '0o777 (rwx for all)', mode: 0o777 },
        { modeName: '0o755 (rwx user, rx group/other)', mode: 0o755 },
        { modeName: '0o044 (both group and other read)', mode: 0o044 },
      ])('rejects insecure mode $modeName with group/world readable error', ({ mode }) => {
        vi.spyOn(fs, 'statSync').mockReturnValue({ mode });

        expect(() => loadSecret()).toThrow(
          `AGENT_STELLAR_SECRET_FILE at ${secretFilePath} is group/world readable. Run: chmod 600 ${secretFilePath}`
        );
      });
    });

    describe('Windows platform compatibility', () => {
      beforeEach(() => {
        process.env.AGENT_STELLAR_SECRET_FILE = 'C:\\secrets\\agent_secret.key';
        vi.spyOn(fs, 'readFileSync').mockReturnValue(rawSecret);
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      });

      it('bypasses POSIX permission checks on win32 even with 0o666 or 0o777 modes', () => {
        const statSpy = vi.spyOn(fs, 'statSync').mockReturnValue({ mode: 0o666 });

        const result = loadSecret();
        expect(result).toBe(rawSecret);
        expect(statSpy).not.toHaveBeenCalled();
      });
    });
  });
});
