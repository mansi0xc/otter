import assert from 'node:assert/strict';
import { Q96, sqrtPriceAtTick } from '../src/execution.ts';
import { capitalWeight, divideReward } from '../src/rewards.ts';

let groups = 0;
function test(name: string, body: () => void) { body(); groups++; console.log(`PASS ${name}`); }
test('capital includes actual rounded principal rather than full-range virtual reserves', () => {
  const small = capitalWeight(Q96, -887272, 887272, 1n);
  assert.deepEqual(small, { principal0: 0n, principal1: 0n, weight: 0n });
  const full = capitalWeight(Q96, -887272, 887272, 10n ** 21n);
  assert.equal(full.principal0, full.principal1); assert.equal(full.weight, full.principal0 * 2n);
  const narrow = capitalWeight(Q96, -60, 60, 10n ** 21n);
  assert.ok(narrow.weight < full.weight);
});
test('inactive principal is weighted at opening spot and exact raw price is retained', () => {
  const below = capitalWeight(Q96, 60, 120, 1000000n);
  assert.equal(below.principal1, 0n); assert.equal(below.weight, below.principal0);
  const above = capitalWeight(Q96, -120, -60, 1000000n);
  assert.equal(above.principal0, 0n); assert.equal(above.weight, above.principal1);
  const r = capitalWeight(Q96 * 3n / 2n, -887272, 887272, 1000n);
  assert.equal(r.weight, r.principal1 + r.principal0 * 9n / 4n);
});
test('reward division retains exact dust across 4096 seeded pots including zero weights', () => {
  let seed = 0x6a001;
  const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let i = 0; i < 4096; i++) {
    const amount = BigInt(next(1000000)) * 10n ** BigInt(next(24));
    const weights = Array.from({ length: 1 + next(32) }, () => BigInt(next(100000)));
    weights[0] += 1n;
    const r = divideReward(amount, weights), total = weights.reduce((a, b) => a + b, 0n);
    assert.equal(r.rewards.reduce((a, b) => a + b, r.dust), amount);
    assert.ok(r.dust < BigInt(weights.length));
    r.rewards.forEach((q, j) => {
      assert.ok(q * total <= amount * weights[j]);
      assert.ok((q + 1n) * total > amount * weights[j]);
    });
  }
  const huge = (1n << 256n) - 1n;
  const r = divideReward(huge, [huge / 2n, huge / 2n]);
  assert.equal(r.dust, 1n); assert.equal(r.rewards[0], huge / 2n);
});
test('malformed bounds, unsupported prices and zero-weight epochs are rejected', () => {
  for (const p of [0n, (1n << 64n) - 1n, 1n << 128n]) assert.throws(() => capitalWeight(p, -60, 60, 1n), RangeError);
  assert.throws(() => capitalWeight(Q96, 60, 60, 1n), RangeError);
  assert.throws(() => capitalWeight(Q96, -887273, 60, 1n), RangeError);
  assert.throws(() => capitalWeight(Q96, -60, 60, 1n << 128n), RangeError);
  assert.ok(capitalWeight(sqrtPriceAtTick(400000), -887272, 887272, (1n << 88n) - 1n).weight > 0n);
  for (const weights of [[], [0n], [-1n], Array(33).fill(1n)]) assert.throws(() => divideReward(1n, weights), RangeError);
  assert.throws(() => divideReward(-1n, [1n]), RangeError);
});
console.log(`${groups} historical reward reference groups passed`);
