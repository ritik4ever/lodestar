import { describe, it, expect } from 'vitest';
import { usdcToStroops, stroopsToUsdc, stroopsToUsdcDisplay } from './stroops.js';

describe('usdcToStroops', () => {
  it('converts basic amounts correctly', () => {
    expect(usdcToStroops('0.0000001')).toBe(1n);
    expect(usdcToStroops('0.000001')).toBe(10n);
    expect(usdcToStroops('0.00001')).toBe(100n);
    expect(usdcToStroops('0.0001')).toBe(1000n);
    expect(usdcToStroops('0.001')).toBe(10000n);
    expect(usdcToStroops('0.01')).toBe(100000n);
    expect(usdcToStroops('0.1')).toBe(1000000n);
    expect(usdcToStroops('1')).toBe(10000000n);
    expect(usdcToStroops('10')).toBe(100000000n);
  });

  it('handles string inputs', () => {
    expect(usdcToStroops('0.001')).toBe(10000n);
    expect(usdcToStroops('1.5')).toBe(15000000n);
  });

  it('handles number inputs', () => {
    expect(usdcToStroops(0.001)).toBe(10000n);
    expect(usdcToStroops(1.5)).toBe(15000000n);
  });

  it('handles amounts with fewer than 7 decimal places', () => {
    expect(usdcToStroops('0.5')).toBe(5000000n);
    expect(usdcToStroops('0.25')).toBe(2500000n);
  });

  it('handles amounts with more than 7 decimal places (truncates)', () => {
    expect(usdcToStroops('0.00000001')).toBe(0n);
    expect(usdcToStroops('0.00000019')).toBe(1n);
  });

  it('handles zero', () => {
    expect(usdcToStroops('0')).toBe(0n);
    expect(usdcToStroops('0.0')).toBe(0n);
  });

  it('handles large amounts without precision loss', () => {
    expect(usdcToStroops('1000000')).toBe(10000000000000n);
    expect(usdcToStroops('9999999.9999999')).toBe(99999999999999n);
  });

  it('throws on invalid input', () => {
    expect(() => usdcToStroops('')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('.')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('abc')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('NaN')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('Infinity')).toThrow('Invalid USDC amount');
  });

  it('handles exponent notation strings', () => {
    expect(usdcToStroops('1e-7')).toBe(1n);
    expect(usdcToStroops('1e-6')).toBe(10n);
    expect(usdcToStroops('1e-3')).toBe(10000n);
    expect(usdcToStroops('1e2')).toBe(1000000000n);
    expect(usdcToStroops('2.5e2')).toBe(2500000000n);
  });

  it('handles exponent notation numbers', () => {
    expect(usdcToStroops(1e-7)).toBe(1n);
    expect(usdcToStroops(1e-6)).toBe(10n);
    expect(usdcToStroops(1e-3)).toBe(10000n);
    expect(usdcToStroops(1e2)).toBe(1000000000n);
  });

  it('rejects hex, binary, and octal notation', () => {
    expect(() => usdcToStroops('0x1')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('0X1')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('0b1')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('0o1')).toThrow('Invalid USDC amount');
    expect(() => usdcToStroops('007')).toThrow('Invalid USDC amount');
  });

  it('handles negative amounts', () => {
    expect(usdcToStroops('-1')).toBe(-10000000n);
    expect(usdcToStroops('-0.001')).toBe(-10000n);
  });

  it('handles typical API values', () => {
    expect(usdcToStroops('0.001')).toBe(10000n);
    expect(usdcToStroops('0.01')).toBe(100000n);
    expect(usdcToStroops('1.00')).toBe(10000000n);
  });
});

describe('stroopsToUsdc', () => {
  it('converts basic amounts correctly', () => {
    expect(stroopsToUsdc(1n)).toBe('0.0000001');
    expect(stroopsToUsdc(10n)).toBe('0.0000010');
    expect(stroopsToUsdc(100n)).toBe('0.0000100');
    expect(stroopsToUsdc(1000n)).toBe('0.0001000');
    expect(stroopsToUsdc(10000n)).toBe('0.0010000');
    expect(stroopsToUsdc(100000n)).toBe('0.0100000');
    expect(stroopsToUsdc(1000000n)).toBe('0.1000000');
    expect(stroopsToUsdc(10000000n)).toBe('1.0000000');
    expect(stroopsToUsdc(100000000n)).toBe('10.0000000');
  });

  it('handles zero', () => {
    expect(stroopsToUsdc(0n)).toBe('0.0000000');
  });

  it('handles large amounts', () => {
    expect(stroopsToUsdc(99999999999999n)).toBe('9999999.9999999');
  });

  it('round-trips with usdcToStroops', () => {
    const amounts = ['0.001', '0.01', '0.1', '1', '10', '100', '1000'];
    for (const amt of amounts) {
      const stroops = usdcToStroops(amt);
      const back = stroopsToUsdc(stroops);
      expect(back).toBe(Number(amt).toFixed(7));
    }
  });
});

describe('stroopsToUsdcDisplay', () => {
  it('formats to 2 decimal places', () => {
    expect(stroopsToUsdcDisplay(1000000n)).toBe('0.10');
    expect(stroopsToUsdcDisplay(10000000n)).toBe('1.00');
    expect(stroopsToUsdcDisplay(100000000n)).toBe('10.00');
  });

  it('rounds correctly', () => {
    expect(stroopsToUsdcDisplay(1500000n)).toBe('0.15');
    expect(stroopsToUsdcDisplay(1550000n)).toBe('0.16');
    expect(stroopsToUsdcDisplay(1549999n)).toBe('0.15');
  });

  it('handles zero', () => {
    expect(stroopsToUsdcDisplay(0n)).toBe('0.00');
  });

  it('handles carry when rounding up', () => {
    expect(stroopsToUsdcDisplay(9950000n)).toBe('1.00');
    expect(stroopsToUsdcDisplay(9900000n)).toBe('0.99');
  });
});
