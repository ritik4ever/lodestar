/**
 * @lodestar/stroops — the single implementation of USDC ↔ stroop conversion (#853).
 *
 * Previously the backend and the agent each had their own: the backend used exact
 * string/BigInt arithmetic, the agent used floating-point (`Number(x) / 1e7` and
 * `Math.round(parseFloat(x) * 1e7)`). Two implementations of the same monetary
 * conversion disagree on specific amounts, and a rounding discrepancy in money is
 * the kind of bug that shows up rarely and costs the most when it does.
 *
 * Precision-safe Stroop ↔ USDC conversion helpers.
 *
 * Stellar/Stroops are the smallest unit on the Stellar network (1 USDC = 10_000_000 stroops).
 * Floating-point math can introduce rounding drift on larger amounts, so these helpers
 * use string-based integer arithmetic to guarantee exact conversions.
 */

const STROOPS_PER_USDC = 10_000_000;

/**
 * Convert a USDC amount (string or number) to stroops as a BigInt.
 * Uses string-based arithmetic to avoid floating-point rounding errors.
 *
 * @param {string|number} usdc - The USDC amount (e.g. "0.001" or 0.001)
 * @returns {bigint} The equivalent stroops amount
 * @throws {Error} If the input is not a valid number
 */
export function usdcToStroops(usdc) {
  const str = String(usdc).trim();

  // Reject hex, binary, octal and leading-zero integer forms before anything else.
  if (/^[+-]?(0[xXbBoO]|0\d)/.test(str)) {
    throw new Error(`Invalid USDC amount: "${usdc}"`);
  }

  // Decimal, with optional sign and optional exponent. At least one digit is
  // required on one side of the point, so "", ".", "-" and "+" are rejected.
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(str);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new Error(`Invalid USDC amount: "${usdc}"`);
  }

  const [, sign, intRaw, fracRaw = '', expRaw] = match;
  const exponent = expRaw ? Number(expRaw) : 0;
  if (!Number.isFinite(exponent)) {
    throw new Error(`Invalid USDC amount: "${usdc}"`);
  }

  // Shift the decimal point by the exponent using string arithmetic only. The
  // value is never routed through Number(): a double holds ~15-17 significant
  // digits, so re-stringifying a large amount silently changes it — that is a
  // financial bug, not a rounding preference.
  let digits = intRaw + fracRaw;
  let pointIndex = intRaw.length + exponent;

  if (pointIndex <= 0) {
    digits = '0'.repeat(-pointIndex) + digits;
    pointIndex = 0;
  } else if (pointIndex > digits.length) {
    digits += '0'.repeat(pointIndex - digits.length);
  }

  const intPart = digits.slice(0, pointIndex) || '0';
  const fracPart = digits.slice(pointIndex);

  // Truncate (not round) beyond stroop precision: a stroop is the smallest unit
  // that exists on-chain, so a finer amount cannot be represented and rounding
  // up would credit value that was never paid.
  const frac = fracPart.padEnd(7, '0').slice(0, 7);
  const intClean = intPart.replace(/^0+/, '') || '0';

  const stroops = BigInt(intClean + frac);
  return sign === '-' ? -stroops : stroops;
}

/**
 * Convert stroops (as BigInt, number, or string) to a USDC string with full precision.
 *
 * @param {bigint|number|string} stroops - The stroops amount
 * @returns {string} The USDC amount as a string (e.g. "0.0010000")
 */
export function stroopsToUsdc(stroops) {
  const big = BigInt(stroops);
  const sign = big < 0n ? '-' : '';
  const abs = big < 0n ? -big : big;

  const intPart = abs / BigInt(STROOPS_PER_USDC);
  const fracPart = abs % BigInt(STROOPS_PER_USDC);

  return `${sign}${intPart}.${String(fracPart).padStart(7, '0')}`;
}

/**
 * Convert stroops to a USDC string formatted for display (2 decimal places, rounded).
 *
 * @param {bigint|number|string} stroops - The stroops amount
 * @returns {string} The USDC amount formatted to 2 decimals (e.g. "0.01")
 */
export function stroopsToUsdcDisplay(stroops) {
  const big = BigInt(stroops);
  const sign = big < 0n ? '-' : '';
  const abs = big < 0n ? -big : big;

  const intPart = abs / BigInt(STROOPS_PER_USDC);
  const fracRaw = abs % BigInt(STROOPS_PER_USDC);

  // Round to 2 decimal places: if the 3rd decimal digit >= 5, round up
  const frac2 = fracRaw / 100_000n; // first 2 digits
  const frac3 = (fracRaw / 10_000n) % 10n; // 3rd digit for rounding

  const rounded = frac3 >= 5n ? frac2 + 1n : frac2;
  const carry = rounded >= 100n;

  if (carry) {
    return `${sign}${intPart + 1n}.00`;
  }
  return `${sign}${intPart}.${String(rounded).padStart(2, '0')}`;
}

/** Stroops in one USDC. Exported so consumers never hard-code the constant. */
export { STROOPS_PER_USDC };
