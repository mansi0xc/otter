/**
 * Exact-integer mirror of contracts/src/OtterMath.sol.
 *
 * This file exists to be compared against, not to be clever. Every function here
 * must match its Solidity counterpart operation for operation, including rounding
 * direction and the ORDER in which checks fire — the cross-check asserts which
 * error a bad vector produces, not merely that it produces one.
 *
 * If you change OtterMath.sol, change this in the same commit.
 */

export const WAD = 1_000_000_000_000_000_000n;

/** floor(a*b/c) — matches solmate mulDivDown for nonnegative inputs. */
export const mulDivDown = (a: bigint, b: bigint, c: bigint): bigint => (a * b) / c;

/** ceil(a*b/c) — matches solmate mulDivUp for nonnegative inputs. */
export const mulDivUp = (a: bigint, b: bigint, c: bigint): bigint => {
  const p = a * b;
  return p === 0n ? 0n : (p - 1n) / c + 1n;
};

export interface Curve {
  x0: bigint;
  y0: bigint;
  M: bigint;
}

export interface Fill {
  ask: bigint; // WAD-scaled
  budget: bigint;
  y: bigint;
  x: bigint;
}

export const spotDown = (c: Curve, y: bigint) => mulDivDown(c.x0, y, c.y0);
export const spotUp = (c: Curve, y: bigint) => mulDivUp(c.x0, y, c.y0);

export function fTildeDown(c: Curve, y: bigint): bigint {
  if (y <= c.M) return spotDown(c, y);
  const z = y - c.M;
  let rem = mulDivUp(c.x0, c.y0, c.y0 + z);
  if (rem > c.x0) rem = c.x0;
  return spotDown(c, c.M) + (c.x0 - rem);
}

export function fTildeUp(c: Curve, y: bigint): bigint {
  if (y <= c.M) return spotUp(c, y);
  const z = y - c.M;
  let rem = mulDivDown(c.x0, c.y0, c.y0 + z);
  if (rem > c.x0) rem = c.x0;
  return spotUp(c, c.M) + (c.x0 - rem);
}

/**
 * Discretisation allowance. Mirrors OtterMath.discretisationAllowance.
 * v4 pays slightly less than the paper's continuous F~ because it rounds in the
 * pool's favour twice per swap on a Q64.96 grid; the shortfall grows with price
 * impact. See contracts/test/CurveSweep.t.sol for the measurements.
 */
export const IMPACT_ALLOWANCE_NUM = 200n;
export const ALLOWANCE_FLOOR = 2n;

export function discretisationAllowance(c: Curve, y: bigint): bigint {
  if (y <= c.M) return 0n;
  return mulDivUp(y - c.M, IMPACT_ALLOWANCE_NUM, c.y0) + ALLOWANCE_FLOOR;
}

/** F~(y) rounded down and reduced by the allowance. Bounds real payments. */
export function fTildeSettleable(c: Curve, y: bigint): bigint {
  const raw = fTildeDown(c, y);
  const allow = discretisationAllowance(c, y);
  return raw > allow ? raw - allow : 0n;
}

export const eligible = (c: Curve, ask: bigint) => mulDivUp(ask, c.y0, WAD) <= c.x0;

/**
 * Error codes. Must stay in sync with CrossCheck.t.sol's selector table.
 * 0 means the vector is expected to verify.
 */
export const OK = 0;
export const ERR_BUDGET = 1;
export const ERR_SPOT = 2;
export const ERR_MARGINAL = 3;
export const ERR_IR = 4;
export const ERR_DOMINANCE = 5;
export const ERR_BURN = 6;

export interface Verdict {
  code: number;
  /** index of the offending fill, meaningless unless code is a per-fill error */
  index: number;
  /**
   * Arguments carried by the batch-level errors, so the cross-check can match
   * the full revert payload rather than just a selector:
   *   ERR_DOMINANCE -> (totalIn, M)
   *   ERR_BURN      -> (totalPaid, available)
   * Zero for the per-fill errors, which carry only an index.
   */
  arg0: bigint;
  arg1: bigint;
  totalIn: bigint;
  totalPaid: bigint;
  burn: bigint;
}

/** Mirrors OtterMath.verify exactly, including the order of the checks. */
export function verify(c: Curve, fills: Fill[]): Verdict {
  let totalIn = 0n;
  let totalPaid = 0n;
  const fail = (code: number, index: number, arg0 = 0n, arg1 = 0n): Verdict => ({
    code,
    index,
    arg0,
    arg1,
    totalIn: 0n,
    totalPaid: 0n,
    burn: 0n,
  });

  for (let i = 0; i < fills.length; i++) {
    const f = fills[i];
    if (f.y > f.budget) return fail(ERR_BUDGET, i);
    if (f.x > spotDown(c, f.y)) return fail(ERR_SPOT, i);
    if (f.x < mulDivUp(f.ask, f.y, WAD)) return fail(ERR_IR, i);
    totalIn += f.y;
    totalPaid += f.x;
  }

  if (totalIn < c.M) return fail(ERR_DOMINANCE, 0, totalIn, c.M);

  const available = fTildeSettleable(c, totalIn);

  for (let i = 0; i < fills.length; i++) {
    const sub = fTildeUp(c, totalIn - fills[i].y);
    const bound = sub >= available ? 0n : available - sub;
    if (fills[i].x > bound) return fail(ERR_MARGINAL, i);
  }

  if (totalPaid > available) return fail(ERR_BURN, 0, totalPaid, available);

  return { code: OK, index: 0, arg0: 0n, arg1: 0n, totalIn, totalPaid, burn: available - totalPaid };
}

/** The largest x*_i that can be paid for a given fill, given the batch total. */
export function payCeiling(c: Curve, fills: Fill[], i: number, totalIn: bigint): bigint {
  const available = fTildeSettleable(c, totalIn);
  const sub = fTildeUp(c, totalIn - fills[i].y);
  const marginal = sub >= available ? 0n : available - sub;
  const spot = spotDown(c, fills[i].y);
  return marginal < spot ? marginal : spot;
}
