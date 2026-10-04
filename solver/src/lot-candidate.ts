/**
 * Offline two-sided candidate research, not an accepted settlement rule.
 * Exact spot exchange lots remove minority spot rounding; dominant payments
 * retain rational WAD numerators. Compare claims, ceil transfers and immediate
 * floor redemption, and keep backing failures visible. Supplied data/IDs are
 * unauthenticated. Finite capacity and indivisible lots change the paper model.
 */
import {
  MAX_INPUT, MAX_OUTPUT, MIN_PRICE, MAX_PRICE_EXCLUSIVE, type PoolSnapshot,
} from './execution.ts';
import {
  WAD, MAX_BIDS, executionTable, optimize, pivots, concavity, type Domain, type Bid,
} from './discrete-research.ts';

export const MAX_SIDE_LOTS = 32;
export const MAX_RESIDUAL_LOTS = 32;
const Q192 = 1n << 192n;

export interface LotBid extends Bid { sellingCurrency0: boolean }
export interface LotFrame { price: bigint; sell0: Domain; sell1: Domain }
export interface LotOutcome {
  orderIds: string[];
  sides: boolean[];
  dominantSellsCurrency0: boolean;
  eligible: boolean[];
  eligibleLots: [number, number];
  spend: bigint[];
  paymentNumerator: bigint[];
  ceilPayment: bigint[];
  floorPayment: bigint[];
  unspent: bigint[];
  minimumPayment: bigint[];
  /** Dominant-side leave-one-out welfare with minority augmentation fixed.
   * Minority/ineligible entries are zero placeholders, not recomputed auctions. */
  withoutWelfareNumerator: bigint[];
  welfareNumerator: bigint;
  augmented: Domain;
  minorityInput: bigint;
  minorityPayment: bigint;
  swapInput: bigint;
  swapOutput: bigint;
  /** Per-currency assets remaining after paying raw rational claims. */
  claimResidualNumerator: [bigint, bigint];
  ceilResidual: [bigint, bigint];
  floorIRFailures: number[];
  certified: boolean;
  claimsFunded: boolean;
  ceilFunded: boolean;
  quantityEvaluations: number;
}

function priceCheck(price: bigint): void {
  if (typeof price !== 'bigint' || price < MIN_PRICE || price >= MAX_PRICE_EXCLUSIVE) {
    throw new RangeError('price outside candidate execution domain');
  }
}
function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) { const remainder = a % b; a = b; b = remainder; }
  return a;
}

/** Smallest positive integer exchange lots satisfying lot1/lot0 = P^2/2^192.
 * Oversized values are diagnostic BigInts; fits=false prohibits execution. */
export function spotLots(price: bigint, multiple = 1n): { lot0: bigint; lot1: bigint; fits: boolean } {
  priceCheck(price);
  if (typeof multiple !== 'bigint' || multiple <= 0n || multiple > MAX_INPUT) {
    throw new RangeError('invalid fixed lot multiple');
  }
  const squared = price * price;
  const divisor = gcd(squared, Q192);
  const lot0 = Q192 / divisor * multiple;
  const lot1 = squared / divisor * multiple;
  return { lot0, lot1, fits: lot0 <= MAX_INPUT && lot1 <= MAX_INPUT };
}

/** The lot multiple and limits must be chosen independently of order reports. */
export function buildLotFrame(
  s: PoolSnapshot, limits: readonly [bigint, bigint], multiple: bigint, residualLots: number,
): LotFrame {
  if (!Number.isSafeInteger(residualLots) || residualLots < 0 || residualLots > MAX_RESIDUAL_LOTS) {
    throw new RangeError('candidate residual table cap exceeded');
  }
  const lots = spotLots(s.sqrtPriceX96, multiple);
  if (!lots.fits) throw new RangeError('exact spot lots exceed uint96 input domain');
  priceCheck(limits[0]); priceCheck(limits[1]);
  if (limits[0] >= s.sqrtPriceX96 || limits[1] <= s.sqrtPriceX96) throw new RangeError('invalid candidate limit direction');
  const capacity = (lot: bigint) => Number(MAX_INPUT / lot < BigInt(residualLots)
    ? MAX_INPUT / lot : BigInt(residualLots));
  const frame = { price: s.sqrtPriceX96,
    sell0: executionTable(s, true, limits[0], lots.lot0, capacity(lots.lot0)),
    sell1: executionTable(s, false, limits[1], lots.lot1, capacity(lots.lot1)) };
  validateFrame(frame);
  return frame;
}

function validateFrame(f: LotFrame): void {
  priceCheck(f.price);
  for (const d of [f.sell0, f.sell1]) {
    optimize(d, []); // Same representation checks as the independent laboratory.
    if (d.output.length > MAX_RESIDUAL_LOTS + 1) throw new RangeError('candidate residual table cap exceeded');
  }
  if (f.sell0.lotSize * f.price * f.price !== f.sell1.lotSize * Q192) {
    throw new RangeError('lots do not exchange exactly at opening spot');
  }
}

/** Certificate is fixed by both supplied curve tables, independent of bids.
 * It is only a local table property, not a two-sided incentive proof. */
export function certifiedLotFrame(f: LotFrame): boolean {
  validateFrame(f);
  return [f.sell0, f.sell1].every((d, side) => {
    const c = concavity(d);
    const otherLot = side === 0 ? f.sell1.lotSize : f.sell0.lotSize;
    return c.concave && (c.supportedLots === 0 || d.output[1]! <= otherLot);
  });
}

/** Complete candidate calculation, including funding diagnostics. A failed
 * diagnostic is not repaired by clamping, swapping partially or subsidizing. */
export function solveLotCandidate(
  f: LotFrame, bids: readonly LotBid[], method: 'scan' | 'exhaustive' = 'scan',
): LotOutcome {
  validateFrame(f);
  if (bids.length > MAX_BIDS) throw new RangeError('candidate bid cap exceeded');
  const ids = new Set<string>();
  const budget: [bigint, bigint] = [0n, 0n];
  for (const b of bids) {
    if (typeof b.sellingCurrency0 !== 'boolean' || ids.has(b.id)) throw new RangeError('invalid side or duplicate identity');
    ids.add(b.id);
    const side = b.sellingCurrency0 ? 0 : 1;
    optimize(side === 0 ? f.sell0 : f.sell1, [b]);
    budget[side] += b.budget;
    if (budget[side] > MAX_INPUT) throw new RangeError('candidate aggregate input exceeded');
  }
  const eligible = bids.map(b => b.sellingCurrency0
    ? b.ask * Q192 <= f.price * f.price * WAD
    : b.ask * f.price * f.price <= Q192 * WAD);
  const totals: [number, number] = [0, 0];
  const cap = bids.map((b, i) => {
    if (!eligible[i]) return 0;
    const side = b.sellingCurrency0 ? 0 : 1;
    const lot = side === 0 ? f.sell0.lotSize : f.sell1.lotSize;
    const count = b.budget / lot;
    if (count > BigInt(MAX_SIDE_LOTS)) throw new RangeError('candidate side lot cap exceeded');
    totals[side] += Number(count);
    if (totals[side] > MAX_SIDE_LOTS) throw new RangeError('candidate side lot cap exceeded');
    return Number(count);
  });
  // Exact spot lots have equal spot value. Compare rounded eligible supply
  // in lots, with the published tie to currency0; sub-lot budgets are refunded.
  const down = totals[0] >= totals[1];
  const d = down ? f.sell0 : f.sell1;
  const outLot = down ? f.sell1.lotSize : f.sell0.lotSize;
  const m = down ? totals[1] : totals[0];
  const fullEnd = m + d.output.length - 1;
  const end = Number(MAX_INPUT / d.lotSize < BigInt(fullEnd) ? MAX_INPUT / d.lotSize : BigInt(fullEnd));
  const augmented: Domain = { lotSize: d.lotSize, output: Array.from({ length: end + 1 }, (_, q) => {
    if (q <= m) return BigInt(q) * outLot;
    const poolOutput = d.output[q - m];
    if (poolOutput === null) return null;
    const output = BigInt(m) * outLot + poolOutput;
    return output <= MAX_OUTPUT ? output : null;
  }) };
  const dominant = bids.map((b, i) => ({ b, i })).filter(({ b, i }) => b.sellingCurrency0 === down && eligible[i]);
  const result = pivots(augmented, dominant.map(({ b }) => b), method);
  const spend = bids.map(() => 0n), pay = bids.map(() => 0n), without = bids.map(() => 0n);
  dominant.forEach(({ i }, j) => {
    spend[i] = result.fill[j]; pay[i] = result.paymentNumerator[j]; without[i] = result.withoutWelfareNumerator[j];
  });
  bids.forEach((b, i) => {
    if (b.sellingCurrency0 !== down && eligible[i]) {
      spend[i] = BigInt(cap[i]) * outLot;
      pay[i] = BigInt(cap[i]) * d.lotSize * WAD;
    }
  });
  const minorityPayment = BigInt(m) * d.lotSize;
  if (result.totalInput < minorityPayment) throw new Error('selected input cannot fund minority');
  const swapInput = result.totalInput - minorityPayment;
  const swapIndex = Number(swapInput / d.lotSize);
  const swapOutput = d.output[swapIndex];
  if (swapOutput === undefined || swapOutput === null) throw new Error('selected residual is not a complete quote');
  const ceilPay = pay.map(x => (x + WAD - 1n) / WAD);
  const floorPay = pay.map(x => x / WAD);
  const minPay = bids.map((b, i) => (b.ask * spend[i] + WAD - 1n) / WAD);
  const residual = (payment: readonly bigint[]): [bigint, bigint] => {
    const assets: [bigint, bigint] = [0n, 0n];
    bids.forEach((b, i) => {
      const side = b.sellingCurrency0 ? 0 : 1;
      assets[side] += spend[i] * WAD;
      assets[side === 0 ? 1 : 0] -= payment[i];
    });
    assets[down ? 0 : 1] -= swapInput * WAD;
    assets[down ? 1 : 0] += swapOutput * WAD;
    return assets;
  };
  const claimResidual = residual(pay);
  const ceilResidual = residual(ceilPay.map(x => x * WAD)).map(x => x / WAD) as [bigint, bigint];
  return { orderIds: bids.map(b => b.id), sides: bids.map(b => b.sellingCurrency0),
    dominantSellsCurrency0: down, eligible, eligibleLots: totals, spend,
    paymentNumerator: pay, ceilPayment: ceilPay, floorPayment: floorPay,
    unspent: bids.map((b, i) => b.budget - spend[i]), minimumPayment: minPay,
    withoutWelfareNumerator: without, welfareNumerator: result.welfareNumerator, augmented,
    minorityInput: BigInt(m) * outLot, minorityPayment, swapInput, swapOutput,
    claimResidualNumerator: claimResidual, ceilResidual,
    floorIRFailures: floorPay.map((x, i) => x < minPay[i] ? i : -1).filter(i => i !== -1),
    certified: certifiedLotFrame(f), claimsFunded: claimResidual.every(x => x >= 0n),
    ceilFunded: ceilResidual.every(x => x >= 0n), quantityEvaluations: result.quantityEvaluations };
}

export type Variant = 'claims' | 'ceil' | 'floor-redemption';

/** Compare payment representations without silently refunding or clamping a
 * failed candidate. Funding/certification flags must be inspected separately. */
export function candidatePayments(r: LotOutcome, variant: Variant): bigint[] {
  if (variant === 'claims') return [...r.paymentNumerator];
  if (variant === 'ceil') return r.ceilPayment.map(x => x * WAD);
  if (variant === 'floor-redemption') return r.floorPayment.map(x => x * WAD);
  throw new RangeError('unknown candidate payment variant');
}

/** Utility in WAD^2-scaled raw output units, using NET true-budget/direction
 * conditions. null is catastrophic utility; gross input alone is not the test.
 * Fractional claims are assumed to have exact nominal value only in claims mode. */
export function netUtility(
  bids: readonly LotBid[], r: LotOutcome, controlledIds: readonly string[],
  trueSellsCurrency0: boolean, trueAsk: bigint, trueBudget: bigint, variant: Variant,
): bigint | null {
  if (typeof trueSellsCurrency0 !== 'boolean' || typeof trueAsk !== 'bigint' || trueAsk < 0n || trueAsk >= 1n << 128n
      || typeof trueBudget !== 'bigint' || trueBudget < 0n || trueBudget > MAX_INPUT) throw new RangeError('invalid true type');
  if (bids.length !== r.spend.length || bids.length !== r.paymentNumerator.length) throw new RangeError('outcome shape mismatch');
  if (bids.some((b, i) => b.id !== r.orderIds[i] || b.sellingCurrency0 !== r.sides[i])) {
    throw new RangeError('outcome identity/direction mismatch');
  }
  const ids = new Set(controlledIds);
  if (ids.size !== controlledIds.length || controlledIds.some(id => !bids.some(b => b.id === id))) {
    throw new RangeError('invalid controlled identities');
  }
  const payment = candidatePayments(r, variant);
  const delta: [bigint, bigint] = [0n, 0n];
  bids.forEach((b, i) => {
    if (!ids.has(b.id)) return;
    const side = b.sellingCurrency0 ? 0 : 1;
    delta[side] -= r.spend[i] * WAD;
    delta[side === 0 ? 1 : 0] += payment[i];
  });
  const input = delta[trueSellsCurrency0 ? 0 : 1];
  const output = delta[trueSellsCurrency0 ? 1 : 0];
  if (-input > trueBudget * WAD || (input > 0n && output < 0n)) return null;
  return output * WAD + trueAsk * input;
}
