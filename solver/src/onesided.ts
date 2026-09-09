import { AugmentedCurve } from "./curve.ts";

export interface Bid {
  /** per-unit ask, denominated in the output token */
  ask: number;
  /** budget, denominated in the input token */
  budget: number;
}

export interface OneSidedResult {
  /** y*_i, indexed as the input bids */
  alloc: number[];
  /** x*_i, indexed as the input bids */
  pay: number[];
  /** phi_i = W(S) - W(S \ {i}) */
  pivot: number[];
  /** Y* = sum of alloc */
  totalIn: number;
  /** W(S) */
  welfare: number;
}

const EPS = 1e-12;

/**
 * Allocation rule (Fact 11's efficient implementation).
 *
 * Fill in nondecreasing ask order. A bidder with ask v can be filled up to the point
 * K(v), which by definition of K is the largest total input at which the marginal price
 * is still >= v. Using K -- rather than a strict `marginal > ask` stopping test --
 * is what implements the paper's quantity-maximising tie rule at equality, and is
 * exactly what makes Fact 13 (Q_Y >= M) fall out: every eligible bidder has ask <= sigma0,
 * and K(sigma0) = M, so the fill cannot stop short of M while eligible capacity remains.
 */
export function allocate(curve: AugmentedCurve, bids: Bid[]): { alloc: number[]; totalIn: number } {
  const idx = bids.map((_, i) => i).sort((a, b) => bids[a].ask - bids[b].ask);
  const alloc = new Array(bids.length).fill(0);
  let cum = 0;
  for (const i of idx) {
    const { ask, budget } = bids[i];
    if (ask > curve.sigma0 + EPS) break; // ineligible: marginal price never reaches its ask
    const room = curve.K(ask) - cum;
    if (room <= EPS) break; // K is nonincreasing in ask, so no later bidder has room either
    const fill = Math.min(budget, room);
    alloc[i] = fill;
    cum += fill;
  }
  return { alloc, totalIn: cum };
}

/** SW = F~(sum y_i) - sum ask_i * y_i, evaluated at the welfare-maximising allocation. */
export function welfare(curve: AugmentedCurve, bids: Bid[]): number {
  const { alloc, totalIn } = allocate(curve, bids);
  let cost = 0;
  for (let i = 0; i < bids.length; i++) cost += bids[i].ask * alloc[i];
  return curve.F(totalIn) - cost;
}

/** Clarke pivots the direct way: n leave-one-out welfare computations. O(n^2 log n). */
export function pivotsNaive(curve: AugmentedCurve, bids: Bid[]): number[] {
  const W = welfare(curve, bids);
  return bids.map((_, i) => {
    const without = bids.filter((_, j) => j !== i);
    return W - welfare(curve, without);
  });
}

// ---------------------------------------------------------------------------
// Layer-cake pivots. This is the closed form sitting inside the proof of the
// paper's Lemma 16, read as an algorithm:
//
//   phi_i = int_{ask_i}^{sigma0}  min{ q_i, ( g(t) + q_i )_+ }  dt,
//   g(t)  = K(t) - D_S(t),   D_S(t) = sum_j q_j * 1{ ask_j <= t }
//
// g is nonincreasing: K strictly decreases, D_S is a nondecreasing step function.
// So the integrand is q_i above the level set where g >= 0, tapers linearly in g
// down to the level g = -q_i, and is 0 below. Precompute the breakpoints once,
// and each pivot costs one binary search plus O(pieces touched).
// ---------------------------------------------------------------------------

interface Piece {
  lo: number; // t range (lo, hi]
  hi: number;
  D: number; // D_S is constant = D on this piece
}

export class LayerCake {
  private curve: AugmentedCurve;
  private pieces: Piece[];
  /** t_a = sup{ t : g(t) >= 0 }, global, independent of any bidder. */
  readonly tA: number;

  constructor(curve: AugmentedCurve, bids: Bid[]) {
    this.curve = curve;
    const s0 = curve.sigma0;

    // D_S over (0, sigma0] is a step function jumping at each eligible ask.
    const jumps = new Map<number, number>();
    for (const b of bids) {
      if (b.ask > s0 + EPS) continue; // never enters the integration range
      const key = Math.min(b.ask, s0);
      jumps.set(key, (jumps.get(key) ?? 0) + b.budget);
    }
    const cuts = [...jumps.keys()].sort((a, b) => a - b);

    this.pieces = [];
    let lo = 0;
    let D = 0;
    for (const c of cuts) {
      if (c > lo) this.pieces.push({ lo, hi: c, D });
      D += jumps.get(c)!;
      lo = c;
    }
    if (s0 > lo) this.pieces.push({ lo, hi: s0, D });

    this.tA = this.solveLevel(0);
  }

  /** sup{ t in (0, sigma0] : g(t) >= level }, clamped to sigma0. */
  solveLevel(level: number): number {
    const s0 = this.curve.sigma0;
    let best = 0;
    for (const p of this.pieces) {
      // g decreasing on the piece, so test the right endpoint first.
      if (this.curve.K(p.hi) - p.D >= level) {
        best = p.hi;
        continue;
      }
      const t = this.curve.Kinv(p.D + level);
      if (t === Infinity) {
        best = p.hi;
        continue;
      }
      return Math.max(best, Math.min(Math.max(t, p.lo), p.hi));
    }
    return Math.min(best, s0);
  }

  /** int_lo^hi g(t) dt, walking the D-pieces. */
  integrateG(lo: number, hi: number): number {
    if (hi <= lo) return 0;
    let acc = 0;
    for (const p of this.pieces) {
      const a = Math.max(lo, p.lo);
      const b = Math.min(hi, p.hi);
      if (b <= a) continue;
      acc += this.curve.IK(b) - this.curve.IK(a) - p.D * (b - a);
    }
    return acc;
  }

  pivot(bid: Bid): number {
    const s0 = this.curve.sigma0;
    const v = bid.ask;
    const q = bid.budget;
    if (v > s0 + EPS || q <= 0) return 0;

    // Region 1: g >= 0, integrand is the flat cap q.
    const flatHi = Math.min(s0, this.tA);
    let phi = q * Math.max(0, flatHi - v);

    // Region 2: -q <= g < 0, integrand is g + q.
    const tB = Math.min(s0, this.solveLevel(-q));
    const lo = Math.max(v, this.tA);
    const hi = Math.min(s0, tB);
    if (hi > lo) phi += this.integrateG(lo, hi) + q * (hi - lo);

    return phi;
  }
}

/** Full one-sided VCG outcome using the layer-cake pivots. */
export function runOneSided(curve: AugmentedCurve, bids: Bid[]): OneSidedResult {
  const { alloc, totalIn } = allocate(curve, bids);
  const lc = new LayerCake(curve, bids);
  const pivot = bids.map((b) => lc.pivot(b));
  const pay = bids.map((b, i) => b.ask * alloc[i] + pivot[i]);
  let cost = 0;
  for (let i = 0; i < bids.length; i++) cost += bids[i].ask * alloc[i];
  return { alloc, pay, pivot, totalIn, welfare: curve.F(totalIn) - cost };
}
