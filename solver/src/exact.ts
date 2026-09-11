/**
 * Exact-integer two-sided solve.
 *
 * `otter.ts` is the reference implementation and works in float64 — good for
 * property testing the mechanism, useless for producing an outcome a contract will
 * accept, because `OtterMath.verify` checks wei-exact bounds.
 *
 * This computes the same mechanism entirely in BigInt, with the same rounding
 * directions as OtterMath.sol, so its output settles on-chain unmodified.
 *
 * Pivots are computed the NAIVE way here: n leave-one-out welfare evaluations,
 * O(n^2 log n). That is deliberate. The layer-cake form from the paper's Lemma 16
 * (see onesided.ts) is 57x faster at n=5,000, but it integrates 2*sqrt(k)*sqrt(t)
 * and carrying that to wei-exactness in fixed point is a different problem from
 * carrying it to 1e-10 in floats. For batch sizes that fit in a block — 630, see
 * the gas curve — the naive path runs in milliseconds. Correctness first.
 */

import {
  WAD,
  mulDivDown,
  mulDivUp,
  fTildeDown,
  fTildeUp,
  fTildeSettleable,
  spotDown,
  verify,
  type Curve,
  type Fill,
} from "./fixed.ts";

/** Integer square root, Newton's method. */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export interface Order {
  trader: string;
  sellingCurrency0: boolean;
  /** WAD-scaled reservation value per unit sold, denominated in the token received */
  ask: bigint;
  budget: bigint;
}

export interface Outcome {
  dominantSellsCurrency0: boolean;
  y: bigint[];
  x: bigint[];
  burn: bigint;
  /** how far the clamp moved each payment from the raw mechanism value */
  clampDisplacement: bigint[];
  diagnostics: {
    dDominant: bigint;
    dMinority: bigint;
    M: bigint;
    totalIn: bigint;
    totalPaid: bigint;
  };
}

interface Bid {
  index: number;
  ask: bigint;
  budget: bigint;
}

/**
 * K(v) = sup{ y : F~'(y) >= v/WAD }, the inverse marginal, in exact integers.
 * Below M the marginal is flat at sigma0, so any eligible ask can fill to M and
 * beyond; above M it is k/(y0 + y - M)^2.
 */
function K(c: Curve, ask: bigint): bigint {
  if (ask <= 0n) return (1n << 200n); // effectively unbounded
  const kWad = c.x0 * c.y0 * WAD;
  const root = isqrt(kWad / ask);
  const k = c.M - c.y0 + root;
  return k < 0n ? 0n : k;
}

/**
 * Allocation rule (Fact 11). Fill in ascending ask order, each bidder up to K(ask).
 * Using K rather than a strict marginal-price test is what implements the paper's
 * quantity-maximising tie rule at equality — and is what makes Fact 13 (Q_Y >= M)
 * fall out, since every eligible ask has K(ask) >= K(sigma0) = M.
 */
function allocate(c: Curve, bids: Bid[]): Map<number, bigint> {
  const order = [...bids].sort((a, b) => (a.ask < b.ask ? -1 : a.ask > b.ask ? 1 : 0));
  // keyed by ORDER index, not bid position: the two differ whenever the batch
  // mixes sides, which is every two-sided batch
  const alloc = new Map<number, bigint>();
  for (const b of bids) alloc.set(b.index, 0n);
  let cum = 0n;
  for (const b of order) {
    if (!eligibleAsk(c, b.ask)) continue;
    const room = K(c, b.ask) - cum;
    if (room <= 0n) break; // K is nonincreasing in ask; no later bidder has room
    const fill = b.budget < room ? b.budget : room;
    alloc.set(b.index, fill);
    cum += fill;
  }
  return alloc;
}

const eligibleAsk = (c: Curve, ask: bigint) => mulDivUp(ask, c.y0, WAD) <= c.x0;

/** SW = F~(Y) - sum ask_i * y_i, at the welfare-maximising allocation. */
function welfare(c: Curve, bids: Bid[]): bigint {
  const alloc = allocate(c, bids);
  let cost = 0n;
  let total = 0n;
  for (const b of bids) {
    const yi = alloc.get(b.index) ?? 0n;
    cost += mulDivDown(b.ask, yi, WAD);
    total += yi;
  }
  return fTildeDown(c, total) - cost;
}

/**
 * Solve a batch against a pool, exactly.
 *
 * Raw Clarke payments are clamped into the feasible integer set:
 *   lower  = ceil(ask_i * y_i / WAD)              individual rationality
 *   upper  = min(spotDown(y_i), F~s(Y) - F~u(Y - y_i))   Theorem 12(b)
 * The clamp is reported per order in `clampDisplacement`, because a clamp that
 * moves payments by more than a few wei would mean the mechanism and the on-chain
 * bounds disagree about something real, and that should be visible rather than
 * silently absorbed.
 */
export function solveExact(r0: bigint, r1: bigint, orders: Order[]): Outcome {
  // eligibility and side totals, in each side's own orientation
  const cY: Curve = { x0: r1, y0: r0, M: 0n }; // currency0-sellers
  const cX: Curve = { x0: r0, y0: r1, M: 0n }; // currency1-sellers

  let dY = 0n;
  let dX = 0n;
  for (const o of orders) {
    if (o.sellingCurrency0) {
      if (eligibleAsk(cY, o.ask)) dY += o.budget;
    } else if (eligibleAsk(cX, o.ask)) dX += o.budget;
  }

  // sell-currency0 dominant iff D_Y >= rho0 * D_X, ties to currency0 (eq. 10)
  const dominantSellsCurrency0 = dY * r1 >= r0 * dX;

  const c: Curve = dominantSellsCurrency0
    ? { x0: r1, y0: r0, M: 0n }
    : { x0: r0, y0: r1, M: 0n };

  const dMinority = dominantSellsCurrency0 ? dX : dY;
  c.M = mulDivDown(c.y0, dMinority, c.x0);

  const y = new Array<bigint>(orders.length).fill(0n);
  const x = new Array<bigint>(orders.length).fill(0n);
  const clampDisplacement = new Array<bigint>(orders.length).fill(0n);

  // minority side: every eligible order fills in full at the initial spot price
  const cMin: Curve = dominantSellsCurrency0 ? cX : cY;
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    if (o.sellingCurrency0 === dominantSellsCurrency0) continue;
    if (!eligibleAsk(cMin, o.ask)) continue;
    y[i] = o.budget;
    x[i] = mulDivDown(c.y0, o.budget, c.x0);
  }

  // dominant side: one-sided VCG on the augmented curve
  const bids: Bid[] = [];
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].sellingCurrency0 !== dominantSellsCurrency0) continue;
    bids.push({ index: i, ask: orders[i].ask, budget: orders[i].budget });
  }

  const alloc = allocate(c, bids);
  let totalIn = 0n;
  for (const b of bids) totalIn += alloc.get(b.index) ?? 0n;

  const W = welfare(c, bids);
  const available = fTildeSettleable(c, totalIn);

  for (const b of bids) {
    const yi = alloc.get(b.index) ?? 0n;
    y[b.index] = yi;
    if (yi === 0n) continue;

    const without = bids.filter((o) => o.index !== b.index);
    const phi = W - welfare(c, without);

    const raw = mulDivUp(b.ask, yi, WAD) + (phi > 0n ? phi : 0n);

    const lower = mulDivUp(b.ask, yi, WAD);
    const marginal = available - fTildeUp(c, totalIn - yi);
    const spot = spotDown(c, yi);
    let upper = marginal < spot ? marginal : spot;
    if (upper < 0n) upper = 0n;

    const clamped = raw < lower ? lower : raw > upper ? upper : raw;
    x[b.index] = clamped;
    clampDisplacement[b.index] = clamped - raw;
  }

  let totalPaid = 0n;
  for (const b of bids) totalPaid += x[b.index];

  return {
    dominantSellsCurrency0,
    y,
    x,
    burn: available > totalPaid ? available - totalPaid : 0n,
    clampDisplacement,
    diagnostics: {
      dDominant: dominantSellsCurrency0 ? dY : dX,
      dMinority,
      M: c.M,
      totalIn,
      totalPaid,
    },
  };
}

/** Run the outcome through the same checks OtterMath.verify performs. */
export function selfCheck(r0: bigint, r1: bigint, orders: Order[], out: Outcome) {
  const c: Curve = out.dominantSellsCurrency0
    ? { x0: r1, y0: r0, M: 0n }
    : { x0: r0, y0: r1, M: 0n };
  c.M = mulDivDown(c.y0, out.diagnostics.dMinority, c.x0);

  const fills: Fill[] = orders.map((o, i) =>
    o.sellingCurrency0 === out.dominantSellsCurrency0
      ? { ask: o.ask, budget: o.budget, y: out.y[i], x: out.x[i] }
      : { ask: 0n, budget: 0n, y: 0n, x: 0n },
  );
  return verify(c, fills);
}
