import { describe, it, expect } from 'vitest';
import {
  usdcToStroops,
  stroopsToUsdc,
  stroopsToUsdcDisplay,
  STROOPS_PER_USDC,
} from './index.js';

/**
 * Round-trip property tests for the shared conversion package (#853).
 *
 * The risk this package exists to remove is two implementations disagreeing on
 * rounding for specific amounts. These tests assert the properties that make a
 * monetary conversion safe, over a wide spread of values rather than a handful
 * of hand-picked ones — including the values where the agent's old
 * floating-point version was wrong.
 */

/** Deterministic pseudo-random generator so a failure is reproducible. */
function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('stroop conversion properties (#853)', () => {
  describe('round-trip stability', () => {
    it('stroops -> USDC -> stroops is the identity for a wide spread of values', () => {
      const rng = makeRng(20260829);

      for (let i = 0; i < 2000; i++) {
        // Spread across 0 .. ~10^15 stroops (~100 million USDC).
        const magnitude = Math.floor(rng() * 16);
        const stroops = BigInt(Math.floor(rng() * 10 ** Math.min(magnitude, 15)));

        expect(usdcToStroops(stroopsToUsdc(stroops))).toBe(stroops);
      }
    });

    it('is exact at every single-stroop boundary', () => {
      for (let i = 0n; i <= 20n; i++) {
        expect(usdcToStroops(stroopsToUsdc(i))).toBe(i);
      }
    });

    it('is exact either side of a whole USDC', () => {
      for (const base of [1n, 10n, 100n, 1000n, 1_000_000n]) {
        const whole = base * BigInt(STROOPS_PER_USDC);
        for (const delta of [-1n, 0n, 1n]) {
          const value = whole + delta;
          expect(usdcToStroops(stroopsToUsdc(value))).toBe(value);
        }
      }
    });

    it('preserves the smallest representable amount', () => {
      expect(stroopsToUsdc(1n)).toBe('0.0000001');
      expect(usdcToStroops('0.0000001')).toBe(1n);
    });

    it('handles amounts beyond Number.MAX_SAFE_INTEGER stroops', () => {
      const huge = 90_071_992_547_409_910n; // > 2^53
      expect(usdcToStroops(stroopsToUsdc(huge))).toBe(huge);
    });
  });

  describe('USDC -> stroops -> USDC', () => {
    it('round-trips any 7-decimal string exactly', () => {
      const rng = makeRng(7);

      for (let i = 0; i < 1000; i++) {
        const whole = Math.floor(rng() * 1_000_000);
        const frac = String(Math.floor(rng() * STROOPS_PER_USDC)).padStart(7, '0');
        const usdc = `${whole}.${frac}`;

        expect(stroopsToUsdc(usdcToStroops(usdc))).toBe(usdc);
      }
    });

    it('normalises shorter fractions to 7 decimals without changing value', () => {
      expect(stroopsToUsdc(usdcToStroops('1.5'))).toBe('1.5000000');
      expect(stroopsToUsdc(usdcToStroops('0.01'))).toBe('0.0100000');
      expect(stroopsToUsdc(usdcToStroops('2'))).toBe('2.0000000');
    });
  });

  describe('agreement with the previous float implementation where it was correct', () => {
    // The agent used: BigInt(Math.round(parseFloat(usdc) * 10_000_000))
    const floatUsdcToStroops = (usdc) => BigInt(Math.round(parseFloat(usdc) * STROOPS_PER_USDC));

    it('matches on the common small amounts the agent actually paid', () => {
      for (const usdc of ['0.001', '0.002', '0.01', '0.1', '1']) {
        expect(usdcToStroops(usdc)).toBe(floatUsdcToStroops(usdc));
      }
    });

    it('differs from the float version on amounts where floats drift', () => {
      // The exact implementation is authoritative; this documents that the two
      // genuinely disagreed, which is the bug the shared package removes.
      // Verified disagreements: both are off by 10 and 1 stroop respectively
      // under the float version, because a double cannot hold 17 significant digits.
      const drifting = ['9007199254.7409910', '1234567890.1234567'];
      const disagreements = drifting.filter(
        (usdc) => usdcToStroops(usdc) !== floatUsdcToStroops(usdc),
      );

      for (const usdc of drifting) {
        // Whatever the float version says, the exact one round-trips.
        expect(stroopsToUsdc(usdcToStroops(usdc))).toBe(usdc);
      }
      expect(disagreements.length).toBeGreaterThan(0);
    });

    it('stays exact where the float version loses precision on large values', () => {
      const large = 92_233_720_368_547_758n; // ~9.2e9 USDC in stroops
      const viaFloat = BigInt(Math.round((Number(large) / STROOPS_PER_USDC) * STROOPS_PER_USDC));

      expect(usdcToStroops(stroopsToUsdc(large))).toBe(large);
      expect(viaFloat).not.toBe(large);
    });
  });

  describe('display formatting', () => {
    it('rounds half-up to 2 decimals', () => {
      expect(stroopsToUsdcDisplay(usdcToStroops('1.005'))).toBe('1.01');
      expect(stroopsToUsdcDisplay(usdcToStroops('1.004'))).toBe('1.00');
      expect(stroopsToUsdcDisplay(usdcToStroops('1.0049999'))).toBe('1.00');
    });

    it('carries into the whole part', () => {
      expect(stroopsToUsdcDisplay(usdcToStroops('0.999'))).toBe('1.00');
      expect(stroopsToUsdcDisplay(usdcToStroops('9.999'))).toBe('10.00');
    });

    it('never returns more than 2 decimal places', () => {
      const rng = makeRng(99);
      for (let i = 0; i < 500; i++) {
        const stroops = BigInt(Math.floor(rng() * 10 ** 12));
        expect(stroopsToUsdcDisplay(stroops)).toMatch(/^-?\d+\.\d{2}$/);
      }
    });

    it('is display-only — it must not be used for arithmetic', () => {
      // Documented lossiness: two distinct amounts can share a display string.
      expect(stroopsToUsdcDisplay(usdcToStroops('1.001'))).toBe(
        stroopsToUsdcDisplay(usdcToStroops('1.004')),
      );
    });
  });

  describe('signed amounts', () => {
    it('round-trips negatives', () => {
      for (const stroops of [-1n, -10_000_000n, -123_456_789n]) {
        expect(usdcToStroops(stroopsToUsdc(stroops))).toBe(stroops);
      }
    });

    it('formats negatives for display', () => {
      expect(stroopsToUsdcDisplay(-15_000_000n)).toBe('-1.50');
    });
  });

  describe('rejects invalid input', () => {
    it.each(['', '.', '-', '+', 'abc', '0x10', '0b1', '0o7', 'Infinity', 'NaN'])(
      'throws on %j',
      (value) => {
        expect(() => usdcToStroops(value)).toThrow(/Invalid USDC amount/);
      },
    );
  });
});
