import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAD, type Domain } from '../src/discrete-research.ts';
import { MAX_INPUT, Q96, sqrtPriceAtTick } from '../src/execution.ts';
import { buildLotFrame, type LotFrame } from '../src/lot-candidate.ts';
import { fraction, subtractFraction } from '../src/representation-research.ts';
import { MAX_COST_PER_LOT, costPivots, layerCakeWelfare, rawAskEncoding, rawCostEncoding, wadPreservingLots,
  solveCostCandidate, netCostUtility, type CostPivot, type CostOutcome, type SideCostBid } from '../src/cost-grid-research.ts';
import { costBid, sideCostBid, costGridCases, renderCostGridCases, wadPreservingFrame } from '../research/cost-grid-cases.ts';
import { fullPool, pool } from '../research/discrete-cases.ts';
import { scarceLotFrame } from '../research/lot-cases.ts';

let groups = 0;
function test(name: string, body: () => void): void { body(); groups++; console.log(`PASS ${name}`); }
const samePivot = (a: CostPivot, b: CostPivot) => {
  const { quantityEvaluations: _a, ...x } = a, { quantityEvaluations: _b, ...y } = b;
  assert.deepEqual(x, y);
};
const sameOutcome = (a: CostOutcome, b: CostOutcome) => {
  const { quantityEvaluations: _a, ...x } = a, { quantityEvaluations: _b, ...y } = b;
  assert.deepEqual(x, y);
};
const c = costGridCases();
const lot = (f: LotFrame, down: boolean) => down ? f.sell0.lotSize : f.sell1.lotSize;
const spotLot = (f: LotFrame, down: boolean) => lot(f, !down);
const costLevels = (f: LotFrame, down: boolean) => [0n, 1n, spotLot(f, down) / 2n,
  spotLot(f, down), spotLot(f, down) + 1n];
const noGain = (a: { numerator: bigint; denominator: bigint }, b: { numerator: bigint; denominator: bigint }) =>
  assert.ok(a.numerator * b.denominator <= b.numerator * a.denominator, 'profitable declared-grid deviation');

test('integer per-lot pivots are exact and retain actual raw quantities', () => {
  const d = scarceLotFrame().sell0, bids = [costBid(1, 1n, 7n), costBid(2, 2n, 4n)];
  const r = costPivots(d, bids);
  samePivot(r, costPivots(d, bids, 'exhaustive'));
  assert.deepEqual(r.spend, [4n, 0n]); assert.deepEqual(r.unspent, [3n, 4n]);
  assert.deepEqual(r.payment, [2n, 0n]); assert.equal(r.deficit, -6n);
  assert.equal(r.welfare, 7n); assert.equal(layerCakeWelfare(d, bids), 7n);
  assert.deepEqual(r.minimumPayment, [1n, 0n]);
});
test('raw WAD asks cannot encode every exact integer cost per lot', () => {
  assert.deepEqual(rawAskEncoding(1n, 4n), { exact: true, fits: true, ask: WAD / 4n });
  assert.deepEqual(rawAskEncoding(1n, 9n), { exact: false, fits: true, ask: null });
  assert.equal(rawAskEncoding(0n, 9n).ask, 0n);
  assert.throws(() => rawAskEncoding(1n, 0n), RangeError);
  assert.throws(() => rawAskEncoding(MAX_COST_PER_LOT + 1n, 1n), RangeError);
});
test('minimal lots preserving every original WAD ask grow by WAD and fail after the first residual swap', () => {
  const evidence = c.wadPreservingMinimumLots, f = wadPreservingFrame();
  assert.deepEqual(evidence.atNineFourths, { lot0: 4n * WAD, lot1: 9n * WAD, fits: true });
  assert.equal(rawCostEncoding(1n, 4n).exact, false);
  assert.equal(rawCostEncoding(WAD / 4n, 4n).costPerLot, 1n);
  for (const ask of [0n, 1n, WAD / 16n, WAD * 3n / 16n, WAD * 2n / 5n, (1n << 128n) - 1n]) {
    assert.equal(rawCostEncoding(ask, f.sell0.lotSize).exact, true);
    assert.equal(rawCostEncoding(ask, f.sell1.lotSize).exact, true);
  }
  // Every ask can have an exact mathematical cost while some exceed this
  // laboratory's computational representation. Do not silently admit them.
  assert.equal(rawCostEncoding((1n << 128n) - 1n, f.sell0.lotSize).fitsCostDomain, false);
  const scaled = [sideCostBid(1, true, WAD * 3n / 4n, 4n * WAD),
    sideCostBid(2, true, WAD / 2n, 4n * WAD), sideCostBid(3, true, WAD / 2n, 4n * WAD),
    sideCostBid(4, false, WAD * 18n / 5n, 9n * WAD)];
  const truth = solveCostCandidate(f, scaled);
  assert.equal(truth.certified, true); assert.equal(truth.funded, true); assert.equal(truth.spend[0], 0n);
  const fake = scaled.map((b, i) => i === 0 ? { ...b, costPerLot: WAD / 4n } : b);
  const result = solveCostCandidate(f, fake);
  assert.equal(result.payment[0], WAD / 2n); assert.equal(result.spend[0], 4n * WAD);
  assert.deepEqual(netCostUtility(fake, result, [fake[0].id], true, fraction(WAD * 3n / 4n), 4n * WAD), fraction(-WAD / 4n));
  assert.equal(evidence.sixDecimalInputTokenMinimum, 4_000_000_000_000n);
  assert.equal(evidence.eighteenDecimalInputTokenMinimum, 4n);
  assert.equal(evidence.minimumLotsAtNextPrice.fits, false);
  assert.equal(evidence.primitiveLotsAtNextPrice.fits, false);
  assert.ok(evidence.primitiveLotsAtNextPrice.lot0 > MAX_INPUT && evidence.primitiveLotsAtNextPrice.lot1 > MAX_INPUT);
  assert.ok(evidence.minimumLotsAtNextPrice.lot0 > MAX_INPUT && evidence.minimumLotsAtNextPrice.lot1 > MAX_INPUT);
  assert.deepEqual(wadPreservingLots(evidence.quoteAfterFirstResidual.sqrtPriceX96), evidence.minimumLotsAtNextPrice);
  assert.equal(evidence.atTickOne.fits, false);
});
test('both directions have integer payments, exact residuals and whole grid IR', () => {
  const r = c.exactIntegerPivots.result;
  assert.equal(r.certified, true); assert.equal(r.funded, true);
  assert.deepEqual(r.spend, [8n, 9n, 0n]); assert.deepEqual(r.payment, [4n, 4n, 0n]);
  assert.equal(r.swapInput, 4n); assert.equal(r.swapOutput, 8n);
  assert.deepEqual(r.residual, [0n, 13n]);
  r.payment.forEach((p, i) => assert.ok(p >= r.minimumPayment[i]));
  const up = solveCostCandidate(scarceLotFrame(), [sideCostBid(1, false, 1n, 18n), sideCostBid(2, true, 0n, 4n)]);
  assert.equal(up.dominantSellsCurrency0, false); assert.equal(up.swapInput, 9n); assert.equal(up.swapOutput, 3n);
  assert.equal(up.funded, true); assert.deepEqual(up.residual, [0n, 0n]);
});
test('the published grid split has no rounding bonus and all counterfactuals match enumeration', () => {
  const v = c.exactIntegerPivots;
  assert.deepEqual(v.singleUtility, fraction(2n)); assert.deepEqual(v.splitUtility, fraction(2n));
  sameOutcome(v.result, solveCostCandidate(scarceLotFrame(), v.bids, 'exhaustive'));
  sameOutcome(v.splitResult, solveCostCandidate(scarceLotFrame(), v.splitBids, 'exhaustive'));
  assert.equal(v.splitResult.payment[0] + v.splitResult.payment[1], v.result.payment[0]);
});
test('ceiling an original fractional cost into the grid still permits a profitable ask change', () => {
  const r = c.outOfGridCeiling;
  assert.equal(r.trueRawWadAsk * 4n, WAD * 3n / 4n);
  assert.equal(r.truth.spend[0], 0n); assert.equal(r.deviation.spend[0], 4n);
  assert.equal(r.deviation.payment[0], 1n); assert.equal(r.deviation.funded, true);
  assert.deepEqual(subtractFraction(r.deviatingUtility!, r.truthfulRoundedUtility!), fraction(1n, 4n));
});
test('flooring an original fractional cost can violate its signed minimum and underlying IR', () => {
  const r = c.outOfGridFloor;
  assert.equal(r.result.spend[0], 4n); assert.equal(r.result.payment[0], 1n);
  assert.equal((r.trueRawWadAsk * 4n + WAD - 1n) / WAD, r.originalMinimumWholeOutput);
  assert.equal(r.originalMinimumWholeOutput, 2n); assert.deepEqual(r.underlyingUtility, fraction(-1n, 4n));
  assert.equal(r.result.minimumPayment[0], 1n); // Different grid contract, explicitly diagnosed.
});
test('empty/zero-cost/tie cases and unspent remainders have deterministic integer outcomes', () => {
  const f = scarceLotFrame();
  const r = solveCostCandidate(f, [sideCostBid(1, true, 9n, 7n), sideCostBid(2, false, 4n, 10n)]);
  assert.equal(r.dominantSellsCurrency0, true); assert.deepEqual(r.spend, [4n, 9n]);
  assert.deepEqual(r.payment, [9n, 4n]); assert.deepEqual(r.unspent, [3n, 1n]);
  assert.equal(r.swapInput, 0n);
  assert.deepEqual(solveCostCandidate(f, []).payment, []);
  const ineligible = solveCostCandidate(f, [sideCostBid(1, true, 10n, 4n), sideCostBid(2, false, 5n, 9n)]);
  assert.deepEqual(ineligible.spend, [0n, 0n]); assert.deepEqual(ineligible.unspent, [4n, 9n]);
  assert.equal(costPivots({ lotSize: 1n, output: [0n, 0n, 0n] }, [costBid(1, 0n, 2n)]).spend[0], 2n);
});
test('integer reports do not fix uncertified staircase funding deficits', () => {
  const d: Domain = { lotSize: 1n, output: [0n, 0n, 1n] };
  const r = costPivots(d, [costBid(1, 0n, 1n), costBid(2, 0n, 1n)]);
  assert.equal(r.certified, false); assert.deepEqual(r.payment, [1n, 1n]); assert.equal(r.deficit, 1n);
  assert.throws(() => layerCakeWelfare(d, []), RangeError);
  const f = buildLotFrame(fullPool(1000n), [sqrtPriceAtTick(-100), sqrtPriceAtTick(100)], 1n, 2);
  const result = solveCostCandidate(f, [sideCostBid(1, true, 0n, 1n), sideCostBid(2, true, 0n, 1n)]);
  assert.equal(result.certified, false); assert.equal(result.funded, false);
  assert.deepEqual(result.residual, [0n, -1n]);
});
test('large BigInt values and capacities use breakpoint integration without price-unit enumeration', () => {
  const h = 1n << 110n, d = { lotSize: 1n, output: [0n, h, 2n * h, 3n * h] };
  const bids = [costBid(1, MAX_COST_PER_LOT, MAX_INPUT)];
  const r = costPivots(d, bids);
  assert.equal(r.spend[0], 3n); assert.equal(r.welfare, 3n * (h - MAX_COST_PER_LOT));
  assert.equal(layerCakeWelfare(d, bids), r.welfare);
  assert.equal(r.payment[0], 3n * h);
});
test('malformed costs, duplicate IDs, excess work and unsupported price frames reject', () => {
  const f = scarceLotFrame(), d = f.sell0;
  for (const cost of [-1n, MAX_COST_PER_LOT + 1n, 0.5 as never]) {
    assert.throws(() => costPivots(d, [costBid(1, cost, 4n)]), RangeError);
  }
  assert.throws(() => costPivots(d, [costBid(1, 1n, 4n), costBid(1, 2n, 4n)]), RangeError);
  assert.throws(() => costPivots(d, [costBid(1, 1n, MAX_INPUT + 1n)]), RangeError);
  assert.throws(() => costPivots(d, [], 'bad' as never), RangeError);
  assert.throws(() => costPivots({ lotSize: MAX_INPUT, output: [0n, 1n, 2n] }, []), RangeError);
  assert.throws(() => layerCakeWelfare({ lotSize: 1n, output: [0n, null, 2n] }, []), RangeError);
  assert.throws(() => solveCostCandidate(f, [sideCostBid(1, true, 0n, 4n), sideCostBid(1, false, 0n, 9n)]), RangeError);
  assert.throws(() => solveCostCandidate(f, [sideCostBid(1, true, 0n, 4n * 33n)]), RangeError);
  assert.throws(() => buildLotFrame(fullPool(1000n, 60, sqrtPriceAtTick(1)),
    [sqrtPriceAtTick(-100), sqrtPriceAtTick(100)], 1n, 1), RangeError);
});

let seed = 0x4C072026;
function random(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
function concaveDomain(): Domain {
  const margins = Array.from({ length: random() % 9 }, () => BigInt(random() % 26))
    .sort((a, b) => a > b ? -1 : a < b ? 1 : 0);
  const output: (bigint | null)[] = [0n];
  for (const m of margins) output.push(output[output.length - 1]! + m);
  for (let i = 0, n = random() % 3; i < n; i++) output.push(null);
  return { lotSize: BigInt(1 + random() % 10), output };
}

test('1000 seeded one-sided allocations and every pivot match independent enumeration and integration', () => {
  for (let i = 0; i < 1000; i++) {
    const d = concaveDomain(), bids = Array.from({ length: 1 + random() % 4 }, (_, j) =>
      costBid(j + 1, BigInt(random() % 30), BigInt(random() % 4) * d.lotSize + BigInt(random() % Number(d.lotSize))));
    const r = costPivots(d, bids);
    samePivot(r, costPivots(d, bids, 'exhaustive'));
    assert.equal(layerCakeWelfare(d, bids), r.welfare);
    assert.equal(r.certified, true); assert.ok(r.deficit <= 0n);
    bids.forEach((b, j) => {
      assert.equal(r.withoutWelfare[j], layerCakeWelfare(d, bids.filter((_, k) => k !== j)));
      assert.ok(r.payment[j] >= b.costPerLot * r.fillLots[j]);
      assert.equal(r.spend[j] + r.unspent[j], b.budget);
    });
  }
});
test('100 six-report families satisfy 409600 full set-function submodularity comparisons', () => {
  let comparisons = 0;
  for (let i = 0; i < 100; i++) {
    const d = concaveDomain(), bids = Array.from({ length: 6 }, (_, j) =>
      costBid(j + 1, BigInt(random() % 30), BigInt(random() % 5) * d.lotSize));
    const welfare = Array.from({ length: 64 }, (_, mask) => {
      const subset = bids.filter((_, j) => (mask & (1 << j)) !== 0);
      const value = layerCakeWelfare(d, subset);
      assert.equal(value, costPivots(d, subset).welfare);
      return value;
    });
    assert.equal(welfare[0], 0n);
    for (let a = 0; a < 64; a++) for (let b = 0; b < 64; b++) {
      assert.ok(welfare[a] + welfare[b] >= welfare[a | b] + welfare[a & b]);
      comparisons++;
    }
  }
  assert.equal(comparisons, 409600);
});
test('3000 seeded one-sided coalitions check the analytical payment bound and feasible true-budget deviations', () => {
  let feasible = 0, catastrophic = 0, feasibleOverreportedBudget = 0;
  for (let i = 0; i < 3000; i++) {
    const d = concaveDomain(), owned = 1 + random() % 3;
    const bids = Array.from({ length: owned + 2 }, (_, j) =>
      costBid(j + 1, BigInt(random() % 30), BigInt(random() % 5) * d.lotSize));
    const r = costPivots(d, bids), others = bids.slice(owned), without = costPivots(d, others);
    const marginalSum = r.withoutWelfare.slice(0, owned).reduce((n, w) => n + r.welfare - w, 0n);
    assert.ok(marginalSum <= r.welfare - without.welfare);
    const trueCost = BigInt(random() % 30), trueBudget = BigInt(random() % 8) * d.lotSize
      + BigInt(random() % Number(d.lotSize));
    const ownSpend = r.spend.slice(0, owned).reduce((a, b) => a + b, 0n);
    if (ownSpend > trueBudget) { catastrophic++; continue; }
    const truth = costPivots(d, [costBid(99, trueCost, trueBudget), ...others]);
    const truthUtility = truth.payment[0] - trueCost * truth.fillLots[0];
    const fakeUtility = r.payment.slice(0, owned).reduce((a, b) => a + b, 0n)
      - trueCost * (ownSpend / d.lotSize);
    assert.ok(truthUtility >= 0n); assert.ok(fakeUtility <= truthUtility);
    if (bids.slice(0, owned).reduce((n, b) => n + b.budget, 0n) > trueBudget) feasibleOverreportedBudget++;
    feasible++;
  }
  assert.equal(feasible + catastrophic, 3000);
  assert.ok(feasible > 1000); assert.ok(catastrophic > 0); assert.ok(feasibleOverreportedBudget > 0);
  console.log(`  one-sided: ${feasible} feasible, ${catastrophic} catastrophic; ${feasibleOverreportedBudget} feasible inflated capacities`);
});

const symmetric = buildLotFrame(fullPool(1000n, 60), [sqrtPriceAtTick(-20000), sqrtPriceAtTick(20000)], 100n, 6);
const price = Q96 * 3n / 2n;
const varied = buildLotFrame(fullPool(1000n, 60, price), [sqrtPriceAtTick(-12000), sqrtPriceAtTick(28000)], 10n, 6);
const concentrated = buildLotFrame(pool([{ lower: -240, upper: 240, liquidity: 1000n },
  { lower: -960, upper: -480, liquidity: 1000n }, { lower: 480, upper: 960, liquidity: 1000n }]),
  [sqrtPriceAtTick(-20000), sqrtPriceAtTick(20000)], 10n, 6);
test('1000 seeded two-sided integer-cost batches agree with independent allocations and counterfactuals', () => {
  for (let i = 0; i < 1000; i++) {
    const frames = [scarceLotFrame(), symmetric, varied, concentrated], f = frames[random() % 4];
    const bids = Array.from({ length: 1 + random() % 5 }, (_, j) => {
      const down = random() % 2 === 0, size = lot(f, down);
      return sideCostBid(j + 1, down, BigInt(random() % 11) * spotLot(f, down) / 8n,
        BigInt(random() % 4) * size + BigInt(random() % Number(size)));
    });
    const r = solveCostCandidate(f, bids);
    sameOutcome(r, solveCostCandidate(f, bids, 'exhaustive'));
    const byId = (bs: readonly SideCostBid[], v: CostOutcome) => bs.map((b, j) =>
      [b.id, v.spend[j], v.payment[j], v.unspent[j]]).sort();
    assert.deepEqual(byId(bids, r), byId([...bids].reverse(), solveCostCandidate(f, [...bids].reverse())));
    bids.forEach((b, j) => {
      assert.equal(r.spend[j] % lot(f, b.sellingCurrency0), 0n);
      assert.equal(r.spend[j] + r.unspent[j], b.budget);
      assert.ok(r.payment[j] >= r.minimumPayment[j]);
      if (!r.eligible[j]) assert.equal(r.spend[j], 0n);
    });
    if (r.certified) assert.equal(r.funded, true);
    assert.equal(r.residual[r.dominantSellsCurrency0 ? 0 : 1], 0n);
    const d = r.dominantSellsCurrency0 ? f.sell0 : f.sell1;
    assert.equal(r.swapOutput, d.output[Number(r.swapInput / d.lotSize)]);
  }
});
test('net utility retains bought-back input and hypothetical weak two-token gains', () => {
  const f = scarceLotFrame(), bids = [sideCostBid(1, true, 0n, 8n), sideCostBid(2, false, 0n, 9n)];
  const r = solveCostCandidate(f, bids);
  assert.equal(r.spend[0], 8n); assert.equal(r.payment[1], 4n);
  assert.deepEqual(netCostUtility(bids, r, bids.map(b => b.id), true, fraction(0n), 4n), fraction(8n));
  assert.equal(netCostUtility(bids, r, [bids[0].id], true, fraction(0n), 4n), null);
  const matched = [sideCostBid(1, true, 0n, 4n), bids[1]], zero = solveCostCandidate(f, matched);
  assert.deepEqual(netCostUtility(matched, zero, matched.map(b => b.id), true, fraction(0n), 0n), fraction(0n));
  const hypothetical = { ...zero, payment: [...zero.payment] };
  hypothetical.payment[0] += 1n; // Deliberately hypothetical, not a funded candidate.
  assert.deepEqual(netCostUtility(matched, hypothetical, matched.map(b => b.id), true, fraction(0n), 0n), fraction(1n));
  assert.throws(() => netCostUtility(matched, zero, ['missing'], true, fraction(0n), 0n), RangeError);
  assert.throws(() => netCostUtility([...matched].reverse(), zero, [], true, fraction(0n), 0n), RangeError);
  assert.throws(() => netCostUtility(matched, zero, [], true, fraction(-1n), 0n), RangeError);
});
test('72000 declared integer-type two-sided strategies check both-side reports, budgets and false names', () => {
  let feasible = 0, catastrophic = 0, flips = 0, grossOverBudget = 0;
  for (const f of [scarceLotFrame(), symmetric]) for (const side of [true, false]) for (const pattern of [0, 1]) {
    const others = [sideCostBid(10, true, spotLot(f, true) / 2n, lot(f, true) * BigInt(pattern + 1)),
      sideCostBid(11, false, spotLot(f, false) / 2n, lot(f, false) * BigInt(2 - pattern))];
    const reports = [true, false].flatMap(down => costLevels(f, down).slice(0, 4).flatMap(cost =>
      [0n, 1n, 2n].map(cap => ({ down, cost, budget: lot(f, down) * cap }))));
    for (const trueCost of costLevels(f, side)) for (const cap of [0n, 1n, 2n]) {
      const trueBudget = lot(f, side) * cap + (cap === 1n ? lot(f, side) - 1n : 0n);
      const honest = [sideCostBid(1, side, trueCost, trueBudget), ...others], truth = solveCostCandidate(f, honest);
      const truthfulUtility = netCostUtility(honest, truth, [honest[0].id], side, fraction(trueCost), trueBudget);
      assert.notEqual(truthfulUtility, null); assert.ok(truthfulUtility!.numerator >= 0n);
      const check = (fake: SideCostBid[], owned: string[]) => {
        const outcome = solveCostCandidate(f, fake);
        assert.equal(outcome.certified, true); assert.equal(outcome.funded, true);
        const utility = netCostUtility(fake, outcome, owned, side, fraction(trueCost), trueBudget);
        if (utility === null) { catastrophic++; return; }
        noGain(utility, truthfulUtility!);
        if (outcome.dominantSellsCurrency0 !== truth.dominantSellsCurrency0) flips++;
        const gross = fake.reduce((n, b, j) => n + (owned.includes(b.id)
          && b.sellingCurrency0 === side ? outcome.spend[j] : 0n), 0n);
        if (gross > trueBudget) grossOverBudget++;
        feasible++;
      };
      for (const report of reports) check([sideCostBid(1, report.down, report.cost, report.budget), ...others], [honest[0].id]);
      for (const a of reports) for (const b of reports) {
        const fake = [sideCostBid(1, a.down, a.cost, a.budget), sideCostBid(2, b.down, b.cost, b.budget), ...others];
        check(fake, [fake[0].id, fake[1].id]);
      }
    }
  }
  assert.equal(feasible + catastrophic, 72000); assert.ok(feasible > 10000); assert.ok(catastrophic > 0);
  assert.ok(flips > 0); assert.ok(grossOverBudget > 0);
  console.log(`  two-sided: ${feasible} feasible, ${catastrophic} catastrophic; ${flips} side flips; ${grossOverBudget} feasible gross-over-budget strategies`);
});
test('cost-grid evidence reproduces byte-for-byte', () => {
  assert.equal(readFileSync(new URL('../../fixtures/research/cost-grid-research.json', import.meta.url), 'utf8'), renderCostGridCases());
});
console.log(`${groups} cost-grid groups passed; original valuation domain and full two-sided guarantees remain unresolved.`);
