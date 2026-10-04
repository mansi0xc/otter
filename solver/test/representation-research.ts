import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAD } from '../src/discrete-research.ts';
import { Q96, MAX_INPUT, Status, IncompleteSnapshot, sqrtPriceAtTick } from '../src/execution.ts';
import { fraction, floorFraction, ceilFraction, addFraction, subtractFraction, multiplyFraction,
  creditPrecision, spotCompensation, diagnoseBridge, integerPaymentConflict, createCreditLedger,
  ledgerAccounting, transferCredit, redeemCredit, redeemCommunity, MAX_CREDIT_ACCOUNTS,
  type CreditLedger } from '../src/representation-research.ts';
import { fullPool } from '../research/discrete-cases.ts';
import { lotBid, scarceLotFrame } from '../research/lot-cases.ts';
import { solveLotCandidate } from '../src/lot-candidate.ts';
import { representationCases, renderRepresentationCases, ledgerView } from '../research/representation-cases.ts';

let groups = 0;
function test(name: string, body: () => void): void { body(); groups++; console.log(`PASS ${name}`); }
const c = representationCases();
const makeLedger = () => createCreditLedger(WAD, 17n,
  [['b', WAD * 3n / 4n], ['c', WAD * 3n / 4n]], WAD * 31n / 2n);
const cloneView = (l: CreditLedger) => structuredClone(ledgerView(l));

test('exact fractions normalize and preserve signed mathematical floor/ceil', () => {
  assert.deepEqual(fraction(4n, -6n), fraction(-2n, 3n));
  assert.deepEqual(fraction(0n, 19n), fraction(0n));
  assert.equal(floorFraction(fraction(-5n, 9n)), -1n);
  assert.equal(ceilFraction(fraction(-5n, 9n)), 0n);
  assert.equal(floorFraction(fraction(5n, 9n)), 0n);
  assert.equal(ceilFraction(fraction(5n, 9n)), 1n);
  assert.deepEqual(addFraction(fraction(4n, 9n), fraction(5n, 9n)), fraction(1n));
  assert.deepEqual(subtractFraction(fraction(1n), fraction(4n, 9n)), fraction(5n, 9n));
  assert.deepEqual(multiplyFraction(fraction(3n, 4n), fraction(2n, 3n)), fraction(1n, 2n));
  assert.throws(() => fraction(1n, 0n), RangeError);
});
test('fixed decimal precision cannot represent every exact spot payment', () => {
  const price = Q96 * 3n / 2n;
  assert.deepEqual(spotCompensation(price, true, 1n), fraction(9n, 4n));
  assert.deepEqual(spotCompensation(price, false, 1n), fraction(4n, 9n));
  assert.equal(creditPrecision(fraction(9n, 4n), WAD).exact, true);
  assert.equal(creditPrecision(fraction(4n, 9n), WAD).exact, false);
  assert.equal(creditPrecision(fraction(4n, 9n), 10n ** 200n).exact, false);
  assert.equal(creditPrecision(fraction(4n, 9n), 9n).exact, true);
  for (const down of [true, false]) {
    const r = spotCompensation(sqrtPriceAtTick(1), down, 1n);
    assert.equal(creditPrecision(r, WAD).exact, false);
    assert.equal(creditPrecision(r, 10n ** 36n).exact, false);
  }
  const inverse = spotCompensation(sqrtPriceAtTick(1), false, 1n);
  let oddNonFive = inverse.denominator;
  while (oddNonFive % 2n === 0n) oddNonFive /= 2n;
  while (oddNonFive % 5n === 0n) oddNonFive /= 5n;
  assert.ok(oddNonFive > 1n, 'inverse denominator cannot divide any power of ten');
  assert.equal(creditPrecision(spotCompensation(sqrtPriceAtTick(1), true, 1n), 1n << 192n).exact, true);
  assert.equal(creditPrecision(inverse, 1n << 192n).exact, false);
});
test('same fills and zero losing compensation admit no whole IR/truthful payment in the witness', () => {
  const w = c.fixedAllocationPaymentConflict;
  assert.equal(w.truthfulFill, 0n); assert.equal(w.truthfulCompensation, 0n);
  assert.equal(w.lowerReportFill, 4n);
  assert.equal(w.lowerReportNominalCompensation, WAD / 2n);
  assert.equal(w.witness.minimumWholePayment, 1n);
  assert.equal(w.witness.maximumTruthfulPaymentNumerator, WAD * 3n / 4n);
  assert.equal(w.witness.deviationGainLowerBoundNumerator, WAD / 4n);
  assert.equal(w.witness.impossible, true);
  // Independent payment enumeration over available currency1 assets. Zero
  // fails low-type IR; EVERY positive integer payment profits the high type.
  for (let payment = 0n; payment <= 17n; payment++) {
    const lowIR = payment * WAD >= w.lowerReport[0].ask * 4n;
    const highUIC = payment * WAD <= w.honest[0].ask * 4n;
    assert.equal(lowIR && highUIC, false);
  }
});
test('49 independently recomputed two-report pairs exhibit the scoped allocation conflict', () => {
  const frame = scarceLotFrame();
  const others = [lotBid(2, true, WAD / 8n, 4n), lotBid(3, true, WAD / 8n, 4n), lotBid(4, false, 0n, 9n)];
  let witnesses = 0;
  for (let low = 1n; low <= 7n; low++) for (let high = 9n; high <= 15n; high++) {
    const lowAsk = WAD * low / 64n, highAsk = WAD * high / 64n;
    const win = solveLotCandidate(frame, [lotBid(1, true, lowAsk, 4n), ...others], 'exhaustive');
    const lose = solveLotCandidate(frame, [lotBid(1, true, highAsk, 4n), ...others], 'exhaustive');
    assert.equal(win.spend[0], 4n); assert.equal(lose.spend[0], 0n);
    assert.equal(lose.paymentNumerator[0], 0n); assert.equal(win.claimsFunded, true);
    assert.equal(integerPaymentConflict(lowAsk, highAsk, win.spend[0]).impossible, true);
    witnesses++;
  }
  assert.equal(witnesses, 49);
});
test('fractional output is fully backed but cannot promise immediate whole underlying IR', () => {
  const l = makeLedger();
  assert.equal(ledgerAccounting(l).unassigned, 0n);
  assert.equal(l.claims.get('b'), WAD * 3n / 4n);
  assert.deepEqual(c.creditRedemption.individualWholeRedemption, [0n, 0n]);
  assert.deepEqual(c.creditRedemption.promisedMinimumWhole, [1n, 1n]);
  const before = cloneView(l);
  assert.throws(() => redeemCredit(l, 'b', 1n), RangeError);
  assert.deepEqual(ledgerView(l), before);
  assert.deepEqual(ledgerView(redeemCredit(l, 'b', 0n)), before);
  // Nominal expected value does not establish every-outcome IR either.
  const cost = WAD / 2n, probabilityOfOne = WAD * 3n / 4n;
  assert.equal(probabilityOfOne - cost, WAD / 4n);
  assert.ok(0n * WAD - cost < 0n);
});
test('safe community delivery preserves trader debt and its own fractional remainder', () => {
  const l = makeLedger(), next = redeemCommunity(l, 15n);
  assert.equal(next.cash, 2n); assert.equal(next.community, WAD / 2n);
  assert.deepEqual(next.claims, l.claims);
  assert.equal(ledgerAccounting(next).unassigned, 0n);
  assert.throws(() => redeemCommunity(l, 16n), RangeError);
  assert.throws(() => redeemCommunity(l, 17n), RangeError);
  // Computing spendable surplus by subtracting only floors of trader claims
  // would give 17; paying it leaves the nominal trader debt unbacked.
  assert.throws(() => createCreditLedger(WAD, 0n, l.claims), RangeError);
  assert.equal(l.cash, 17n);
});
test('voluntary aggregation redeems one unit and retains every unpaid fractional claim', () => {
  const base = redeemCommunity(makeLedger(), 15n);
  const merged = transferCredit(base, 'b', 'c', WAD * 3n / 4n);
  assert.equal(merged.claims.has('b'), false);
  assert.equal(merged.claims.get('c'), WAD * 3n / 2n);
  assert.equal(ledgerAccounting(merged).claims, ledgerAccounting(base).claims);
  const redeemed = redeemCredit(merged, 'c', 1n);
  assert.equal(redeemed.cash, 1n);
  assert.equal(redeemed.claims.get('c'), WAD / 2n);
  assert.equal(redeemed.community, WAD / 2n);
  assert.equal(ledgerAccounting(redeemed).unassigned, 0n);
  assert.throws(() => redeemCredit(redeemed, 'c', 1n), RangeError);
  assert.throws(() => redeemCommunity(redeemed, 1n), RangeError);
  assert.deepEqual(ledgerView(transferCredit(redeemed, 'c', 'c', WAD / 4n)), ledgerView(redeemed));
});
test('aggregate currency backing reserves cross-pool liabilities, escrow and refunds', () => {
  const l = createCreditLedger(WAD, 8n,
    [['pool-a/refund', WAD * 4n], ['pool-b/output', WAD / 2n]], WAD / 2n,
    [['pool-c/open-order', WAD * 3n]]);
  assert.equal(ledgerAccounting(l).unassigned, 0n);
  const next = redeemCredit(l, 'pool-a/refund', 4n);
  assert.equal(next.cash, 4n); assert.deepEqual(next.escrow, l.escrow);
  assert.equal(next.claims.get('pool-b/output'), WAD / 2n);
  assert.throws(() => transferCredit(next, 'pool-c/open-order', 'outsider', WAD), RangeError);
  assert.throws(() => redeemCredit(next, 'pool-c/open-order', 1n), RangeError);
  assert.throws(() => redeemCommunity(next, 1n), RangeError);
  // Full whole-token claims: a scale-1 credit neither loses nor gains units.
  const whole = createCreditLedger(1n, 5n, [['owner', 5n]]);
  assert.equal(redeemCredit(whole, 'owner', 5n).cash, 0n);
});
test('malformed or underfunded ledgers and failed operations leave source state intact', () => {
  const l = makeLedger(), before = cloneView(l);
  for (const scale of [0n, -1n]) assert.throws(() => createCreditLedger(scale, 1n, []), RangeError);
  assert.throws(() => createCreditLedger(WAD, -1n, []), RangeError);
  assert.throws(() => createCreditLedger(WAD, 1n, [['a', WAD + 1n]]), RangeError);
  assert.throws(() => createCreditLedger(WAD, 1n, [['a', 0n], ['a', 0n]]), RangeError);
  assert.throws(() => createCreditLedger(WAD, 1n, [['a', -1n]]), RangeError);
  assert.throws(() => createCreditLedger(WAD, 1n, [], -1n), RangeError);
  assert.throws(() => createCreditLedger(WAD, 1n, [], 0n, [['a', WAD + 1n]]), RangeError);
  assert.throws(() => transferCredit(l, 'b', 'c', -1n), RangeError);
  assert.throws(() => transferCredit(l, 'b', 'c', WAD), RangeError);
  assert.throws(() => redeemCredit(l, 'b', -1n), RangeError);
  assert.throws(() => transferCredit(l, 'b', 'bad owner', 1n), RangeError);
  const capped = createCreditLedger(1n, 1000n,
    Array.from({ length: MAX_CREDIT_ACCOUNTS }, (_, i) => [`owner-${i}`, 2n] as const));
  assert.throws(() => transferCredit(capped, 'owner-0', 'new-owner', 1n), RangeError);
  assert.equal(capped.claims.size, MAX_CREDIT_ACCOUNTS);
  assert.deepEqual(ledgerView(l), before);
});

let seed = 0x4F2026;
function random(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
test('5000 seeded ledger operations conserve backing, locked escrow and fractional debt', () => {
  let operations = 0;
  for (const scale of [1n, 10n, WAD, 9n, 1n << 192n]) {
    let l = createCreditLedger(scale, 10000n,
      [['a', 1000n * scale + scale / 3n], ['b', 1000n * scale + scale / 4n], ['c', scale / 2n]],
      2000n * scale + scale / 5n, [['locked', 3000n * scale]]);
    for (let i = 0; i < 1000; i++) {
      const before = ledgerAccounting(l), escrow = new Map(l.escrow), original = cloneView(l);
      const owner = ['a', 'b', 'c'][random() % 3];
      const op = random() % 3;
      let next: CreditLedger;
      if (op === 0 && (l.claims.get(owner) ?? 0n) > 0n) {
        const balance = l.claims.get(owner)!;
        const amount = balance * BigInt(1 + random() % 100) / 100n || 1n;
        next = transferCredit(l, owner, ['a', 'b', 'c'][random() % 3], amount);
      } else if (op === 1) {
        const max = (l.claims.get(owner) ?? 0n) / scale;
        next = redeemCredit(l, owner, max * BigInt(random() % 101) / 100n);
      } else {
        next = redeemCommunity(l, (l.community / scale) * BigInt(random() % 101) / 100n);
      }
      const after = ledgerAccounting(next);
      assert.equal(after.backed, true); assert.equal(after.unassigned, before.unassigned);
      assert.equal(before.claims + before.community - after.claims - after.community,
        (l.cash - next.cash) * scale);
      assert.deepEqual(next.escrow, escrow); assert.deepEqual(ledgerView(l), original);
      l = next; operations++;
    }
  }
  assert.equal(operations, 5000);
});
test('fractional residual floor/ceil adapters expose actual input and output gaps in both directions', () => {
  const down = c.residualAdapters[0], up = c.residualAdapters[1];
  assert.deepEqual(down.floor.minorityCompensation, fraction(4n, 9n));
  assert.deepEqual(down.floor.residualInput, fraction(5n, 9n));
  assert.equal(down.floor.actual.output, 0n); assert.equal(down.ceil.actual.output, 2n);
  assert.deepEqual(down.floor.inputRemainder, fraction(5n, 9n));
  assert.deepEqual(down.ceil.inputRemainder, fraction(-4n, 9n));
  assert.deepEqual(down.floor.interpolatedOutput, fraction(10n, 9n));
  assert.deepEqual(down.floor.interpolationShortfall, fraction(10n, 9n));
  assert.deepEqual(up.floor.residualInput, fraction(3n, 4n));
  assert.deepEqual(up.floor.inputRemainder, fraction(3n, 4n));
  assert.deepEqual(up.ceil.inputRemainder, fraction(-1n, 4n));
  for (const bridge of c.residualAdapters) {
    assert.equal(bridge.floor.integerResidual, false);
    assert.equal(bridge.floor.complete, true); assert.equal(bridge.ceil.complete, true);
    assert.equal(bridge.floor.actual.consumedInput, bridge.floor.requestedInput);
    assert.equal(bridge.ceil.actual.consumedInput, bridge.ceil.requestedInput);
    assert.ok(bridge.floor.inputRemainder.numerator > 0n);
    assert.ok(bridge.ceil.inputRemainder.numerator < 0n);
  }
});
test('ordinary tick price still needs rational claims and fractional pool input', () => {
  const { floor, ceil } = c.residualAdapters[2];
  assert.equal(floor.requestedInput, 9n); assert.equal(ceil.requestedInput, 10n);
  assert.equal(floor.actual.output, 7n); assert.equal(ceil.actual.output, 8n);
  assert.equal(creditPrecision(floor.minorityCompensation, WAD).exact, false);
  assert.ok(floor.interpolationShortfall!.numerator > 0n);
});
test('500 seeded ordinary-price bridges retain exact liabilities and both rounding gaps', () => {
  let fractional = 0;
  for (let i = 0; i < 500; i++) {
    const tick = Number(random() % 24001) - 12000, down = random() % 2 === 0;
    const s = fullPool(1000n, 60, sqrtPriceAtTick(tick));
    const minority = BigInt(1 + random() % 5);
    const m = spotCompensation(s.sqrtPriceX96, !down, minority);
    const total = ceilFraction(m) + BigInt(random() % 20);
    const limit = sqrtPriceAtTick(tick + (down ? -20000 : 20000));
    const low = diagnoseBridge(s, down, total, minority, limit, 'floor');
    const high = diagnoseBridge(s, down, total, minority, limit, 'ceil');
    assert.equal(low.complete, true); assert.equal(high.complete, true);
    assert.deepEqual(addFraction(m, low.residualInput), fraction(total));
    assert.deepEqual(addFraction(low.inputRemainder, fraction(low.actual.consumedInput)), low.residualInput);
    assert.deepEqual(addFraction(high.inputRemainder, fraction(high.actual.consumedInput)), high.residualInput);
    assert.ok(low.inputRemainder.numerator >= 0n && low.inputRemainder.numerator < low.inputRemainder.denominator);
    assert.ok(high.inputRemainder.numerator <= 0n && -high.inputRemainder.numerator < high.inputRemainder.denominator);
    if (!low.integerResidual) {
      fractional++;
      assert.ok(low.inputRemainder.numerator > 0n && high.inputRemainder.numerator < 0n);
    }
  }
  assert.ok(fractional > 450);
});
test('integer residuals are exact, partial/unsupported quotes stay unusable, malformed bridges reject', () => {
  const s = fullPool(1000n, 60, Q96 * 3n / 2n), limit = sqrtPriceAtTick(7000);
  const exact = diagnoseBridge(s, true, 8n, 9n, limit, 'floor');
  assert.equal(exact.integerResidual, true); assert.equal(exact.actual.consumedInput, 4n);
  assert.deepEqual(exact.inputRemainder, fraction(0n));
  const zero = diagnoseBridge(s, true, 4n, 9n, limit, 'ceil');
  assert.equal(zero.actual.consumedInput, 0n); assert.equal(zero.actual.output, 0n);
  assert.equal(zero.complete, true);
  const tight = diagnoseBridge(s, true, 100n, 1n, sqrtPriceAtTick(8100), 'ceil');
  assert.equal(tight.complete, false); assert.equal(tight.actual.status, Status.PriceLimit);
  assert.equal(tight.interpolatedOutput, null);
  assert.notEqual(tight.actual.consumedInput, tight.requestedInput);
  assert.deepEqual(tight.inputRemainder, subtractFraction(tight.residualInput, fraction(tight.actual.consumedInput)));
  const unsupported = diagnoseBridge({ ...s, lpFee: 1 }, true, 1n, 1n, limit, 'ceil');
  assert.equal(unsupported.complete, false); assert.equal(unsupported.actual.status, Status.UnsupportedFees);
  assert.equal(unsupported.interpolatedOutput, null);
  assert.throws(() => diagnoseBridge({ ...s, bitmap: new Map() }, true, 8n, 9n, limit, 'ceil'), IncompleteSnapshot);
  assert.throws(() => diagnoseBridge(s, true, 0n, 1n, limit, 'floor'), RangeError);
  assert.throws(() => diagnoseBridge(s, true, MAX_INPUT + 1n, 1n, limit, 'floor'), RangeError);
  assert.throws(() => diagnoseBridge(s, true, 1n, 1n, s.sqrtPriceX96, 'floor'), RangeError);
  assert.throws(() => diagnoseBridge(s, true, 1n, 1n, limit, 'invalid' as never), RangeError);
  assert.throws(() => creditPrecision(fraction(-1n), WAD), RangeError);
  assert.throws(() => creditPrecision(fraction(1n), 0n), RangeError);
  assert.throws(() => integerPaymentConflict(WAD, WAD, 1n), RangeError);
});
test('representation research fixture reproduces byte-for-byte', () => {
  assert.equal(readFileSync(new URL('../../fixtures/research/representation-research.json', import.meta.url), 'utf8'),
    renderRepresentationCases());
});
console.log(`${groups} representation groups passed; whole-token IR and full incentive gates remain open.`);
