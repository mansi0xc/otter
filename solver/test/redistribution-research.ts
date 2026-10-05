import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fraction, subtractFraction } from '../src/representation-research.ts';
import { createFixedCalendar, commitFixedGrant, releaseFixedGrant, claimFixedGrant,
  fixedCalendarAccounting, discountedUtility, walletUtility, MAX_FIXED_GRANTS } from '../src/redistribution-research.ts';
import { beneficiaries, beneficiaryAddress, OWNER_A, OWNER_B, COMMUNITY, TOKEN, NATIVE,
  redistributionCases, renderRedistributionCases, renderResearch } from '../research/redistribution-cases.ts';
import { id } from '../research/discrete-cases.ts';

let groups = 0;
function test(name: string, body: () => void) { body(); groups++; console.log(`PASS ${name}`); }
const c = redistributionCases();
const grant = (cash = 7n) => commitFixedGrant(createFixedCalendar(TOKEN, cash), id(1), 7n,
  0n, 100n, 200n, beneficiaries, COMMUNITY);

test('fixed amount reserves whole cash before reports and commits exact beneficiaries and dust', () => {
  const r = grant();
  assert.deepEqual(fixedCalendarAccounting(r), { cash: 7n, escrow: 7n, claims: 0n, community: 0n, unassigned: 0n, backed: true });
  assert.deepEqual([...r.grants[0].allocation], [[OWNER_A, 3n], [OWNER_B, 3n], [COMMUNITY, 1n]]);
  assert.throws(() => grant(6n), /nominal liabilities exceed backing/);
  assert.throws(() => claimFixedGrant(r, OWNER_A, 1n), /redemption exceeds own backing/);
});
test('trusted calendar releases at the boundary without a settlement or admission condition', () => {
  const r = grant();
  assert.throws(() => releaseFixedGrant(r, id(1), 199n), RangeError);
  const expected = releaseFixedGrant(r, id(1), 200n);
  for (const _state of ['settled', 'zero fill', 'expired', 'never admitted']) {
    // These are external conditions deliberately absent from the API, not
    // simulated on-chain epoch transitions or an integration proof.
    assert.equal(renderResearch(releaseFixedGrant(r, id(1), 200n)), renderResearch(expected));
  }
  assert.deepEqual(fixedCalendarAccounting(expected), { cash: 7n, escrow: 0n, claims: 7n, community: 0n, unassigned: 0n, backed: true });
  assert.throws(() => releaseFixedGrant(expected, id(1), 201n), RangeError);
  assert.throws(() => releaseFixedGrant(expected, id(99), 200n), RangeError);
});
test('a single currency reserves all pool schedules and released claims together', () => {
  const one = grant(14n), oneState = renderResearch(one);
  const both = commitFixedGrant(one, id(2), 7n, 0n, 100n, 300n, beneficiaries, COMMUNITY);
  const released = releaseFixedGrant(both, id(1), 200n), paid = claimFixedGrant(released, OWNER_A, 3n);
  assert.deepEqual(fixedCalendarAccounting(paid), { cash: 11n, escrow: 7n, claims: 4n, community: 0n, unassigned: 0n, backed: true });
  assert.throws(() => commitFixedGrant(paid, id(3), 1n, 200n, 250n, 300n, beneficiaries, COMMUNITY), /nominal liabilities exceed backing/);
  assert.throws(() => claimFixedGrant(paid, OWNER_A, 1n), RangeError);
  assert.equal(renderResearch(one), oneState); // Operations return new state.
  const later = releaseFixedGrant(paid, id(2), 300n);
  assert.equal(later.ledger.claims.get(OWNER_A), 3n);
  assert.equal(fixedCalendarAccounting(later).escrow, 0n);
});
test('recipient objects and subsequent operations cannot mutate a committed source snapshot', () => {
  const roster = beneficiaries.map(b => ({ ...b }));
  const r = commitFixedGrant(createFixedCalendar(NATIVE, 7n), id(1), 7n, 0n, 100n, 200n, roster, COMMUNITY);
  const saved = renderResearch(r);
  roster[0].owner = beneficiaryAddress(99); roster[0].weight = 1000000n;
  const released = releaseFixedGrant(r, id(1), 200n);
  const paid = claimFixedGrant(released, OWNER_A.toUpperCase().replace('0X', '0x'), 3n);
  assert.equal(paid.ledger.cash, 4n);
  assert.equal(renderResearch(r), saved);
  assert.equal(released.ledger.claims.get(OWNER_A), 3n);
});
test('1024 seeded schedules conserve independent entitlement sums through arbitrary release and partial claims', () => {
  let seed = 0x6c001;
  const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 1024; i++) {
    const count = 1 + next(6), expected = new Map<string, bigint>();
    const schedules = Array.from({ length: count }, (_n, j) => {
      const amount = BigInt(next(100000)) * 10n ** BigInt(next(20));
      const roster = Array.from({ length: 1 + next(12) }, (_m, k) => ({ owner: beneficiaryAddress(1 + k % 6), weight: BigInt(next(10000)) }));
      roster[0].weight += 1n;
      const total = roster.reduce((n, b) => n + b.weight, 0n);
      let assigned = 0n;
      for (const b of roster) {
        const n = amount * b.weight / total; assigned += n;
        if (n > 0n) expected.set(b.owner, (expected.get(b.owner) ?? 0n) + n);
      }
      const dust = amount - assigned;
      if (dust > 0n) expected.set(COMMUNITY, (expected.get(COMMUNITY) ?? 0n) + dust);
      return { id: id(j + 1), amount, roster };
    });
    const initialCash = schedules.reduce((n, g) => n + g.amount, 0n);
    let r = createFixedCalendar(i % 2 ? TOKEN : NATIVE, initialCash);
    for (const g of schedules) r = commitFixedGrant(r, g.id, g.amount, 0n, 100n, 200n, g.roster, COMMUNITY);
    assert.equal(fixedCalendarAccounting(r).escrow, initialCash);
    for (let j = schedules.length - 1; j >= 0; j--) r = releaseFixedGrant(r, schedules[j].id, 200n);
    assert.deepEqual(new Map([...r.ledger.claims].sort()), new Map([...expected].sort()));
    let delivered = 0n;
    for (const [owner, n] of expected) {
      const part = n / 3n;
      r = claimFixedGrant(r, owner, part); delivered += part;
      assert.equal(r.ledger.claims.get(owner) ?? 0n, n - part);
    }
    const a = fixedCalendarAccounting(r);
    assert.equal(a.cash, initialCash - delivered); assert.equal(a.claims, a.cash);
    assert.equal(a.escrow, 0n); assert.equal(a.unassigned, 0n); assert.equal(a.backed, true);
  }
});
test('account capacity is reserved at commitment to prevent a later beneficiary-count veto', () => {
  const roster = (start: number, length: number) => Array.from({ length }, (_n, j) => ({ owner: beneficiaryAddress(start + j), weight: 1n }));
  const initial = createFixedCalendar(TOKEN, 1000000n);
  const first = commitFixedGrant(initial, id(1), 10000n, 0n, 100n, 200n, roster(1, 32), COMMUNITY);
  const before = renderResearch(first);
  assert.throws(() => commitFixedGrant(first, id(2), 10000n, 0n, 100n, 200n, roster(33, 32), COMMUNITY), /future account cap/);
  assert.equal(renderResearch(first), before);
  // 61 owner addresses + one dust address + two reservation IDs = 64.
  const exact = commitFixedGrant(first, id(2), 10000n, 0n, 100n, 200n, roster(31, 31), COMMUNITY);
  const all = releaseFixedGrant(releaseFixedGrant(exact, id(1), 200n), id(2), 200n);
  assert.equal(fixedCalendarAccounting(all).claims, 20000n);
});
test('positive discounting or vesting reduces a deviation gain without eliminating it', () => {
  assert.deepEqual(c.vesting.gain, fraction(1n, 256n));
  for (const d of [fraction(1n), fraction(9n, 10n), fraction(1n, 2n)]) {
    for (const delay of [0, 1, 8, 64]) {
      const truth = discountedUtility(fraction(2n), [{ delay, amount: 1n }], d);
      const fake = discountedUtility(fraction(2n), [{ delay, amount: 2n }], d);
      assert.ok(subtractFraction(fake, truth).numerator > 0n);
    }
  }
  assert.deepEqual(c.fixedCalendar.gain, fraction(0n));
  assert.throws(() => discountedUtility(fraction(0n), [], fraction(2n)), RangeError);
  assert.throws(() => discountedUtility(fraction(0n), [{ delay: 65, amount: 1n }], fraction(1n)), RangeError);
  assert.throws(() => discountedUtility(fraction(0n), [{ delay: 1, amount: -1n }], fraction(1n)), RangeError);
});
test('each positive tested cap retains a funded exact-pivot same-allocation gain at its threshold', () => {
  for (const row of c.cappedShares.cases) {
    assert.equal(row.truth.certified, true); assert.equal(row.fake.certified, true);
    assert.ok(row.truth.deficit <= 0n && row.fake.deficit <= 0n);
    assert.deepEqual(row.truth.spend, [4n, 4n]); assert.deepEqual(row.fake.spend, row.truth.spend);
    assert.equal(row.truth.payment[0], 5n); assert.equal(row.fake.payment[0], 5n);
    assert.deepEqual(row.capped, [row.cap - 1n, row.cap]); assert.equal(row.gain, 1n);
  }
});
test('old surplus can influence the existence of later fixed promises and cannot be assumed exogenous', () => {
  const [truth, fake] = c.priorSurplusFunding.variants;
  assert.equal(truth.priorCash, 3n); assert.equal(truth.funded, false);
  assert.ok('failure' in truth && truth.failure === 'nominal liabilities exceed backing');
  assert.equal(fake.priorCash, 5n); assert.equal(fake.funded, true);
  assert.ok('nextClaim' in fake && fake.nextClaim === 2n);
  assert.throws(() => commitFixedGrant(createFixedCalendar(TOKEN, 0n), id(1), 1n, 0n, 100n, 200n, beneficiaries, COMMUNITY), /nominal liabilities exceed backing/);
});
test('a fixed gift is neutral only under unchanged feasible-flow gates, not every wallet-net interpretation', () => {
  const r = c.netFlowInterpretation;
  assert.equal(r.original.funded, true); assert.equal(r.oppositeResult.funded, true);
  assert.deepEqual(r.original.spend, [0n]); assert.deepEqual(r.original.payment, [0n]);
  assert.equal(r.oppositeResult.swapInput, 9n); assert.equal(r.oppositeResult.swapOutput, 3n);
  assert.deepEqual(r.oppositeResult.payment, [3n]);
  assert.deepEqual(r.originalTradeUtility, fraction(0n)); assert.equal(r.oppositeTradeUtility, null);
  assert.deepEqual(r.walletTruth, fraction(9n)); assert.deepEqual(r.walletOpposite, fraction(12n));
  assert.equal(walletUtility([3n, -9n], [0n, 0n], true, fraction(4n), 4n), null);
  assert.equal(walletUtility([-5n, 9n], [0n, 0n], true, fraction(4n), 4n), null);
  assert.throws(() => walletUtility([0n, 0n], [0n, -1n], true, fraction(4n), 4n), RangeError);
});
test('paying per started epoch can farm a fixed bonus despite zero fills; calendar replay cannot', () => {
  const r = c.emptyEpochFarming;
  assert.equal(r.emptyCandidate.funded, true); assert.deepEqual(r.emptyCandidate.spend, [0n]);
  assert.deepEqual(r.emptyCandidate.payment, [0n]); assert.deepEqual(r.emptyCandidate.unspent, [4n]);
  assert.equal(r.admissionTriggeredReward - r.noStartedEpochsReward, 9n);
  const released = releaseFixedGrant(grant(), id(1), 200n);
  assert.equal(released.ledger.claims.get(OWNER_A), 3n);
  for (let i = 0; i < r.starts; i++) assert.throws(() => releaseFixedGrant(released, id(1), 200n), RangeError);
});
test('invalid cutoffs, IDs, beneficiaries, corrupted reservations and resource bounds reject before mutation', () => {
  const initial = createFixedCalendar(TOKEN, 100n), before = renderResearch(initial);
  for (const [now, cutoff, due] of [[100n, 100n, 200n], [0n, 200n, 100n], [-1n, 100n, 200n]]) {
    assert.throws(() => commitFixedGrant(initial, id(1), 7n, now, cutoff, due, beneficiaries, COMMUNITY), RangeError);
  }
  for (const roster of [[], [{ owner: OWNER_A, weight: 0n }], Array(33).fill(beneficiaries[0]), [{ owner: NATIVE, weight: 1n }]]) {
    assert.throws(() => commitFixedGrant(initial, id(1), 7n, 0n, 100n, 200n, roster, COMMUNITY), RangeError);
  }
  assert.throws(() => createFixedCalendar('ETH', 1n), RangeError);
  assert.throws(() => createFixedCalendar(TOKEN, 1n << 256n), RangeError);
  assert.throws(() => commitFixedGrant(initial, '1', 7n, 0n, 100n, 200n, beneficiaries, COMMUNITY), RangeError);
  const r = grant();
  assert.throws(() => fixedCalendarAccounting({ ...r, ledger: { ...r.ledger, escrow: new Map() } }), /reservation mismatch/);
  assert.throws(() => fixedCalendarAccounting({ ...r, ledger: { ...r.ledger, cash: 6n } }), /nominal liabilities exceed backing/);
  assert.throws(() => commitFixedGrant(r, id(1), 0n, 0n, 100n, 200n, beneficiaries, COMMUNITY), RangeError);
  let max = createFixedCalendar(TOKEN, 100n);
  for (let i = 0; i < MAX_FIXED_GRANTS; i++) max = commitFixedGrant(max, id(i), 1n, 0n, 100n, 200n, beneficiaries, COMMUNITY);
  assert.throws(() => commitFixedGrant(max, id(99), 1n, 0n, 100n, 200n, beneficiaries, COMMUNITY), RangeError);
  assert.equal(renderResearch(initial), before);
});
test('redistribution design evidence regenerates byte for byte without altering earlier fixtures', () => {
  assert.equal(readFileSync('../fixtures/research/redistribution-research.json', 'utf8'), renderRedistributionCases());
});
console.log(`${groups} redistribution research groups passed`);
