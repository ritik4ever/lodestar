# @lodestar/stroops

The single implementation of USDC ↔ stroop conversion, consumed by both the
backend and the agent (#853).

## Why this package exists

The backend and the agent each had their own conversion:

| | Old backend | Old agent |
| --- | --- | --- |
| USDC → stroops | string/BigInt arithmetic | `BigInt(Math.round(parseFloat(usdc) * 1e7))` |
| stroops → USDC | string/BigInt arithmetic | `String(Number(stroops) / 1e7)` |

Two implementations of the same monetary conversion disagree on specific amounts.
The float version is wrong once an amount needs more than ~15–17 significant
digits — `9007199254.7409910` USDC converts to **90071992547409920** stroops
instead of **90071992547409910**, a silent 10-stroop error. That class of bug
appears only on particular values, which makes it both hard to notice and
expensive to have.

## API

```js
import { usdcToStroops, stroopsToUsdc, stroopsToUsdcDisplay, STROOPS_PER_USDC } from '@lodestar/stroops';
```

| Function | Returns | Use for |
| --- | --- | --- |
| `usdcToStroops(usdc)` | `bigint` | Converting a user- or API-supplied amount to on-chain units |
| `stroopsToUsdc(stroops)` | `string`, 7dp | Exact representation — safe to round-trip |
| `stroopsToUsdcDisplay(stroops)` | `string`, 2dp | **Display only** — lossy, never feed back into arithmetic |

`1 USDC = 10,000,000 stroops` (`STROOPS_PER_USDC`).

## Rounding behaviour

**`usdcToStroops` truncates, it does not round.** A stroop is the smallest unit
that exists on-chain, so an amount finer than that cannot be represented; rounding
up would credit value nobody paid.

```js
usdcToStroops('0.00000019') // => 1n   (0.0000001, remainder dropped)
usdcToStroops('0.00000001') // => 0n
```

**No value is ever routed through `Number`.** Input is parsed as a decimal string
and the decimal point shifted with string arithmetic, so precision does not depend
on the magnitude of the amount. `Number` is used only to read an exponent.

**`stroopsToUsdc` is exact** and always emits 7 decimal places, so
`usdcToStroops(stroopsToUsdc(x)) === x` for every `x`.

**`stroopsToUsdcDisplay` rounds half-up to 2 decimals** and carries into the whole
part (`0.999` → `1.00`). It is lossy by design: `1.001` and `1.004` both render as
`1.00`.

**Negatives** are supported symmetrically — the sign is preserved and magnitude
handled identically.

**Invalid input throws** rather than returning a wrong number: empty strings,
bare signs, non-numeric text, and hex/binary/octal/leading-zero forms are all
rejected with `Invalid USDC amount`.

## Tests

`stroops.property.test.js` asserts round-trip stability over thousands of
generated values (seeded, so failures reproduce), at stroop boundaries, either
side of whole USDC, and beyond `Number.MAX_SAFE_INTEGER`. It also pins the
concrete amounts where the old float implementation disagreed.

The suite runs as part of `npm test` in `backend/`, which is what CI executes.
