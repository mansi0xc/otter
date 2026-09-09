import { AugmentedCurve } from "./curve.ts";
import type { Bid } from "./onesided.ts";
import { runOneSided } from "./onesided.ts";

export interface Pool {
  x0: number;
  y0: number;
}

/** A sell-Y report: ask v~ in X per Y, budget q~ in Y. */
export interface SellY {
  ask: number;
  budget: number;
}
/** A sell-X report: ask u~ in Y per X, budget r~ in X. */
export interface SellX {
  ask: number;
  budget: number;
}

export interface Outcome {
  dominant: "Y" | "X";
  M: number;
  DY: number;
  DX: number;
  /** per sell-Y report: y = Y supplied, x = X received */
  sellY: { y: number; x: number }[];
  /** per sell-X report: x = X supplied, y = Y received */
  sellX: { x: number; y: number }[];
  /** burnt surplus, in the dominant side's output token */
  burn: number;
}

const EPS = 1e-9;

export function solve(pool: Pool, sellY: SellY[], sellX: SellX[]): Outcome {
  const sigma0 = pool.x0 / pool.y0;
  const rho0 = pool.y0 / pool.x0;

  const DY = sellY.reduce((s, b) => (b.ask <= sigma0 + EPS ? s + b.budget : s), 0);
  const DX = sellX.reduce((s, b) => (b.ask <= rho0 + EPS ? s + b.budget : s), 0);

  // Ties go to sell-Y (eq. 10): >= for sell-Y, strict < for sell-X.
  const yDominant = DY >= rho0 * DX - EPS;

  if (yDominant) {
    return core(pool.x0, pool.y0, sellY, sellX, DY, DX, "Y");
  }
  // Symmetric case: swap the roles of the two tokens and swap the answer back.
  const flipped = core(pool.y0, pool.x0, sellX, sellY, DX, DY, "X");
  return {
    dominant: "X",
    M: flipped.M,
    DY,
    DX,
    sellY: flipped.sellX.map((o) => ({ y: o.x, x: o.y })),
    sellX: flipped.sellY.map((o) => ({ x: o.y, y: o.x })),
    burn: flipped.burn,
  };
}

/**
 * `out`/`inp` are the reserves from the dominant side's point of view:
 * the dominant side supplies `inp`-token and receives `out`-token.
 * `dom` are the dominant-side reports, `min_` the minority-side reports.
 */
function core(
  out: number,
  inp: number,
  dom: Bid[],
  min_: Bid[],
  Ddom: number,
  Dmin: number,
  label: "Y" | "X",
): Outcome {
  const sigma0 = out / inp;
  const rho0 = 1 / sigma0;
  const M = rho0 * Dmin;

  // Minority side: every eligible order fills in full at the initial spot price (eq. 11).
  const minOut = min_.map((b) =>
    b.ask <= rho0 + EPS ? { x: b.budget, y: rho0 * b.budget } : { x: 0, y: 0 },
  );

  // Dominant side: one-sided VCG on the augmented curve.
  const curve = new AugmentedCurve(out, inp, M);
  const res = runOneSided(curve, dom);

  const Qdom = res.totalIn;
  const P = res.pay.reduce((a, b) => a + b, 0);
  const available = curve.F(Qdom); // = Dmin + F(Qdom - M)
  const burn = available - P;

  return {
    dominant: label,
    M,
    DY: Ddom,
    DX: Dmin,
    sellY: res.alloc.map((y, i) => ({ y, x: res.pay[i] })),
    sellX: minOut,
    burn,
  };
}

// ---------------------------------------------------------------------------
// Utility, eq. (2). The catastrophic branch is a CONJUNCTION, not "traded in the
// wrong direction". A sell-Y user is NOT penalised for a net gain in Y as long as
// it does not also lose X -- the paper explicitly permits a weak-gain-in-both
// free lunch here, and that permissiveness is what makes the UIC theorem strong.
// Getting this wrong makes the cross-direction sybil tests pass vacuously.
// ---------------------------------------------------------------------------

export interface Flows {
  /** Y supplied by the real user's sell-Y identities */
  SY: number;
  /** X received by them */
  RX: number;
  /** X supplied by the real user's sell-X identities */
  SX: number;
  /** Y received by them */
  RY: number;
}

export function utilitySellY(f: Flows, v: number, q: number): number {
  const dX = f.RX - f.SX;
  const dY = f.RY - f.SY;
  if (-dY > q + EPS) return -Infinity;
  if (-dY < -EPS && dX < -EPS) return -Infinity;
  return dX + v * dY;
}

export function utilitySellX(f: Flows, u: number, r: number): number {
  const dX = f.RX - f.SX;
  const dY = f.RY - f.SY;
  if (-dX > r + EPS) return -Infinity;
  if (-dX < -EPS && dY < -EPS) return -Infinity;
  return dY + u * dX;
}
