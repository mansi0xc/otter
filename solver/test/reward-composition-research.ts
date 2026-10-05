import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Q96, Status, sqrtPriceAtTick } from '../src/execution.ts';
import { WAD } from '../src/discrete-research.ts';
import { costPivots, solveCostCandidate } from '../src/cost-grid-research.ts';
import { fraction } from '../src/representation-research.ts';
import { rewardUtility, sameRangeSplit } from '../src/reward-composition-research.ts';
import { rewardCompositionCase, renderRewardCompositionCase } from '../research/reward-composition-cases.ts';
import { id } from '../research/discrete-cases.ts';

let groups = 0;
function test(name: string, body: () => void) { body(); groups++; console.log(`PASS ${name}`); }
const c = rewardCompositionCase();
const sameOutcome = (a: ReturnType<typeof solveCostCandidate>, b: ReturnType<typeof solveCostCandidate>) => {
  const { quantityEvaluations: _a, ...x } = a, { quantityEvaluations: _b, ...y } = b;
  assert.deepEqual(x, y);
};

test('role example has fixed concave core tables and preserves partial-capacity diagnostics', () => {
  assert.deepEqual(c.frame.sell0.output, [0n, 7n, 13n, null]);
  assert.deepEqual(c.frame.sell1.output, [0n, 3n, 6n, null]);
  const partial = c.frame.sell0.quotes[3];
  assert.equal(partial.status, Status.PriceLimit); assert.equal(partial.requestedInput, 12n);
  assert.equal(partial.consumedInput, 8n); assert.equal(partial.output, 13n);
  assert.equal(c.down.status, Status.Complete); assert.equal(c.down.output, 13n);
  assert.equal(c.capital.weight, 58n); assert.deepEqual(c.weights, [58n, 58n]);
});
test('canonical bounded pivots agree with independent enumeration and original WAD asks', () => {
  sameOutcome(c.truth, solveCostCandidate(c.frame, c.honest, 'exhaustive'));
  sameOutcome(c.deviation, solveCostCandidate(c.frame, c.fake, 'exhaustive'));
  assert.deepEqual(c.truth.spend, [4n, 4n]); assert.deepEqual(c.deviation.spend, [4n, 4n]);
  assert.deepEqual(c.truth.payment, [6n, 4n]); assert.deepEqual(c.deviation.payment, [6n, 2n]);
  assert.deepEqual(c.truth.withoutWelfare, [6n, 5n]); assert.deepEqual(c.deviation.withoutWelfare, [6n, 9n]);
  for (const [r, raw] of [[c.truth, c.rawTruth], [c.deviation, c.rawDeviation]] as const) {
    assert.equal(r.certified, true); assert.equal(r.funded, true);
    assert.deepEqual(raw.spend, r.spend);
    assert.deepEqual(raw.paymentNumerator, r.payment.map(p => p * WAD));
    assert.deepEqual(raw.ceilPayment, r.payment);
    assert.deepEqual(raw.floorIRFailures, []);
    assert.deepEqual(raw.claimResidualNumerator, r.residual.map(p => p * WAD));
    r.payment.forEach((p, i) => assert.ok(p >= r.minimumPayment[i]));
  }
  assert.deepEqual(c.rawHonest.map(b => b.ask), [WAD, WAD / 4n]);
  assert.deepEqual(c.rawFake.map(b => b.ask), [WAD / 2n, WAD / 4n]);
});
test('trading and LP principal cancel but cash reward makes the ask deviation profitable', () => {
  assert.equal(c.truth.swapInput, c.deviation.swapInput);
  assert.equal(c.truth.swapOutput, c.deviation.swapOutput);
  assert.deepEqual(c.tradingTruth, fraction(2n)); assert.deepEqual(c.tradingDeviation, fraction(2n));
  assert.deepEqual(c.truth.residual, [0n, 3n]); assert.deepEqual(c.deviation.residual, [0n, 5n]);
  assert.equal(c.composedTruth.lpReward, 1n); assert.equal(c.composedDeviation.lpReward, 2n);
  assert.equal(c.composedTruth.distribution.dust, 1n); assert.equal(c.composedDeviation.distribution.dust, 1n);
  assert.deepEqual(c.composedTruth.utility, fraction(3n)); assert.deepEqual(c.composedDeviation.utility, fraction(4n));
  assert.deepEqual(c.noStakeTruth.utility, c.noStakeDeviation.utility);
  assert.deepEqual(c.fixedSubsidyTruth.utility, c.fixedSubsidyDeviation.utility);
});
test('controlled positions aggregate independently of names and keep fractional true utility exact', () => {
  const u = rewardUtility(fraction(-3n, 4n), 17n, [1n, 2n, 3n], [0, 2], true);
  assert.equal(u.lpReward, 10n); assert.equal(u.communityReward, 2n);
  assert.deepEqual(u.utility, fraction(45n, 4n));
  assert.equal(rewardUtility(fraction(0n), 17n, [1n, 2n, 3n], [2, 0]).lpReward, u.lpReward);
});
test('4096 same-range partitions cannot increase LP cash or LP-plus-controlled-dust cash', () => {
  let seed = 0x6b001;
  const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 4096; i++) {
    const price = sqrtPriceAtTick(next(800001) - 400000);
    const lower = next(1774544) - 887272, upper = lower + 1 + next(887272 - lower);
    const scale = 10n ** BigInt(next(21));
    const parts = Array.from({ length: 1 + next(8) }, () => (1n + BigInt(next(1000000000))) * scale);
    const others = Array.from({ length: 1 + next(8) }, () => 1n + BigInt(next(1000000)) * scale);
    const pot = BigInt(next(1000000)) * 10n ** BigInt(next(25));
    const r = sameRangeSplit(price, lower, upper, parts, others, pot);
    assert.ok(r.mergedWeight >= r.splitWeight);
    assert.ok(r.split.lpReward <= r.merged.lpReward);
    r.splitOthers.forEach((p, j) => assert.ok(p >= r.mergedOthers[j]));
    assert.ok(r.split.lpReward + r.split.distribution.dust <= r.merged.lpReward + r.merged.distribution.dust);
  }
  assert.ok(c.splitting.splitWeight < c.splitting.mergedWeight);
  assert.ok(c.splitting.split.lpReward < c.splitting.merged.lpReward);
});
test('1024 strict-margin profiles follow the report-dependent surplus family', () => {
  let positive = 0;
  for (let i = 0; i < 1024; i++) {
    const other = BigInt(i % 4), falseCost = other + 1n, trueCost = falseCost + 2n + BigInt(i % 5);
    const marginal = trueCost + 1n + BigInt(i % 7), first = marginal + BigInt(i % 11);
    const domain = { lotSize: 4n, output: [0n, first, first + marginal, null] };
    const bids = [{ id: id(1), costPerLot: trueCost, budget: 8n }, { id: id(2), costPerLot: other, budget: 4n }];
    const truth = costPivots(domain, bids), fake = costPivots(domain, [{ ...bids[0], costPerLot: falseCost }, bids[1]]);
    assert.deepEqual(truth.spend, [4n, 4n]); assert.deepEqual(fake.spend, truth.spend);
    assert.deepEqual(truth.payment, [marginal, trueCost]); assert.deepEqual(fake.payment, [marginal, falseCost]);
    assert.equal(truth.deficit, trueCost - first); assert.equal(fake.deficit, falseCost - first);
    const utility = fraction(marginal - trueCost);
    const a = rewardUtility(utility, -truth.deficit, [1n, 1n], [0]);
    const b = rewardUtility(utility, -fake.deficit, [1n, 1n], [0]);
    assert.ok(b.utility.numerator > a.utility.numerator); positive++;
  }
  assert.equal(positive, 1024);
});
test('invalid ownership indices, cash bounds and liquidity partitions fail explicitly', () => {
  for (const positions of [[0, 0], [-1], [2], [0.5]]) {
    assert.throws(() => rewardUtility(fraction(0n), 1n, [1n, 2n], positions), RangeError);
  }
  assert.throws(() => rewardUtility(fraction(0n), 1n, [1n], [], false, -1n), RangeError);
  assert.throws(() => rewardUtility(fraction(0n), 1n, [1n], [], false, 1n << 256n), RangeError);
  assert.throws(() => sameRangeSplit(Q96, -60, 60, [], [1n], 1n), RangeError);
  assert.throws(() => sameRangeSplit(Q96, -60, 60, [0n], [1n], 1n), RangeError);
  assert.throws(() => sameRangeSplit(Q96, -60, 60, Array(32).fill(1n), [1n], 1n), RangeError);
  assert.throws(() => sameRangeSplit(Q96, -60, 60, [1n << 127n, 1n << 127n], [1n], 1n), RangeError);
});
test('saved role-composition evidence is reproducible byte for byte', () => {
  assert.equal(readFileSync('../fixtures/research/reward-composition.json', 'utf8'), renderRewardCompositionCase());
});
console.log(`${groups} reward composition research groups passed`);
