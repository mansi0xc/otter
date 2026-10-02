/** Review reproductions. Passing assertions confirm existing boundary failures. */
import assert from 'node:assert/strict';
import { solveExact, selfCheck, type Order } from '../src/exact.ts';
import { ERR_IR, OK, eligible } from '../src/fixed.ts';

const WAD = 10n ** 18n;
const reserve = 10n ** 21n;
const dust: Order[] = [{ trader: 'A', sellingCurrency0: true, ask: 9n * WAD / 10n, budget: 10n }];
const dustOut = solveExact(reserve, reserve, dust);
assert.equal(dustOut.y[0], 10n);
assert.equal(dustOut.x[0], 6n);
assert.equal(selfCheck(reserve, reserve, dust, dustOut).code, ERR_IR);
console.log('CONFIRMED: valid dust input returns payment 6, below required 9; selfCheck rejects.');

const tied: Order[] = [
  { trader: 'A', sellingCurrency0: true, ask: WAD / 4n, budget: 1000n },
  { trader: 'B', sellingCurrency0: true, ask: WAD / 4n, budget: 1000n },
];
for (const orders of [tied, [...tied].reverse()]) {
  const out = solveExact(1000n, 1000n, orders);
  assert.equal(selfCheck(1000n, 1000n, orders, out).code, OK);
  assert.deepEqual(out.y, [1000n, 0n]);
  console.log('CONFIRMED: arrival-order tie winner:', orders[0].trader);
}

const hugeAsk = (1n << 256n) - 1n;
assert.equal(eligible({ x0: reserve, y0: reserve, M: 0n }, hugeAsk), false);
assert.ok(hugeAsk * reserve > hugeAsk);
console.log('CONFIRMED: BigInt eligibility handles a product that Solmate uint256 multiplication rejects.');
