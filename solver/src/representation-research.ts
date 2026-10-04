/**
 * Offline representation diagnostics, NOT a settlement rule or claim contract.
 * Exact rational arithmetic exposes precision and actual-input gaps. The
 * immutable ledger models nominal backing, retained dust and isolated whole
 * redemption; it assumes authorized operations and successful asset delivery.
 * It supplies no tokenization, authentication, liquidity or incentive proof.
 */
import { MAX_INPUT, MIN_PRICE, MAX_PRICE_EXCLUSIVE, Status, quoteExactInput,
  type PoolSnapshot, type Quote } from './execution.ts';
import { WAD } from './discrete-research.ts';

export interface Fraction { numerator: bigint; denominator: bigint }
const Q192 = 1n << 192n;

function integer(value: bigint, name: string, positive = false): void {
  if (typeof value !== 'bigint' || value < 0n || (positive && value === 0n)) {
    throw new RangeError(`invalid ${name}`);
  }
}
function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { const r = a % b; a = b; b = r; }
  return a;
}
export function fraction(numerator: bigint, denominator = 1n): Fraction {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint' || denominator === 0n) {
    throw new RangeError('invalid fraction');
  }
  if (denominator < 0n) { numerator = -numerator; denominator = -denominator; }
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}
export const addFraction = (a: Fraction, b: Fraction): Fraction => fraction(
  a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
export const subtractFraction = (a: Fraction, b: Fraction): Fraction => fraction(
  a.numerator * b.denominator - b.numerator * a.denominator, a.denominator * b.denominator);
export const multiplyFraction = (a: Fraction, b: Fraction): Fraction => fraction(
  a.numerator * b.numerator, a.denominator * b.denominator);
export function floorFraction(value: Fraction): bigint {
  const r = fraction(value.numerator, value.denominator);
  const q = r.numerator / r.denominator;
  return q - (r.numerator < 0n && r.numerator % r.denominator !== 0n ? 1n : 0n);
}
export const ceilFraction = (value: Fraction): bigint => -floorFraction(fraction(-value.numerator, value.denominator));

/** Does a fixed-scale credit represent a nonnegative rational amount exactly?
 * floorCredits is a diagnostic, never a substituted payment. */
export function creditPrecision(value: Fraction, scale: bigint) {
  integer(scale, 'credit scale', true);
  const r = fraction(value.numerator, value.denominator);
  integer(r.numerator, 'credit amount');
  return { exact: r.numerator * scale % r.denominator === 0n,
    floorCredits: r.numerator * scale / r.denominator,
    lostValue: fraction(r.numerator * scale % r.denominator, r.denominator * scale) };
}

export function spotCompensation(price: bigint, sellingCurrency0: boolean, rawInput: bigint): Fraction {
  if (typeof price !== 'bigint' || price < MIN_PRICE || price >= MAX_PRICE_EXCLUSIVE
      || typeof sellingCurrency0 !== 'boolean') throw new RangeError('invalid spot configuration');
  integer(rawInput, 'spot input');
  if (rawInput > MAX_INPUT) throw new RangeError('spot input outside uint96');
  return sellingCurrency0 ? fraction(rawInput * price * price, Q192)
    : fraction(rawInput * Q192, price * price);
}

export interface BridgeDiagnostic {
  minorityCompensation: Fraction;
  residualInput: Fraction;
  integerResidual: boolean;
  requestedInput: bigint;
  actual: Quote;
  complete: boolean;
  /** Dominant-input assets minus exact minority claims and ACTUAL pool debit.
   * Negative is a nominal backing deficit, not an accepted settlement. */
  inputRemainder: Fraction;
  /** Straight interpolation of two fixed-opening quotes; not an executable
   * AMM curve, proof of concavity or selected compensation target. */
  interpolatedOutput: Fraction | null;
  interpolationShortfall: Fraction | null;
}

/** Diagnose floor/ceil adapters when whole dominant input buys a whole minority
 * input at exact rational spot. Does not compute allocations or pivot payments.
 * Both neighboring quotes use the SAME snapshot, never sequential state. */
export function diagnoseBridge(
  s: PoolSnapshot, dominantSellsCurrency0: boolean, dominantInput: bigint,
  minorityInput: bigint, limit: bigint, rounding: 'floor' | 'ceil',
): BridgeDiagnostic {
  integer(dominantInput, 'dominant input');
  if (dominantInput > MAX_INPUT || !['floor', 'ceil'].includes(rounding)) throw new RangeError('invalid adapter');
  if (typeof dominantSellsCurrency0 !== 'boolean' || typeof limit !== 'bigint'
      || limit < MIN_PRICE || limit >= MAX_PRICE_EXCLUSIVE
      || (dominantSellsCurrency0 ? limit >= s.sqrtPriceX96 : limit <= s.sqrtPriceX96)) {
    throw new RangeError('invalid adapter price limit');
  }
  const minorityCompensation = spotCompensation(s.sqrtPriceX96, !dominantSellsCurrency0, minorityInput);
  const residualInput = subtractFraction(fraction(dominantInput), minorityCompensation);
  if (residualInput.numerator < 0n) throw new RangeError('dominant input cannot fund minority');
  const lo = floorFraction(residualInput), hi = ceilFraction(residualInput);
  const low = quoteExactInput(s, dominantSellsCurrency0, lo, limit);
  const high = hi === lo ? low : quoteExactInput(s, dominantSellsCurrency0, hi, limit);
  const actual = rounding === 'floor' ? low : high;
  const completeQuote = (q: Quote) => q.status === Status.Complete && q.consumedInput === q.requestedInput;
  const interpolation = completeQuote(low) && completeQuote(high)
    ? addFraction(fraction(low.output), multiplyFraction(subtractFraction(residualInput, fraction(lo)),
      fraction(high.output - low.output))) : null;
  return { minorityCompensation, residualInput, integerResidual: residualInput.denominator === 1n,
    requestedInput: rounding === 'floor' ? lo : hi, actual, complete: completeQuote(actual),
    inputRemainder: subtractFraction(residualInput, fraction(actual.consumedInput)),
    interpolatedOutput: interpolation,
    interpolationShortfall: interpolation === null ? null : subtractFraction(interpolation, fraction(actual.output)) };
}

/** Scoped two-report contradiction for an unchanged allocation:
 * lower ask fills x, higher ask fills zero and receives zero compensation.
 * IR for the lower truthful type needs integer p >= ceil(vLow*x). Truthfulness
 * for the higher type needs p <= vHigh*x. A positive gap rules out EVERY whole
 * payment for those two outcomes, regardless of which rounding rule supplied p.
 * Not a universal impossibility for revised allocations/assets or all Otter. */
export function integerPaymentConflict(winningAsk: bigint, losingAsk: bigint, fill: bigint) {
  integer(winningAsk, 'winning ask'); integer(losingAsk, 'losing ask'); integer(fill, 'winning fill', true);
  if (winningAsk >= losingAsk || losingAsk >= 1n << 128n || fill > MAX_INPUT) {
    throw new RangeError('invalid two-report witness');
  }
  const minimumWholePayment = (winningAsk * fill + WAD - 1n) / WAD;
  const maximumTruthfulPaymentNumerator = losingAsk * fill;
  const deviationGainLowerBoundNumerator = minimumWholePayment * WAD - maximumTruthfulPaymentNumerator;
  return { minimumWholePayment, maximumTruthfulPaymentNumerator,
    deviationGainLowerBoundNumerator, impossible: deviationGainLowerBoundNumerator > 0n };
}

export const MAX_CREDIT_ACCOUNTS = 64;
export interface CreditLedger {
  scale: bigint;
  cash: bigint;
  /** Escrow is locked and cannot be transferred or redeemed as output. */
  escrow: Map<string, bigint>;
  claims: Map<string, bigint>;
  community: bigint;
}
type Entries = Iterable<readonly [string, bigint]>;
const sum = (values: Iterable<bigint>) => { let n = 0n; for (const value of values) n += value; return n; };
function ownerCheck(owner: string): void {
  if (typeof owner !== 'string' || owner.length === 0 || owner.length > 128 || /\s/.test(owner)) {
    throw new RangeError('invalid model owner');
  }
}
function accounts(entries: Entries): Map<string, bigint> {
  const result = new Map<string, bigint>();
  for (const [owner, balance] of entries) {
    ownerCheck(owner); integer(balance, 'credit balance');
    if (result.has(owner)) throw new RangeError('duplicate model owner');
    result.set(owner, balance);
    if (result.size > MAX_CREDIT_ACCOUNTS) throw new RangeError('model account cap exceeded');
  }
  return result;
}
export function ledgerAccounting(l: CreditLedger) {
  const escrow = sum(l.escrow.values()), claims = sum(l.claims.values());
  const unassigned = l.cash * l.scale - escrow - claims - l.community;
  return { cash: l.cash, escrow, claims, community: l.community, unassigned, backed: unassigned >= 0n };
}
/** All pools sharing a currency must use one aggregate backing test. Scale is
 * credit units per underlying raw unit; a PoolManager credit alone has scale 1.
 * This constructor ASSUMES independently verified nominal liabilities. */
export function createCreditLedger(scale: bigint, cash: bigint, claims: Entries,
  community = 0n, escrow: Entries = []): CreditLedger {
  integer(scale, 'credit scale', true); integer(cash, 'cash'); integer(community, 'community credit');
  const result = { scale, cash, claims: accounts(claims), escrow: accounts(escrow), community };
  if (new Set([...result.claims.keys(), ...result.escrow.keys()]).size > MAX_CREDIT_ACCOUNTS) {
    throw new RangeError('model account cap exceeded');
  }
  if (!ledgerAccounting(result).backed) throw new RangeError('nominal liabilities exceed backing');
  return result;
}
const checked = (l: CreditLedger) => createCreditLedger(l.scale, l.cash, l.claims, l.community, l.escrow);

/** Assume owner authorization. Transfer preserves the exact credit liability;
 * a recipient may aggregate fractions, but no market or exact valuation exists
 * merely because this model allows a transfer. Source remains immutable. */
export function transferCredit(l: CreditLedger, from: string, to: string, amount: bigint): CreditLedger {
  const next = checked(l); ownerCheck(from); ownerCheck(to); integer(amount, 'transfer amount', true);
  const balance = next.claims.get(from) ?? 0n;
  if (balance < amount) throw new RangeError('insufficient transferable credit');
  if (from !== to) {
    if (balance === amount) next.claims.delete(from); else next.claims.set(from, balance - amount);
    next.claims.set(to, (next.claims.get(to) ?? 0n) + amount);
  }
  return checked(next);
}

/** Deliver only requested WHOLE underlying units; burn exactly raw*scale,
 * retaining all fractional debt and other accounts/escrows. No delivery occurs
 * in this arithmetic model. Real token callbacks/failure need contract tests. */
export function redeemCredit(l: CreditLedger, owner: string, raw: bigint): CreditLedger {
  const next = checked(l); ownerCheck(owner); integer(raw, 'redemption amount');
  const balance = next.claims.get(owner) ?? 0n;
  if (raw * next.scale > balance || raw > next.cash) throw new RangeError('redemption exceeds own backing');
  next.cash -= raw;
  if (raw * next.scale === balance) next.claims.delete(owner);
  else next.claims.set(owner, balance - raw * next.scale);
  return checked(next);
}
export function redeemCommunity(l: CreditLedger, raw: bigint): CreditLedger {
  const next = checked(l); integer(raw, 'community redemption');
  if (raw * next.scale > next.community || raw > next.cash) throw new RangeError('redemption exceeds community credit');
  next.cash -= raw; next.community -= raw * next.scale;
  return checked(next);
}
