import assert from 'node:assert/strict';
import { solveExact, selfCheck, type Order, type Outcome } from '../src/exact.ts';
import { OK, ERR_BUDGET, ERR_SPOT, ERR_MARGINAL, ERR_IR, ERR_DOMINANCE, ERR_BURN, WAD } from '../src/fixed.ts';
import {
  checkLegacyOutcome, ERR_LENGTH, ERR_DOMAIN, ERR_INELIGIBLE, ERR_MINORITY,
  MAX_BUDGET, MAX_ASK, MAX_RESERVE, MAX_UINT256,
} from '../src/settlement-check.ts';

let groups = 0;
function test(name: string, body: () => void) { body(); groups++; console.log(`PASS ${name}`); }
const L = 10n ** 21n;
function matched(budget = 4n, ask = WAD / 4n, dom0 = true, minorityFirst = false) {
  const mi = minorityFirst ? 0 : 1, di = 1 - mi, owed = budget / 4n;
  const orders: Order[] = new Array(2);
  orders[di] = { trader: 'D', sellingCurrency0: dom0, ask: 0n, budget: owed || 1n };
  orders[mi] = { trader: 'm', sellingCurrency0: !dom0, ask, budget };
  const out: Outcome = {
    dominantSellsCurrency0: dom0, y: [0n, 0n], x: [0n, 0n], burn: 0n,
    clampDisplacement: [0n, 0n],
    // Deliberately false metadata: the arithmetic result must not trust it.
    diagnostics: { dDominant: 0n, dMinority: 0n, M: 0n, totalIn: 0n, totalPaid: 0n },
  };
  out.y[di] = owed; out.x[di] = owed * 4n;
  out.y[mi] = budget; out.x[mi] = owed;
  return { r0: dom0 ? L / 2n : L * 2n, r1: dom0 ? L * 2n : L / 2n, orders, out, mi, di };
}
type Case = ReturnType<typeof matched>;
const check = (c: Case) => selfCheck(c.r0, c.r1, c.orders, c.out);
const expect = (c: Case, code: number, index = 0) => {
  const v = check(c); assert.equal(v.code, code); assert.equal(v.index, index); return v;
};

test('legacy dominant code mapping stays unchanged', () => {
  assert.deepEqual([OK, ERR_BUDGET, ERR_SPOT, ERR_MARGINAL, ERR_IR, ERR_DOMINANCE, ERR_BURN], [0, 1, 2, 3, 4, 5, 6]);
});
test('whole minority spot accepts in both directions and original order positions', () => {
  for (const d of [true, false]) for (const first of [true, false]) {
    const c = matched(4n, WAD / 4n, d, first), v = expect(c, OK);
    assert.deepEqual([v.totalIn, v.totalPaid, v.burn], [1n, 4n, 0n]);
  }
});
test('zero and nonzero below-minimum minority payments reject at the stored index', () => {
  for (const b of [1n, 5n]) for (const d of [true, false]) for (const first of [true, false]) {
    const c = matched(b, WAD / 4n, d, first); expect(c, ERR_IR, c.mi);
  }
});
test('one WAD ask unit crosses the signed ceiling without changing the spot floor', () => {
  expect(matched(5n, WAD / 5n), OK);
  expect(matched(5n, WAD / 5n + 1n), ERR_IR, 1);
});
test('eligible minority must spend its full budget', () => {
  for (const y of [0n, 3n, 5n]) { const c = matched(); c.out.y[c.mi] = y; expect(c, ERR_MINORITY, c.mi); }
});
test('eligible minority must receive exactly the prescribed floor', () => {
  for (const x of [0n, 2n]) { const c = matched(); c.out.x[c.mi] = x; expect(c, ERR_MINORITY, c.mi); }
});
test('ineligible minority cannot receive a fill or an output', () => {
  for (const [y, x] of [[4n, 0n], [0n, 1n], [4n, 1n]]) {
    const c = matched(4n, WAD / 4n + 1n); c.out.y[c.mi] = y; c.out.x[c.mi] = x;
    expect(c, ERR_INELIGIBLE, c.mi);
  }
});
test('ineligible minority contributes no crossing; feasible zero fills remain noncanonical', () => {
  const c = matched(4n, WAD / 4n + 1n); c.out.y = [0n, 0n]; c.out.x = [0n, 0n]; expect(c, OK);
});
test('forged diagnostics cannot hide missing dominant input', () => {
  const c = matched(); c.out.y[c.di] = 0n; c.out.x[c.di] = 0n;
  const v = expect(c, ERR_DOMINANCE);
  assert.deepEqual([v.arg0, v.arg1], [0n, 1n]);
});
test('metadata may be absent or poisoned without becoming an economic input', () => {
  const c = matched();
  const minimal = { dominantSellsCurrency0: true, y: c.out.y, x: c.out.x };
  assert.deepEqual(checkLegacyOutcome(c.r0, c.r1, c.orders, minimal), check(c));
  Object.assign(c.out, { diagnostics: null, burn: -1n, clampDisplacement: ['invalid'] });
  expect(c, OK);
});
test('minority classification precedes dominant minimum verification', () => {
  const c = matched(); c.orders[c.di].ask = 4n * WAD; c.out.x[c.di] = 3n;
  c.out.x[c.mi] = 0n; expect(c, ERR_MINORITY, c.mi);
  c.out.x[c.mi] = 1n; expect(c, ERR_IR, c.di);
});
test('dominant budget, spot and marginal checks retain their meaning', () => {
  const budget = matched(); budget.out.y[budget.di] = 2n; expect(budget, ERR_BUDGET, budget.di);
  const spot = matched(); spot.out.x[spot.di] = 5n; expect(spot, ERR_SPOT, spot.di);
  const marginal = matched(4n, WAD / 4n + 1n); marginal.out.y[marginal.mi] = 0n; marginal.out.x[marginal.mi] = 0n;
  expect(marginal, ERR_MARGINAL, marginal.di);
});
test('length mismatch and sparse output arrays fail rather than throw', () => {
  for (const key of ['y', 'x'] as const) {
    const short = matched(); short.out[key].pop(); expect(short, ERR_LENGTH);
    const long = matched(); long.out[key].push(0n); expect(long, ERR_LENGTH);
    const sparse = matched(); delete sparse.out[key][1]; expect(sparse, ERR_DOMAIN, 1);
  }
  const c = matched(); (c.out as unknown as { y: null }).y = null; expect(c, ERR_LENGTH);
});
test('zero, negative, overflowing and non-BigInt reserves are outside preflight support', () => {
  for (const bad of [0n, -1n, MAX_RESERVE + 1n, 1 as unknown as bigint]) {
    const a = matched(); a.r0 = bad; expect(a, ERR_DOMAIN);
    const b = matched(); b.r1 = bad; expect(b, ERR_DOMAIN);
  }
});
test('order and proposed output numbers are bounded unsigned integers', () => {
  for (const ask of [-1n, MAX_ASK + 1n, 1 as unknown as bigint]) {
    const c = matched(); c.orders[c.mi].ask = ask; expect(c, ERR_DOMAIN, c.mi);
  }
  for (const budget of [0n, -1n, MAX_BUDGET + 1n, 1 as unknown as bigint]) {
    const c = matched(); c.orders[c.mi].budget = budget; expect(c, ERR_DOMAIN, c.mi);
  }
  for (const key of ['y', 'x'] as const) for (const bad of [-1n, MAX_UINT256 + 1n, 1 as unknown as bigint]) {
    const c = matched(); c.out[key][c.mi] = bad; expect(c, ERR_DOMAIN, c.mi);
  }
  const uintMax = matched(); uintMax.out.y[0] = MAX_UINT256; expect(uintMax, ERR_BUDGET);
});
test('Boolean fields cannot be interpreted by JavaScript truthiness', () => {
  const c = matched(); (c.out as unknown as { dominantSellsCurrency0: number }).dominantSellsCurrency0 = 1; expect(c, ERR_DOMAIN);
  const o = matched(); (o.orders[1] as unknown as { sellingCurrency0: number }).sellingCurrency0 = 0; expect(o, ERR_DOMAIN, 1);
});
test('count and per-side aggregates match the admission envelope', () => {
  const c = matched(); c.orders = []; c.out.y = []; c.out.x = []; expect(c, ERR_DOMAIN);
  for (const n of [32, 33]) {
    const orders = Array.from({ length: n }, () => ({ trader: 'D', sellingCurrency0: true, ask: 0n, budget: 1n }));
    const v = checkLegacyOutcome(L, L, orders, { dominantSellsCurrency0: true, y: orders.map(() => 0n), x: orders.map(() => 0n) });
    assert.equal(v.code, n === 32 ? OK : ERR_DOMAIN);
  }
  for (const side of [true, false]) {
    const orders = [MAX_BUDGET, 1n].map(budget => ({ trader: 'D', sellingCurrency0: side, ask: 0n, budget }));
    const v = checkLegacyOutcome(L, L, orders, { dominantSellsCurrency0: side, y: [0n, 0n], x: [0n, 0n] });
    assert.equal(v.code, ERR_DOMAIN); assert.equal(v.index, 1);
    orders[0].budget--;
    assert.equal(checkLegacyOutcome(L, L, orders, { dominantSellsCurrency0: side, y: [0n, 0n], x: [0n, 0n] }).code, OK);
  }
});
test('largest supported reserves and ask do not overflow admitted arithmetic', () => {
  for (const r0 of [1n, MAX_RESERVE]) for (const r1 of [1n, MAX_RESERVE]) {
    const orders = [{ trader: 'D', sellingCurrency0: true, ask: MAX_ASK, budget: MAX_BUDGET }];
    assert.equal(checkLegacyOutcome(r0, r1, orders, { dominantSellsCurrency0: true, y: [0n], x: [0n] }).code, OK);
  }
  const orders = [{ trader: 'D', sellingCurrency0: true, ask: 0n, budget: MAX_BUDGET }];
  const v = checkLegacyOutcome(MAX_RESERVE, MAX_RESERVE, orders,
    { dominantSellsCurrency0: true, y: [MAX_BUDGET], x: [0n] });
  assert.equal(v.code, OK);
  // Independent fraction comparison exercises the 240-bit reserve product.
  const denom = MAX_RESERVE + MAX_BUDGET;
  const raw = MAX_RESERVE - (MAX_RESERVE ** 2n + denom - 1n) / denom;
  assert.equal(v.burn, raw - 3n);
  orders.push({ trader: 'm', sellingCurrency0: false, ask: MAX_ASK, budget: 1n });
  assert.equal(checkLegacyOutcome(MAX_RESERVE, MAX_RESERVE, orders,
    { dominantSellsCurrency0: true, y: [0n, 0n], x: [0n, 0n] }).code, OK); // 248-bit eligibility product.
  orders[1].ask = 0n; orders[1].budget = MAX_BUDGET;
  const owed = MAX_RESERVE * MAX_BUDGET;
  const insufficient = checkLegacyOutcome(MAX_RESERVE, 1n, orders,
    { dominantSellsCurrency0: true, y: [MAX_BUDGET, MAX_BUDGET], x: [0n, owed] });
  assert.equal(insufficient.code, ERR_DOMINANCE);
  assert.deepEqual([insufficient.arg0, insufficient.arg1], [MAX_BUDGET, owed]);
});
test('raw zero asks remain valid even when the minority spot floor is zero', () => {
  expect(matched(1n, 0n), OK);
});
test('uint96 maximum and neighboring whole-payment budgets remain distinct', () => {
  for (const d of [true, false]) {
    expect(matched(MAX_BUDGET, WAD / 4n, d), ERR_IR, 1);
    expect(matched(MAX_BUDGET - 3n, WAD / 4n, d), OK);
  }
});
test('exhaustive small boundaries use independent exact signed-product inequalities', () => {
  for (let b = 1n; b <= 64n; b++) {
    const threshold = (b / 4n) * WAD / b;
    for (const ask of new Set([0n, threshold, threshold + 1n, WAD / 4n, WAD / 4n + 1n])) {
      for (const d of [true, false]) for (const first of [true, false]) {
        const c = matched(b, ask, d, first);
        const expected = ask * 4n > WAD ? ERR_INELIGIBLE : (b / 4n) * WAD < ask * b ? ERR_IR : OK;
        expect(c, expected, expected === OK ? 0 : c.mi);
      }
    }
  }
});
test('512 deterministic BigInt samples cover full-width budget floor boundaries', () => {
  let state = 0x123456789abcdef123456789n;
  for (let i = 0; i < 512; i++) {
    state ^= state << 13n; state ^= state >> 17n; state ^= state << 5n; state &= MAX_BUDGET;
    const b = (state & ~3n) | 1n, ask = (b / 4n) * WAD / b;
    const c = matched(b, ask, i % 2 === 0, i % 3 === 0); expect(c, OK);
    c.orders[c.mi].ask++; expect(c, ERR_IR, c.mi);
  }
});
test('legacy generator remains capable of unsafe candidates; preflight rejects them', () => {
  const c = matched(1n, WAD / 4n), out = solveExact(c.r0, c.r1, c.orders);
  assert.equal(out.dominantSellsCurrency0, true); assert.equal(out.y[c.mi], 1n); assert.equal(out.x[c.mi], 0n);
  assert.equal(selfCheck(c.r0, c.r1, c.orders, out).code, ERR_IR);
  const dust = [{ trader: 'D', sellingCurrency0: true, ask: 9n * WAD / 10n, budget: 10n }];
  const dustOut = solveExact(L, L, dust);
  assert.deepEqual([dustOut.y[0], dustOut.x[0]], [10n, 6n]);
  assert.equal(selfCheck(L, L, dust, dustOut).code, ERR_IR);
});
console.log(`${groups} settlement preflight groups passed; no mechanism selected.`);
