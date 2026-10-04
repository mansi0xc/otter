/**
 * Small-domain mechanism laboratory, NOT a production solver or verifier.
 * Fix one swap direction, a snapshot, price limit, lot size and finite domain
 * independently of reports. Maximize exact linear-cost welfare, then compute
 * leave-one-out pivots without clamps. Diagnose funding and rounding failures.
 * No two-sided mechanism, authenticated data reader, or incentive theorem is
 * supplied by this program. See reviews/CHECKPOINT_4D.md.
 */
import { MAX_INPUT, MAX_OUTPUT, Status, quoteExactInput, type PoolSnapshot, type Quote } from './execution.ts';

export const WAD = 10n ** 18n;
export const MAX_LOTS = 64;
export const MAX_BIDS = 8;
export const MAX_VECTORS = 100_000;
const MAX_ASK = (1n << 128n) - 1n;

export interface Bid {
  /** Supplied 32-byte identity key, not an arrival index or authenticated here. */
  id: string;
  ask: bigint;
  /** Raw input budget; any sub-lot remainder stays unspent. Zero is test-only. */
  budget: bigint;
}
export interface Domain {
  lotSize: bigint;
  /** null means that total input is not executable within the fixed domain. */
  output: readonly (bigint | null)[];
}
export interface ExecutionTable extends Domain {
  quotes: Quote[];
  down: boolean;
  limit: bigint;
}
export interface Allocation {
  fill: bigint[];
  totalInput: bigint;
  output: bigint;
  /** In WAD-scaled raw output units. No per-bid cost rounding. */
  welfareNumerator: bigint;
  costNumerator: bigint;
  evaluated: number;
}
export interface PivotResult extends Allocation {
  withoutWelfareNumerator: bigint[];
  paymentNumerator: bigint[];
  floorPayment: bigint[];
  ceilPayment: bigint[];
  minimumPayment: bigint[];
  unspent: bigint[];
  rawDeficitNumerator: bigint;
  ceilDeficit: bigint;
  floorIRFailures: number[];
  /** Diagnostic raw residual, allowed to be negative; never a funded LP pot. */
  ceilResidual: bigint;
  quantityEvaluations: number;
}

function amount(x: bigint, max: bigint, name: string): void {
  if (typeof x !== 'bigint' || x < 0n || x > max) throw new RangeError(`${name} outside research representation`);
}
const ceil = (x: bigint): bigint => (x + WAD - 1n) / WAD;

/** All quotes start from the SAME supplied snapshot; not sequential swaps. */
export function executionTable(s: PoolSnapshot, down: boolean, limit: bigint, lotSize: bigint, lots: number): ExecutionTable {
  amount(lotSize, MAX_INPUT, 'lot size');
  if (lotSize === 0n || !Number.isSafeInteger(lots) || lots < 0 || lots > MAX_LOTS
      || lotSize * BigInt(lots) > MAX_INPUT) throw new RangeError('research quantity domain exceeded');
  const quotes: Quote[] = [];
  const output: (bigint | null)[] = [];
  for (let i = 0; i <= lots; i++) {
    const input = lotSize * BigInt(i);
    const q = quoteExactInput(s, down, input, limit);
    quotes.push(q);
    // A partial quote is not F(requested). Its actual consumption is retained
    // in diagnostics, but the optimizer cannot spend the unconsumed request.
    output.push(q.status === Status.Complete && q.consumedInput === input ? q.output : null);
  }
  return { lotSize, output, quotes, down, limit };
}

function validate(d: Domain, bids: readonly Bid[]): number[] {
  amount(d.lotSize, MAX_INPUT, 'lot size');
  if (d.lotSize === 0n || d.output.length < 1 || d.output.length > MAX_LOTS + 1
      || d.lotSize * BigInt(d.output.length - 1) > MAX_INPUT || d.output[0] !== 0n) {
    throw new RangeError('invalid fixed research domain');
  }
  for (const x of d.output) if (x !== null) amount(x, MAX_OUTPUT, 'curve output');
  if (bids.length > MAX_BIDS) throw new RangeError('research bid cap exceeded');
  const ids = new Set<string>();
  return bids.map(b => {
    if (!/^0x[0-9a-f]{64}$/.test(b.id) || ids.has(b.id)) throw new RangeError('invalid/duplicate identity key');
    ids.add(b.id);
    amount(b.ask, MAX_ASK, 'ask');
    amount(b.budget, MAX_INPUT, 'budget');
    const lots = b.budget / d.lotSize;
    // Conversion is only a bounded loop index, never unbounded monetary math.
    return Number(lots < BigInt(d.output.length - 1) ? lots : BigInt(d.output.length - 1));
  });
}

function priority(bids: readonly Bid[]): number[] {
  return bids.map((_, i) => i).sort((a, b) => bids[a].ask < bids[b].ask ? -1
    : bids[a].ask > bids[b].ask ? 1 : bids[a].id < bids[b].id ? -1 : 1);
}

/** Quantity scan + cheapest-prefix cost. Valid for linear costs even when
 * output is NOT concave. Never stop at the first negative marginal increment. */
export function optimize(d: Domain, bids: readonly Bid[]): Allocation {
  const caps = validate(d, bids);
  const order = priority(bids);
  let best: Allocation = { fill: bids.map(() => 0n), totalInput: 0n, output: 0n,
    welfareNumerator: 0n, costNumerator: 0n, evaluated: 0 };
  const available = caps.reduce((a, b) => a + b, 0);
  const end = Math.min(d.output.length - 1, available);
  let evaluated = 0;
  for (let q = 0; q <= end; q++) {
    const output = d.output[q];
    if (output === null) continue;
    evaluated++;
    let remaining = q;
    const fill = bids.map(() => 0n);
    let cost = 0n;
    for (const i of order) {
      const lots = Math.min(caps[i], remaining);
      fill[i] = BigInt(lots) * d.lotSize;
      remaining -= lots;
      cost += bids[i].ask * fill[i];
    }
    const value = output * WAD - cost;
    const input = BigInt(q) * d.lotSize;
    if (value > best.welfareNumerator || (value === best.welfareNumerator && input > best.totalInput)) {
      best = { fill, totalInput: input, output, welfareNumerator: value, costNumerator: cost, evaluated: 0 };
    }
  }
  return { ...best, evaluated };
}

/** Independent Cartesian optimizer. Enumerates vectors and directly evaluates
 * the objective; it does not use the cheapest-prefix algorithm. */
export function exhaustive(d: Domain, bids: readonly Bid[]): Allocation {
  const caps = validate(d, bids);
  let vectors = 1;
  for (const cap of caps) {
    vectors *= cap + 1;
    if (vectors > MAX_VECTORS) throw new RangeError('exhaustive vector cap exceeded');
  }
  const tie = bids.map((b, i) => ({ ...b, i })).sort((a, b) =>
    a.ask === b.ask ? (a.id < b.id ? -1 : 1) : (a.ask < b.ask ? -1 : 1));
  let best: Allocation = { fill: bids.map(() => 0n), totalInput: 0n, output: 0n,
    welfareNumerator: 0n, costNumerator: 0n, evaluated: 0 };
  const amounts = bids.map(() => 0n);
  let evaluated = 0;
  const visit = (i: number, lots: number, cost: bigint): void => {
    if (i < bids.length) {
      for (let take = 0; take <= caps[i] && lots + take < d.output.length; take++) {
        amounts[i] = BigInt(take) * d.lotSize;
        visit(i + 1, lots + take, cost + bids[i].ask * amounts[i]);
      }
      return;
    }
    const output = d.output[lots];
    if (output === null) return;
    evaluated++;
    const value = WAD * output - cost;
    const input = BigInt(lots) * d.lotSize;
    let better = value > best.welfareNumerator || (value === best.welfareNumerator && input > best.totalInput);
    if (value === best.welfareNumerator && input === best.totalInput) {
      for (const b of tie) {
        if (amounts[b.i] === best.fill[b.i]) continue;
        better = amounts[b.i] > best.fill[b.i];
        break;
      }
    }
    if (better) best = { fill: [...amounts], totalInput: input, output,
      welfareNumerator: value, costNumerator: cost, evaluated: 0 };
  };
  visit(0, 0, 0n);
  return { ...best, evaluated };
}

/** Exact pivots, including explicit ceil/floor diagnostics, with no clamping. */
export function pivots(d: Domain, bids: readonly Bid[], method: 'scan' | 'exhaustive' = 'scan'): PivotResult {
  if (method !== 'scan' && method !== 'exhaustive') throw new RangeError('unknown research optimizer');
  const solve = method === 'scan' ? optimize : exhaustive;
  const base = solve(d, bids);
  let evaluations = base.evaluated;
  const without = bids.map((_, i) => {
    const result = solve(d, bids.filter((_, j) => j !== i));
    evaluations += result.evaluated;
    return result.welfareNumerator;
  });
  const payment = bids.map((b, i) => b.ask * base.fill[i] + base.welfareNumerator - without[i]);
  for (let i = 0; i < bids.length; i++) {
    if (payment[i] < 0n || (base.fill[i] === 0n && payment[i] !== 0n)) throw new Error('pivot invariant failed');
  }
  const floorPayment = payment.map(x => x / WAD);
  const ceilPayment = payment.map(ceil);
  const minimum = bids.map((b, i) => ceil(b.ask * base.fill[i]));
  const paid = ceilPayment.reduce((a, b) => a + b, 0n);
  const residual = base.output - paid;
  return { ...base, withoutWelfareNumerator: without, paymentNumerator: payment, floorPayment, ceilPayment,
    minimumPayment: minimum, unspent: bids.map((b, i) => b.budget - base.fill[i]),
    rawDeficitNumerator: payment.reduce((a, b) => a + b, 0n) - base.output * WAD,
    ceilDeficit: residual < 0n ? -residual : 0n, ceilResidual: residual,
    floorIRFailures: floorPayment.map((x, i) => x < minimum[i] ? i : -1).filter(i => i !== -1),
    quantityEvaluations: evaluations };
}

/** A tested negative-control policy: do NOT deploy as a fallback. */
export function refundOnDeficit(r: PivotResult): { fill: bigint[]; payment: bigint[] } {
  return r.ceilDeficit > 0n ? { fill: r.fill.map(() => 0n), payment: r.fill.map(() => 0n) }
    : { fill: [...r.fill], payment: [...r.ceilPayment] };
}

/** Local certificate over every supported point in this FINITE table only. */
export function concavity(d: Domain): { contiguous: boolean; concave: boolean; supportedLots: number; violationAt: number | null } {
  validate(d, []);
  let end = 0;
  while (end + 1 < d.output.length && d.output[end + 1] !== null) end++;
  const contiguous = d.output.slice(end + 1).every(x => x === null);
  let previous: bigint | undefined;
  for (let q = 1; q <= end; q++) {
    const delta = d.output[q]! - d.output[q - 1]!;
    if (delta < 0n || (previous !== undefined && delta > previous)) {
      return { contiguous, concave: false, supportedLots: end, violationAt: q };
    }
    previous = delta;
  }
  return { contiguous, concave: contiguous, supportedLots: end, violationAt: null };
}

/** Raw spot-price minority payment with integer IR diagnostics; not an adapter. */
export function minorityAtSpot(price: bigint, sellingCurrency0: boolean, ask: bigint, budget: bigint): {
  eligible: boolean; floorPayment: bigint; minimumPayment: bigint; ir: boolean;
} {
  amount(price, (1n << 160n) - 1n, 'price');
  if (price === 0n || typeof sellingCurrency0 !== 'boolean') throw new RangeError('invalid spot policy input');
  amount(ask, MAX_ASK, 'ask');
  amount(budget, MAX_INPUT, 'budget');
  const squared = price * price;
  const q192 = 1n << 192n;
  const num = sellingCurrency0 ? squared : q192;
  const den = sellingCurrency0 ? q192 : squared;
  const eligible = ask * den <= num * WAD;
  const payment = eligible ? budget * num / den : 0n;
  const minimum = eligible ? ceil(ask * budget) : 0n;
  return { eligible, floorPayment: payment, minimumPayment: minimum, ir: payment >= minimum };
}
