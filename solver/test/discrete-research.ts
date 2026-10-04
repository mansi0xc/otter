import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WAD, MAX_LOTS, MAX_BIDS, executionTable, optimize, exhaustive, pivots,
  concavity, refundOnDeficit, minorityAtSpot, type Domain, type Bid,
} from '../src/discrete-research.ts';
import { Q96, MAX_INPUT, MAX_OUTPUT, IncompleteSnapshot, Status, sqrtPriceAtTick, tickAtSqrtPrice } from '../src/execution.ts';
import { bid, id, pool, fullPool, cases, renderCases } from '../research/discrete-cases.ts';

let groups = 0;
function test(name: string, body: () => void): void { body(); groups++; console.log(`PASS ${name}`); }
const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);
const canonical = (bids: readonly Bid[], fill: readonly bigint[]) => bids.map((b, i) => [b.id, fill[i]]).sort();
const same = (a: ReturnType<typeof optimize>, b: ReturnType<typeof optimize>) => {
  for (const key of ['fill', 'totalInput', 'output', 'welfareNumerator', 'costNumerator'] as const) {
    assert.deepEqual(a[key], b[key], key);
  }
};
const c = cases();

test('raw v4 staircase creates unfunded pivot payments before any rounding', () => {
  const r = c.pivotFunding.result;
  assert.deepEqual(c.pivotFunding.curve.slice(0, 4), [0n, 0n, 1n, 2n]);
  assert.deepEqual(r.fill, [1n, 1n]);
  assert.deepEqual(r.paymentNumerator, [WAD, WAD]);
  assert.equal(r.output, 1n);
  assert.equal(r.rawDeficitNumerator, WAD);
  assert.equal(r.ceilDeficit, 1n);
  assert.equal(r.ceilResidual, -1n, 'must not turn an unfunded result into zero burn');
});
test('linear-welfare optimal fills need more integer IR payments than exist', () => {
  const r = c.noIntegerIRPaymentVector.result;
  assert.equal(r.welfareNumerator, WAD * 4n / 5n);
  assert.deepEqual(r.minimumPayment, [1n, 1n]);
  assert.equal(c.noIntegerIRPaymentVector.minimumTotal, 2n);
  assert.ok(sum(r.minimumPayment) > r.output);
});
test('rounding alone can turn a rationally funded pivot vector into a deficit', () => {
  const r = c.roundingOnlyDeficit.result;
  assert.equal(r.rawDeficitNumerator, 0n);
  assert.deepEqual(r.paymentNumerator, [WAD / 2n, WAD / 2n]);
  assert.equal(r.ceilDeficit, 1n);
  assert.deepEqual(r.floorIRFailures, [0, 1]);
});
test('refund-on-deficit negative control admits a profitable ask deviation', () => {
  const r = c.refundOnDeficitDeviation;
  assert.ok(r.honest.ceilDeficit > 0n);
  assert.equal(r.dishonest.ceilDeficit, 0n);
  assert.deepEqual(r.truthful.fill, [0n, 0n]);
  assert.deepEqual(r.deviating.fill, [2n, 1n]);
  assert.equal(r.gainNumerator, 2n * WAD);
  assert.deepEqual(refundOnDeficit(r.honest), r.truthful);
});
test('ceil pivot payments permit ask manipulation even on a concave funded table', () => {
  const r = c.ceilPaymentAskDeviation;
  assert.equal(r.certificate.concave, true);
  assert.equal(r.truth.ceilDeficit, 0n);
  assert.equal(r.deviation.ceilDeficit, 0n);
  assert.deepEqual(r.truth.fill, [0n, 1n]);
  assert.deepEqual(r.deviation.fill, [1n, 0n]);
  assert.equal(r.gainNumerator, WAD / 4n);
  assert.equal(r.partialRequest.status, Status.PriceLimit);
  assert.equal(r.partialRequest.requestedInput, 2n);
  assert.equal(r.partialRequest.consumedInput, 1n);
  assert.equal(r.partialRequest.output, 2n);
  assert.deepEqual(r.curve, [0n, 2n, null, null]);
});
test('two identities profit from payment rounding without changing total input', () => {
  const r = c.ceilPaymentFalseName;
  assert.deepEqual(r.curve, [0n, 2n, 4n, null, null]);
  assert.equal(r.certificate.concave, true);
  assert.equal(r.unsplit.totalInput, 2n);
  assert.equal(r.split.totalInput, 2n);
  assert.equal(r.unsplit.ceilDeficit, 0n);
  assert.equal(r.split.ceilDeficit, 0n);
  assert.equal(r.rawGainNumerator, 0n);
  assert.equal(r.roundedGain, 1n);
  assert.deepEqual(r.split.ceilPayment, [1n, 1n, 0n]);
  assert.equal(r.partialRequest.status, Status.PriceLimit);
  assert.equal(r.partialRequest.requestedInput, 3n);
  assert.equal(r.partialRequest.consumedInput, 2n);
  assert.equal(r.partialRequest.output, 4n);
});
test('floor minority spot compensation fails integer IR in either orientation', () => {
  const r = c.minorityDust;
  assert.deepEqual(r.sellsCurrency1, { eligible: true, floorPayment: 0n, minimumPayment: 1n, ir: false });
  assert.equal(r.sellsCurrency0.ir, true);
  const inverse = minorityAtSpot(Q96 / 2n, true, WAD / 5n, 1n);
  assert.deepEqual(inverse, { eligible: true, floorPayment: 0n, minimumPayment: 1n, ir: false });
  assert.equal(minorityAtSpot(Q96, true, WAD + 1n, 1n).eligible, false);
});
test('independent Cartesian optimizer matches every published counterfactual', () => {
  const staircase: Domain = { lotSize: 1n, output: c.pivotFunding.curve };
  const inputs: { d: Domain; bids: Bid[] }[] = [
    ...[c.pivotFunding.bids, c.noIntegerIRPaymentVector.bids, c.roundingOnlyDeficit.bids,
      c.refundOnDeficitDeviation.honestBids, c.refundOnDeficitDeviation.dishonestBids]
      .map(bids => ({ d: staircase, bids })),
    { d: { lotSize: 1n, output: c.ceilPaymentAskDeviation.curve },
      bids: [bid(1, WAD * 3n / 4n, 1n), bid(2, WAD / 2n, 1n)] },
    { d: { lotSize: 1n, output: c.ceilPaymentAskDeviation.curve },
      bids: [bid(1, WAD / 4n, 1n), bid(2, WAD / 2n, 1n)] },
    { d: { lotSize: 1n, output: c.ceilPaymentFalseName.curve }, bids: c.ceilPaymentFalseName.unsplitBids },
    { d: { lotSize: 1n, output: c.ceilPaymentFalseName.curve }, bids: c.ceilPaymentFalseName.splitBids },
  ];
  for (const { d, bids } of inputs) {
    const fast = pivots(d, bids);
    const slow = pivots(d, bids, 'exhaustive');
    same(fast, slow);
    for (const field of ['paymentNumerator', 'withoutWelfareNumerator', 'ceilPayment', 'ceilDeficit'] as const) {
      assert.deepEqual(fast[field], slow[field]);
    }
  }
});
test('fixed lot remainders, ineligible asks and zero allocations remain explicit', () => {
  const d: Domain = { lotSize: 10n, output: [0n, 10n, 19n] };
  const bids = [bid(1, 0n, 23n), bid(2, (1n << 128n) - 1n, 10n), bid(3, 0n, 9n)];
  const r = pivots(d, bids);
  assert.deepEqual(r.fill, [20n, 0n, 0n]);
  assert.deepEqual(r.unspent, [3n, 10n, 9n]);
  assert.deepEqual(r.ceilPayment, [19n, 0n, 0n]);
  assert.equal(r.ceilDeficit, 0n);
  assert.equal(r.paymentNumerator[1], 0n);
});
test('finite supported capacity and unsupported holes are not requested-input output', () => {
  const d: Domain = { lotSize: 1n, output: [0n, 2n, null, null] };
  assert.equal(optimize(d, [bid(1, 0n, MAX_INPUT)]).totalInput, 1n);
  assert.equal(concavity(d).supportedLots, 1);
  const holes: Domain = { lotSize: 1n, output: [0n, null, 1n, 2n] };
  assert.equal(concavity(holes).contiguous, false);
  assert.equal(concavity(holes).concave, false);
  same(optimize(holes, [bid(1, 0n, 3n)]), exhaustive(holes, [bid(1, 0n, 3n)]));
});
test('quantity-maximizing ties and ask/identity priority are arrival independent', () => {
  const d: Domain = { lotSize: 1n, output: [0n, 2n, 2n] };
  const bids = [bid(2, 0n, 2n), bid(1, 0n, 2n)];
  const a = pivots(d, bids), b = pivots(d, [...bids].reverse());
  assert.deepEqual(a.fill, [0n, 2n]);
  assert.deepEqual(canonical(bids, a.fill), canonical([...bids].reverse(), b.fill));
  same(a, exhaustive(d, bids));
  const zero: Domain = { lotSize: 1n, output: [0n, 0n, 0n] };
  assert.equal(optimize(zero, [bid(1, 0n, 2n)]).totalInput, 2n);
});
test('malformed inputs and bounded research work fail explicitly', () => {
  const d: Domain = { lotSize: 1n, output: [0n, 2n] };
  for (const output of [[1n], [0n, -1n], [0n, MAX_OUTPUT + 1n], []]) {
    assert.throws(() => optimize({ lotSize: 1n, output }, []), RangeError);
  }
  assert.throws(() => optimize({ lotSize: 0n, output: [0n] }, []), RangeError);
  assert.throws(() => optimize({ lotSize: MAX_INPUT, output: [0n, 1n, 2n] }, []), RangeError);
  assert.throws(() => optimize({ lotSize: 1n, output: Array(MAX_LOTS + 2).fill(0n) }, []), RangeError);
  assert.throws(() => optimize(d, Array.from({ length: MAX_BIDS + 1 }, (_, i) => bid(i, 0n, 1n))), RangeError);
  assert.throws(() => optimize(d, [bid(1, -1n, 1n)]), RangeError);
  assert.throws(() => optimize(d, [bid(1, 1n << 128n, 1n)]), RangeError);
  assert.throws(() => optimize(d, [bid(1, 0n, MAX_INPUT + 1n)]), RangeError);
  assert.throws(() => optimize(d, [bid(1, 0n, 1n), bid(1, 0n, 2n)]), RangeError);
  assert.throws(() => optimize(d, [{ id: 'A', ask: 0n, budget: 1n }]), RangeError);
  assert.throws(() => exhaustive({ lotSize: 1n, output: Array(65).fill(0n) },
    Array.from({ length: 8 }, (_, i) => bid(i, 0n, 64n))), RangeError);
  assert.throws(() => executionTable(fullPool(1000n), true, Q96 - 1n, 1n, 65), RangeError);
  assert.throws(() => executionTable(fullPool(1000n), true, Q96 - 1n, 0n, 1), RangeError);
  assert.throws(() => executionTable({ ...fullPool(1000n), bitmap: new Map() }, true, sqrtPriceAtTick(-100), 1n, 2), IncompleteSnapshot);
});

let seed = 0x04D2026;
function random(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
test('3000 bounded real-model tables: independent optimization, pivots and IR', () => {
  const tables = [];
  for (const down of [false, true]) {
    for (const s of [fullPool(1000n), fullPool(1000n, 60, Q96 * 3n / 2n),
      pool([{ lower: -240, upper: 240, liquidity: 1000n }, { lower: -960, upper: -480, liquidity: 1000n },
        { lower: 480, upper: 960, liquidity: 1000n }])]) {
      for (const lot of [1n, 10n, 100n]) {
        tables.push(executionTable(s, down, sqrtPriceAtTick(down ? -40_000 : 40_000), lot, 12));
      }
    }
  }
  for (let i = 0; i < 3000; i++) {
    const d = tables[random() % tables.length];
    const bids = Array.from({ length: 1 + random() % 4 }, (_, j) => bid(j + 1,
      BigInt(random() % 17) * WAD / 8n, BigInt(random() % 5) * d.lotSize + BigInt(random() % Number(d.lotSize))));
    const fast = pivots(d, bids), slow = pivots(d, bids, 'exhaustive');
    same(fast, slow);
    assert.deepEqual(fast.paymentNumerator, slow.paymentNumerator);
    assert.deepEqual(fast.withoutWelfareNumerator, slow.withoutWelfareNumerator);
    assert.ok(fast.welfareNumerator >= 0n);
    for (let j = 0; j < bids.length; j++) {
      assert.ok(fast.fill[j] >= 0n && fast.fill[j] <= bids[j].budget);
      assert.equal(fast.fill[j] % d.lotSize, 0n);
      assert.equal(fast.fill[j] + fast.unspent[j], bids[j].budget);
      assert.ok(fast.ceilPayment[j] >= fast.minimumPayment[j]);
    }
    assert.deepEqual(canonical(bids, fast.fill), canonical([...bids].reverse(), pivots(d, [...bids].reverse()).fill));
  }
});
test('1000 finite concave tables: ceil pivots are funded with integer IR', () => {
  for (let i = 0; i < 1000; i++) {
    const outputs = [0n];
    let marginal = BigInt(random() % 8);
    for (let q = 0; q < 8; q++) {
      if (marginal > 0n && random() % 3 === 0) marginal--;
      outputs.push(outputs[outputs.length - 1] + marginal);
    }
    const d: Domain = { lotSize: 1n, output: outputs };
    assert.equal(concavity(d).concave, true);
    const bids = Array.from({ length: 1 + random() % 4 }, (_, j) => bid(j + 1,
      BigInt(random() % 41) * WAD / 8n, BigInt(random() % 5)));
    const r = pivots(d, bids);
    assert.equal(r.ceilDeficit, 0n);
    assert.ok(sum(r.ceilPayment) <= r.output);
    for (let j = 0; j < bids.length; j++) assert.ok(r.ceilPayment[j] >= r.minimumPayment[j]);
  }
});
test('exhaustive ask/cap deviations satisfy the limited sub-unit rounding bound', () => {
  // This is NOT exact DSIC and NOT a false-name or two-sided guarantee.
  const grids: Domain[] = [
    { lotSize: 1n, output: [0n, 0n, 1n, 2n] },
    { lotSize: 1n, output: [0n, 2n, 4n] },
    { lotSize: 1n, output: [0n, 3n, 5n, 6n] },
  ];
  let comparisons = 0;
  for (const d of grids) {
    for (let trueTick = 0; trueTick <= 8; trueTick++) for (let otherTick = 0; otherTick <= 8; otherTick++) {
      const trueAsk = BigInt(trueTick) * WAD / 4n;
      for (let cap = 1n; cap <= 3n; cap++) {
        const honest = pivots(d, [bid(1, trueAsk, cap), bid(2, BigInt(otherTick) * WAD / 4n, 2n)]);
        const trueRaw = honest.paymentNumerator[0] - trueAsk * honest.fill[0];
        const trueRounded = honest.ceilPayment[0] * WAD - trueAsk * honest.fill[0];
        for (let report = 0; report <= 8; report++) for (let reportCap = 0n; reportCap <= 4n; reportCap++) {
          const fake = pivots(d, [bid(1, BigInt(report) * WAD / 4n, reportCap), bid(2, BigInt(otherTick) * WAD / 4n, 2n)]);
          if (fake.fill[0] > cap) continue; // catastrophic true-budget violation
          const raw = fake.paymentNumerator[0] - trueAsk * fake.fill[0];
          const rounded = fake.ceilPayment[0] * WAD - trueAsk * fake.fill[0];
          assert.ok(raw <= trueRaw);
          assert.ok(rounded - trueRounded < WAD);
          comparisons++;
        }
      }
    }
  }
  assert.ok(comparisons > 20_000);
  console.log(`  ${comparisons} feasible single-identity deviations; no refund fallback or LP utility`);
});
test('local concavity certificate detects staircase and does not bless missing state', () => {
  const d: Domain = { lotSize: 1n, output: c.pivotFunding.curve };
  assert.deepEqual(concavity(d), { contiguous: true, concave: false, supportedLots: 6, violationAt: 2 });
  const s = fullPool(1000n, 60);
  const before = structuredClone(s);
  const table = executionTable(s, true, sqrtPriceAtTick(-40_000), 100n, 16);
  assert.equal(concavity(table).concave, true);
  assert.deepEqual(s, before, 'table construction must not apply sequential swaps');
  assert.equal(concavity(table).supportedLots, 16);
  assert.ok(id(1) < id(2));
});
test('checked-in counterexamples reproduce byte-for-byte with decimal BigInt fields', () => {
  const saved = readFileSync(new URL('../../fixtures/research/discrete-counterexamples.json', import.meta.url), 'utf8');
  assert.equal(saved, renderCases());
});

console.log(`${groups} discrete research groups passed; unsafe-candidate reproductions remain open findings.`);
