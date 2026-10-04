/**
 * Offline integer-cost-per-lot laboratory, NOT a selected production mechanism.
 * This changes the admissible cost representation; it does not silently round
 * original WAD asks. Exact exchange lots still limit generic price support.
 * A finite one-sided analytical argument is in CHECKPOINT_4G.md. The two-sided
 * calculation and finite tests do not establish full UIC or builder resistance.
 */
import { MAX_INPUT, MAX_OUTPUT } from './execution.ts';
import { WAD, MAX_BIDS, optimize, pivots, concavity, type Domain } from './discrete-research.ts';
import { MAX_SIDE_LOTS, certifiedLotFrame, spotLots, type LotFrame } from './lot-candidate.ts';
import { fraction, addFraction, multiplyFraction, type Fraction } from './representation-research.ts';

/** Laboratory bound permits the reused index-space optimizer's uint128 WAD
 * ask. This is a cost PER LOT in whole output units, not a raw-token WAD ask. */
export const MAX_COST_PER_LOT = ((1n << 128n) - 1n) / WAD;
export interface CostBid { id: string; costPerLot: bigint; budget: bigint }
export interface SideCostBid extends CostBid { sellingCurrency0: boolean }
export interface CostPivot {
  fillLots: bigint[];
  spend: bigint[];
  payment: bigint[];
  minimumPayment: bigint[];
  unspent: bigint[];
  output: bigint;
  welfare: bigint;
  withoutWelfare: bigint[];
  /** Positive means a deficit. No clamping or refund-on-failure policy. */
  deficit: bigint;
  certified: boolean;
  quantityEvaluations: number;
}

function problem(d: Domain, bids: readonly CostBid[]) {
  optimize(d, []); // Validate actual raw input/output domain before indexing.
  const records = bids.map(b => {
    if (typeof b.costPerLot !== 'bigint' || b.costPerLot < 0n || b.costPerLot > MAX_COST_PER_LOT
        || typeof b.budget !== 'bigint' || b.budget < 0n || b.budget > MAX_INPUT) {
      throw new RangeError('invalid exact integer cost or raw budget');
    }
    return { id: b.id, ask: b.costPerLot * WAD, budget: b.budget / d.lotSize };
  });
  const indexed = { lotSize: 1n, output: d.output };
  optimize(indexed, records); // Validate IDs, duplicate records and count cap.
  return { indexed, records };
}

export function costPivots(d: Domain, bids: readonly CostBid[], method: 'scan' | 'exhaustive' = 'scan'): CostPivot {
  const { indexed, records } = problem(d, bids);
  const r = pivots(indexed, records, method);
  for (const n of [r.welfareNumerator, ...r.withoutWelfareNumerator, ...r.paymentNumerator]) {
    if (n % WAD !== 0n) throw new Error('integer-cost pivot is not exact');
  }
  const spend = r.fill.map(q => q * d.lotSize), payment = r.paymentNumerator.map(n => n / WAD);
  return { fillLots: r.fill, spend, payment, output: r.output,
    minimumPayment: bids.map((b, i) => b.costPerLot * r.fill[i]),
    unspent: bids.map((b, i) => b.budget - spend[i]), welfare: r.welfareNumerator / WAD,
    withoutWelfare: r.withoutWelfareNumerator.map(n => n / WAD),
    deficit: payment.reduce((a, b) => a + b, 0n) - r.output,
    certified: concavity(d).concave, quantityEvaluations: r.quantityEvaluations };
}

/** Independent finite layer-cake calculation, using only marginal outputs,
 * offered counts and distinct cost/value breakpoints. No quantity optimizer,
 * leave-one-out solve or loop over unbounded price units supplies the result.
 * Supported curve points must be a fixed contiguous integer-concave prefix. */
export function layerCakeWelfare(d: Domain, bids: readonly CostBid[]): bigint {
  problem(d, bids);
  const cert = concavity(d);
  if (!cert.concave) throw new RangeError('layer-cake requires a certified fixed prefix');
  const margins = Array.from({ length: cert.supportedLots }, (_, q) => d.output[q + 1]! - d.output[q]!);
  const levels = [...new Set([0n, ...margins, ...bids.map(b => b.costPerLot)])]
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  let value = 0n;
  for (let i = 0; i + 1 < levels.length; i++) {
    const t = levels[i], width = levels[i + 1] - t;
    const demand = BigInt(margins.filter(m => m > t).length);
    const supply = bids.reduce((n, b) => n + (b.costPerLot <= t ? b.budget / d.lotSize : 0n), 0n);
    value += width * (demand < supply ? demand : supply);
  }
  return value;
}

/** Exact raw-WAD encoding exists only for some cost/lot pairs. A missing or
 * oversized encoding is diagnostic; never floor/ceil it into an order. */
export function rawAskEncoding(costPerLot: bigint, inputLot: bigint) {
  if (typeof costPerLot !== 'bigint' || costPerLot < 0n || costPerLot > MAX_COST_PER_LOT
      || typeof inputLot !== 'bigint' || inputLot <= 0n || inputLot > MAX_INPUT) {
    throw new RangeError('invalid cost encoding');
  }
  const numerator = costPerLot * WAD;
  const exact = numerator % inputLot === 0n;
  const value = numerator / inputLot;
  const fits = value < 1n << 128n;
  return { exact, fits, ask: exact && fits ? value : null };
}

/** Smallest exact reciprocal exchange lots whose cost is integer for EVERY
 * original WAD ask in BOTH directions. For primitive coprime lots D,N, any
 * exact pair is k(D,N). WAD | D*k and WAD | N*k iff WAD | k (Bezout).
 * Oversized diagnostic quantities are never clamped into an executable lot. */
export const wadPreservingLots = (price: bigint) => spotLots(price, WAD);

export function rawCostEncoding(rawWadAsk: bigint, inputLot: bigint) {
  if (typeof rawWadAsk !== 'bigint' || rawWadAsk < 0n || rawWadAsk >= 1n << 128n
      || typeof inputLot !== 'bigint' || inputLot <= 0n || inputLot > MAX_INPUT) {
    throw new RangeError('invalid original cost encoding');
  }
  const numerator = rawWadAsk * inputLot;
  const exact = numerator % WAD === 0n;
  const value = numerator / WAD;
  return { exact, fitsCostDomain: exact && value <= MAX_COST_PER_LOT, costPerLot: exact ? value : null };
}

export interface CostOutcome {
  orderIds: string[];
  sides: boolean[];
  inputLots: [bigint, bigint];
  dominantSellsCurrency0: boolean;
  eligible: boolean[];
  eligibleLots: [number, number];
  spend: bigint[];
  payment: bigint[];
  minimumPayment: bigint[];
  unspent: bigint[];
  /** Fixed-dominance dominant counterfactuals; zero placeholders elsewhere. */
  withoutWelfare: bigint[];
  welfare: bigint;
  augmented: Domain;
  swapInput: bigint;
  swapOutput: bigint;
  residual: [bigint, bigint];
  certified: boolean;
  funded: boolean;
  quantityEvaluations: number;
}

/** Both directions, exact reciprocal lot matching and exact integer pivots.
 * Neither failed certification nor a deficit changes allocation or payment.
 * Such outputs remain diagnostics, not an accepted executable settlement. */
export function solveCostCandidate(f: LotFrame, bids: readonly SideCostBid[],
  method: 'scan' | 'exhaustive' = 'scan'): CostOutcome {
  const certified = certifiedLotFrame(f);
  if (bids.length > MAX_BIDS) throw new RangeError('cost candidate bid cap exceeded');
  const ids = new Set<string>(), budgets: [bigint, bigint] = [0n, 0n];
  for (const b of bids) {
    if (typeof b.sellingCurrency0 !== 'boolean' || ids.has(b.id)) throw new RangeError('invalid side or duplicate ID');
    ids.add(b.id);
    const side = b.sellingCurrency0 ? 0 : 1;
    problem(side === 0 ? f.sell0 : f.sell1, [b]);
    budgets[side] += b.budget;
    if (budgets[side] > MAX_INPUT) throw new RangeError('cost candidate aggregate budget exceeded');
  }
  const eligible = bids.map(b => b.costPerLot <= (b.sellingCurrency0 ? f.sell1.lotSize : f.sell0.lotSize));
  const totals: [number, number] = [0, 0];
  const caps = bids.map((b, i) => {
    if (!eligible[i]) return 0;
    const side = b.sellingCurrency0 ? 0 : 1, lot = side === 0 ? f.sell0.lotSize : f.sell1.lotSize;
    const count = b.budget / lot;
    if (count > BigInt(MAX_SIDE_LOTS)) throw new RangeError('cost candidate side cap exceeded');
    totals[side] += Number(count);
    if (totals[side] > MAX_SIDE_LOTS) throw new RangeError('cost candidate side cap exceeded');
    return Number(count);
  });
  const down = totals[0] >= totals[1], domain = down ? f.sell0 : f.sell1;
  const oppositeLot = down ? f.sell1.lotSize : f.sell0.lotSize, minorityLots = down ? totals[1] : totals[0];
  const end = minorityLots + domain.output.length - 1;
  const capped = Number(MAX_INPUT / domain.lotSize < BigInt(end) ? MAX_INPUT / domain.lotSize : BigInt(end));
  const augmented: Domain = { lotSize: domain.lotSize, output: Array.from({ length: capped + 1 }, (_, q) => {
    if (q <= minorityLots) return BigInt(q) * oppositeLot;
    const tail = domain.output[q - minorityLots];
    if (tail === null) return null;
    const output = BigInt(minorityLots) * oppositeLot + tail;
    return output <= MAX_OUTPUT ? output : null;
  }) };
  const dominant = bids.map((b, i) => ({ b, i })).filter(({ b, i }) => b.sellingCurrency0 === down && eligible[i]);
  const r = costPivots(augmented, dominant.map(x => x.b), method);
  const spend = bids.map(() => 0n), payment = bids.map(() => 0n), without = bids.map(() => 0n);
  dominant.forEach(({ i }, j) => { spend[i] = r.spend[j]; payment[i] = r.payment[j]; without[i] = r.withoutWelfare[j]; });
  bids.forEach((b, i) => {
    if (b.sellingCurrency0 !== down && eligible[i]) {
      spend[i] = BigInt(caps[i]) * oppositeLot; payment[i] = BigInt(caps[i]) * domain.lotSize;
    }
  });
  const total = r.spend.reduce((a, b) => a + b, 0n);
  const swapInput = total - BigInt(minorityLots) * domain.lotSize;
  if (swapInput < 0n) throw new Error('cost candidate minority funding invariant');
  const swapOutput = domain.output[Number(swapInput / domain.lotSize)];
  if (swapOutput === null || swapOutput === undefined) throw new Error('cost candidate incomplete residual');
  const residual: [bigint, bigint] = [0n, 0n];
  bids.forEach((b, i) => {
    const side = b.sellingCurrency0 ? 0 : 1;
    residual[side] += spend[i]; residual[side === 0 ? 1 : 0] -= payment[i];
  });
  residual[down ? 0 : 1] -= swapInput; residual[down ? 1 : 0] += swapOutput;
  const inputLots: [bigint, bigint] = [f.sell0.lotSize, f.sell1.lotSize];
  return { orderIds: bids.map(b => b.id), sides: bids.map(b => b.sellingCurrency0), inputLots,
    dominantSellsCurrency0: down, eligible, eligibleLots: totals, spend, payment,
    minimumPayment: bids.map((b, i) => b.costPerLot * (spend[i] / inputLots[b.sellingCurrency0 ? 0 : 1])),
    unspent: bids.map((b, i) => b.budget - spend[i]), withoutWelfare: without, welfare: r.welfare,
    augmented, swapInput, swapOutput, residual, certified, funded: residual.every(n => n >= 0n),
    quantityEvaluations: r.quantityEvaluations };
}

/** NET utility in exact underlying output units. Fractional true costs are
 * accepted to DIAGNOSE users outside the integer grid, not rounded into reports.
 * Whole supplied budgets retain sub-lot remainders. null means catastrophic. */
export function netCostUtility(bids: readonly SideCostBid[], r: CostOutcome, controlled: readonly string[],
  trueDown: boolean, trueCostPerLot: Fraction, trueBudget: bigint): Fraction | null {
  const cost = fraction(trueCostPerLot.numerator, trueCostPerLot.denominator);
  if (cost.numerator < 0n || typeof trueDown !== 'boolean' || typeof trueBudget !== 'bigint'
      || trueBudget < 0n || trueBudget > MAX_INPUT) throw new RangeError('invalid true cost type');
  if (bids.length !== r.spend.length || bids.length !== r.payment.length
      || bids.some((b, i) => b.id !== r.orderIds[i] || b.sellingCurrency0 !== r.sides[i])) {
    throw new RangeError('cost outcome identity/direction mismatch');
  }
  const ids = new Set(controlled);
  if (ids.size !== controlled.length || controlled.some(id => !bids.some(b => b.id === id))) {
    throw new RangeError('invalid controlled cost identities');
  }
  const delta: [bigint, bigint] = [0n, 0n];
  bids.forEach((b, i) => {
    if (!ids.has(b.id)) return;
    const side = b.sellingCurrency0 ? 0 : 1;
    delta[side] -= r.spend[i]; delta[side === 0 ? 1 : 0] += r.payment[i];
  });
  const input = delta[trueDown ? 0 : 1], output = delta[trueDown ? 1 : 0];
  if (-input > trueBudget || (input > 0n && output < 0n)) return null;
  return addFraction(fraction(output), multiplyFraction(cost, fraction(input, r.inputLots[trueDown ? 0 : 1])));
}
