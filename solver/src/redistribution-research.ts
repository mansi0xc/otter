/** Offline fixed-calendar candidate, NOT an adopted redistribution rule.
 * Cash, ownership and clock are supplied/authenticated by assumption. This is
 * whole-unit liability arithmetic, not token delivery or a consensus model.
 * Commit/release have no input for a batch result or current surplus. */
import { divideReward } from './rewards.ts';
import { fraction, addFraction, multiplyFraction, createCreditLedger, ledgerAccounting,
  redeemCredit, MAX_CREDIT_ACCOUNTS, type CreditLedger, type Fraction } from './representation-research.ts';

export const MAX_FIXED_GRANTS = 8;
const MAX_UINT256 = (1n << 256n) - 1n;
export interface Beneficiary { owner: string; weight: bigint }
export interface FixedGrant {
  id: string;
  amount: bigint;
  committedAt: bigint;
  cutoffAt: bigint;
  releaseAt: bigint;
  released: boolean;
  /** Exact whole-unit claims, including the predeclared dust beneficiary. */
  allocation: Map<string, bigint>;
}
export interface FixedCalendar {
  currency: string;
  ledger: CreditLedger;
  grants: FixedGrant[];
}
const bounded = (n: bigint, name: string) => {
  if (typeof n !== 'bigint' || n < 0n || n > MAX_UINT256) throw new RangeError(`invalid ${name}`);
};
function address(s: string, allowZero = false): string {
  if (typeof s !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(s)
      || (!allowZero && BigInt(s) === 0n)) throw new RangeError('invalid model address');
  return s.toLowerCase();
}
function grantId(s: string): string {
  if (typeof s !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(s)) throw new RangeError('invalid grant ID');
  return s.toLowerCase();
}
const escrowId = (id: string) => `schedule:${id}`;
function checked(c: FixedCalendar): FixedCalendar {
  const currency = address(c.currency, true);
  if (c.ledger.scale !== 1n || c.ledger.community !== 0n || c.grants.length > MAX_FIXED_GRANTS) {
    throw new RangeError('unsupported calendar representation');
  }
  bounded(c.ledger.cash, 'calendar cash');
  const ledger = createCreditLedger(1n, c.ledger.cash, c.ledger.claims, 0n, c.ledger.escrow);
  for (const [owner, balance] of ledger.claims) {
    if (address(owner) !== owner) throw new RangeError('noncanonical claim owner');
    bounded(balance, 'claim');
  }
  const ids = new Set<string>(), expectedEscrow = new Map<string, bigint>();
  const grants = c.grants.map(g => {
    const id = grantId(g.id);
    if (ids.has(id)) throw new RangeError('duplicate committed schedule');
    ids.add(id);
    for (const n of [g.amount, g.committedAt, g.cutoffAt, g.releaseAt]) bounded(n, 'grant field');
    if (g.committedAt >= g.cutoffAt || g.cutoffAt > g.releaseAt || typeof g.released !== 'boolean') {
      throw new RangeError('invalid committed grant timing');
    }
    let total = 0n;
    const allocation = new Map<string, bigint>();
    for (const [owner, balance] of g.allocation) {
      const canonical = address(owner); bounded(balance, 'grant allocation');
      if (canonical !== owner || allocation.has(canonical) || balance === 0n) throw new RangeError('invalid allocation owner');
      allocation.set(canonical, balance); total += balance;
    }
    if (allocation.size > 33 || total !== g.amount) throw new RangeError('grant allocation does not exhaust fixed amount');
    if (!g.released) expectedEscrow.set(escrowId(id), g.amount);
    return { ...g, id, allocation };
  });
  if (expectedEscrow.size !== ledger.escrow.size || [...expectedEscrow].some(([id, n]) => ledger.escrow.get(id) !== n)) {
    throw new RangeError('calendar reservation mismatch');
  }
  // Reserve account capacity too. Otherwise a funded commitment could fail at
  // release when its known beneficiaries exceed the reused ledger's bound.
  const futureAccounts = new Set([...ledger.claims.keys(), ...ledger.escrow.keys()]);
  for (const g of grants) if (!g.released) for (const owner of g.allocation.keys()) futureAccounts.add(owner);
  if (futureAccounts.size > MAX_CREDIT_ACCOUNTS) throw new RangeError('calendar future account cap exceeded');
  return { currency, ledger, grants };
}

/** Initial funds are assumed external and available before relevant reports.
 * Cash can cover several schedules sharing a currency, not just one pool. */
export function createFixedCalendar(currency: string, cash: bigint): FixedCalendar {
  bounded(cash, 'prefunding');
  return { currency: address(currency, true), ledger: createCreditLedger(1n, cash, []), grants: [] };
}

export function commitFixedGrant(c: FixedCalendar, id: string, amount: bigint,
  now: bigint, cutoffAt: bigint, releaseAt: bigint, beneficiaries: readonly Beneficiary[], community: string): FixedCalendar {
  const next = checked(c), canonicalId = grantId(id), destination = address(community);
  for (const n of [amount, now, cutoffAt, releaseAt]) bounded(n, 'grant field');
  if (now >= cutoffAt || cutoffAt > releaseAt || next.grants.length >= MAX_FIXED_GRANTS
      || next.grants.some(g => g.id === canonicalId)) throw new RangeError('grant is late, duplicated or over cap');
  const divided = divideReward(amount, beneficiaries.map(b => b.weight)), allocation = new Map<string, bigint>();
  const add = (owner: string, n: bigint) => {
    if (n > 0n) allocation.set(owner, (allocation.get(owner) ?? 0n) + n);
  };
  beneficiaries.forEach((b, i) => add(address(b.owner), divided.rewards[i]));
  add(destination, divided.dust);
  const escrow = new Map(next.ledger.escrow);
  escrow.set(escrowId(canonicalId), amount);
  // Reserve now. Never wait for successful settlement/current surplus to back
  // the promised amount, and never use previously released claims as funding.
  const ledger = createCreditLedger(1n, next.ledger.cash, next.ledger.claims, 0n, escrow);
  return checked({ ...next, ledger, grants: [...next.grants,
    { id: canonicalId, amount, committedAt: now, cutoffAt, releaseAt, released: false, allocation }] });
}

/** Trusted wall-clock release. No order admission, fill, settlement/expiry,
 * caller identity, or surplus condition can alter this committed entitlement. */
export function releaseFixedGrant(c: FixedCalendar, id: string, now: bigint): FixedCalendar {
  const next = checked(c), canonicalId = grantId(id); bounded(now, 'release clock');
  const g = next.grants.find(g => g.id === canonicalId);
  if (!g || g.released || now < g.releaseAt) throw new RangeError('grant is missing, early or already released');
  const escrow = new Map(next.ledger.escrow), claims = new Map(next.ledger.claims);
  escrow.delete(escrowId(canonicalId));
  for (const [owner, n] of g.allocation) claims.set(owner, (claims.get(owner) ?? 0n) + n);
  g.released = true;
  return checked({ ...next, ledger: createCreditLedger(1n, next.ledger.cash, claims, 0n, escrow) });
}

/** Assumes owner authorization and successful exact delivery. Failed real
 * native/ERC20 delivery, callbacks and authentication need contract integration. */
export function claimFixedGrant(c: FixedCalendar, owner: string, amount: bigint): FixedCalendar {
  const next = checked(c); bounded(amount, 'claim amount');
  return checked({ ...next, ledger: redeemCredit(next.ledger, address(owner), amount) });
}

export function fixedCalendarAccounting(c: FixedCalendar) {
  return ledgerAccounting(checked(c).ledger);
}

/** One compensation currency and an externally specified linear discount.
 * Discounting tests deferred benefits; it is not a new production utility. */
export function discountedUtility(trading: Fraction, cashflows: readonly { delay: number; amount: bigint }[], discount: Fraction): Fraction {
  let utility = fraction(trading.numerator, trading.denominator);
  const d = fraction(discount.numerator, discount.denominator);
  if (d.numerator < 0n || d.numerator > d.denominator || cashflows.length > 64) throw new RangeError('invalid discount or flow count');
  for (const flow of cashflows) {
    bounded(flow.amount, 'deferred cash');
    if (!Number.isSafeInteger(flow.delay) || flow.delay < 0 || flow.delay > 64) throw new RangeError('invalid reward delay');
    const factor = fraction(d.numerator ** BigInt(flow.delay), d.denominator ** BigInt(flow.delay));
    utility = addFraction(utility, multiplyFraction(fraction(flow.amount), factor));
  }
  return utility;
}

/** DELIBERATE alternate interpretation: include external credits inside the
 * paper-shaped net-flow budget/opposite-direction gates. This is not the
 * paper's additive exogenous-fee convention and is not a selected utility.
 * null denotes a catastrophic outcome. Values are in true output units. */
export function walletUtility(orderDelta: readonly [bigint, bigint], externalCredits: readonly [bigint, bigint],
  trueDown: boolean, trueAsk: Fraction, trueBudget: bigint): Fraction | null {
  const ask = fraction(trueAsk.numerator, trueAsk.denominator);
  bounded(trueBudget, 'true budget');
  if (ask.numerator < 0n || typeof trueDown !== 'boolean' || orderDelta.length !== 2 || externalCredits.length !== 2) {
    throw new RangeError('invalid diagnostic wallet type');
  }
  for (const n of orderDelta) {
    if (typeof n !== 'bigint' || n < -MAX_UINT256 || n > MAX_UINT256) throw new RangeError('invalid order flow');
  }
  for (const n of externalCredits) bounded(n, 'external credit');
  const input = orderDelta[trueDown ? 0 : 1] + externalCredits[trueDown ? 0 : 1];
  const output = orderDelta[trueDown ? 1 : 0] + externalCredits[trueDown ? 1 : 0];
  if (-input > trueBudget || (input > 0n && output < 0n)) return null;
  return addFraction(fraction(output), multiplyFraction(ask, fraction(input)));
}
