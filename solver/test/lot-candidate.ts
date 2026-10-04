import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAD, type Domain } from '../src/discrete-research.ts';
import { Q96, MAX_INPUT, MAX_OUTPUT, MIN_PRICE, MAX_PRICE_EXCLUSIVE, IncompleteSnapshot,
  Status, sqrtPriceAtTick, tickAtSqrtPrice } from '../src/execution.ts';
import { MAX_SIDE_LOTS, buildLotFrame, certifiedLotFrame, spotLots, solveLotCandidate,
  candidatePayments, netUtility, type LotFrame, type LotBid, type LotOutcome } from '../src/lot-candidate.ts';
import { fullPool, pool } from '../research/discrete-cases.ts';
import { lotBid, scarceLotFrame, lotCases, renderLotCases } from '../research/lot-cases.ts';

let groups = 0;
function test(name: string, body: () => void): void { body(); groups++; console.log(`PASS ${name}`); }
const SCALE = WAD * WAD;
const c = lotCases();
const rate = (f: LotFrame, down: boolean) => WAD * (down ? f.sell1.lotSize : f.sell0.lotSize)
  / (down ? f.sell0.lotSize : f.sell1.lotSize);
const lot = (f: LotFrame, down: boolean) => down ? f.sell0.lotSize : f.sell1.lotSize;
const grid = (f: LotFrame, down: boolean) => [0n, rate(f, down) / 4n, rate(f, down) / 2n,
  rate(f, down), rate(f, down) + WAD];
function same(a: LotOutcome, b: LotOutcome): void {
  const { quantityEvaluations: _a, ...x } = a, { quantityEvaluations: _b, ...y } = b;
  assert.deepEqual(x, y);
}
const byId = (bids: readonly LotBid[], r: LotOutcome) => bids.map((b, i) =>
  [b.id, r.spend[i], r.paymentNumerator[i], r.unspent[i]]).sort();

test('minimum exact spot lots often exceed the entire accepted input domain', () => {
  assert.deepEqual(spotLots(Q96), { lot0: 1n, lot1: 1n, fits: true });
  assert.deepEqual(spotLots(Q96 * 3n / 2n), { lot0: 4n, lot1: 9n, fits: true });
  assert.deepEqual(spotLots(Q96 * 3n / 2n, 10n), { lot0: 40n, lot1: 90n, fits: true });
  assert.equal(c.exactLots.atTickOne.fits, false);
  assert.ok(c.exactLots.atTickOne.lot0 > MAX_INPUT);
  assert.ok(c.exactLots.atTickOne.lot1 > MAX_INPUT);
  assert.equal(c.exactLots.sampledTicks, 2001);
  assert.equal(c.exactLots.fittingSamples, 1);
  assert.throws(() => buildLotFrame(fullPool(1000n, 60, sqrtPriceAtTick(1)),
    [sqrtPriceAtTick(-100), sqrtPriceAtTick(100)], 1n, 1), RangeError);
});
test('real fixed price limits bound residuals in both directions', () => {
  const f = c.twoSidedRounding.frame;
  assert.deepEqual(f.sell0.output, [0n, 8n, null, null]);
  assert.deepEqual(f.sell1.output, [0n, 3n, null, null]);
  assert.equal(certifiedLotFrame(f), true);
  for (const d of [f.sell0, f.sell1]) {
    assert.equal(d.quotes[1].status, Status.Complete);
    assert.equal(d.quotes[2].status, Status.PriceLimit);
    assert.equal(d.quotes[2].consumedInput, d.lotSize);
  }
});
test('two-sided exact lots preserve whole minority IR and funded asset balances', () => {
  const r = c.twoSidedRounding.truth;
  assert.deepEqual(r.spend, [0n, 4n, 4n, 9n]);
  assert.deepEqual(r.unspent, [4n, 0n, 0n, 0n]);
  assert.equal(r.dominantSellsCurrency0, true);
  assert.deepEqual(r.eligibleLots, [3, 1]);
  assert.equal(r.minorityInput, 9n);
  assert.equal(r.minorityPayment, 4n);
  assert.equal(r.paymentNumerator[3], 4n * WAD);
  assert.equal(r.swapInput, 4n);
  assert.equal(r.swapOutput, 8n);
  assert.deepEqual(r.augmented.output, [0n, 9n, 17n, null, null]);
  assert.equal(r.claimsFunded, true);
  assert.equal(r.ceilFunded, true);
  assert.deepEqual(r.claimResidualNumerator, [0n, 15n * WAD + WAD / 2n]);
  assert.deepEqual(r.ceilResidual, [0n, 15n]);
  assert.ok(r.ceilPayment[3] >= r.minimumPayment[3]);
});
test('fractional compensation and immediate underlying redemption are different IR contracts', () => {
  const r = c.twoSidedRounding.truth;
  assert.deepEqual(r.paymentNumerator, [0n, WAD * 3n / 4n, WAD * 3n / 4n, 4n * WAD]);
  assert.deepEqual(r.minimumPayment, [0n, 1n, 1n, 4n]);
  assert.deepEqual(r.floorIRFailures, [1, 2]);
  const b = c.twoSidedRounding.honest;
  assert.equal(netUtility(b, r, [b[1].id], true, b[1].ask, b[1].budget, 'claims'), SCALE / 4n);
  assert.equal(netUtility(b, r, [b[1].id], true, b[1].ask, b[1].budget, 'floor-redemption'), -SCALE / 2n);
});
test('ceil rounding still permits ask manipulation in a certified two-sided candidate', () => {
  assert.equal(c.twoSidedRounding.truth.certified, true);
  assert.equal(c.twoSidedRounding.deviation.certified, true);
  assert.equal(c.twoSidedRounding.deviation.ceilFunded, true);
  assert.equal(c.twoSidedRounding.claimsGainNumerator, -SCALE / 4n);
  assert.equal(c.twoSidedRounding.ceilGainNumerator, SCALE / 4n);
});
test('ceil rounding still rewards two identities; unrounded gain in this case is zero', () => {
  const r = c.falseNames;
  assert.equal(r.single.certified, true);
  assert.equal(r.sybils.certified, true);
  assert.equal(r.single.claimsFunded, true);
  assert.equal(r.sybils.ceilFunded, true);
  assert.equal(r.claimsGainNumerator, 0n);
  assert.equal(r.ceilGainNumerator, SCALE);
  assert.equal(r.single.spend[0], r.sybils.spend[0] + r.sybils.spend[1]);
});
test('net true-budget and opposite-direction conditions retain feasible gross-over-budget strategies', () => {
  const { bids, result, trueBudget } = c.netBudget;
  assert.equal(result.spend[0], 8n);
  assert.equal(result.paymentNumerator[1], 4n * WAD);
  assert.ok(result.spend[0] > trueBudget);
  assert.equal(netUtility(bids, result, bids.map(b => b.id), true, 0n, trueBudget, 'claims'), 8n * SCALE);
  assert.equal(netUtility(bids, result, [bids[0].id], true, 0n, trueBudget, 'claims'), null);
  assert.equal(netUtility(bids, result, [bids[1].id], true, 0n, 0n, 'claims'), null);
  const matched = [lotBid(1, true, 0n, 4n), lotBid(2, false, 0n, 9n)];
  const zero = solveLotCandidate(scarceLotFrame(), matched);
  assert.equal(zero.swapInput, 0n);
  assert.equal(netUtility(matched, zero, matched.map(b => b.id), true, 0n, 0n, 'claims'), 0n);
  // A hypothetical free lunch remains admissible to the utility checker;
  // rejecting it merely for gross sales would conceal an arbitrage failure.
  const free = { ...zero, paymentNumerator: [...zero.paymentNumerator] };
  free.paymentNumerator[0] += WAD;
  assert.equal(netUtility(matched, free, matched.map(b => b.id), true, 0n, 0n, 'claims'), SCALE);
});
test('remainders, ineligible reports, zero input and direction ties are explicit', () => {
  const f = scarceLotFrame();
  const bids = [lotBid(1, true, 0n, 7n), lotBid(2, false, 0n, 10n), lotBid(3, true, 3n * WAD, 8n)];
  const r = solveLotCandidate(f, bids);
  assert.equal(r.dominantSellsCurrency0, true);
  assert.deepEqual(r.eligibleLots, [1, 1]);
  assert.deepEqual(r.spend, [4n, 9n, 0n]);
  assert.deepEqual(r.unspent, [3n, 1n, 8n]);
  assert.equal(r.swapInput, 0n);
  assert.equal(r.swapOutput, 0n);
  const up = solveLotCandidate(f, [lotBid(1, true, 0n, 3n), lotBid(2, false, 0n, 10n)]);
  assert.equal(up.dominantSellsCurrency0, false);
  assert.deepEqual(up.spend, [0n, 9n]);
  assert.deepEqual(up.unspent, [3n, 1n]);
  const empty = solveLotCandidate(f, []);
  assert.deepEqual(empty.spend, []);
  assert.equal(empty.swapInput, 0n);
});
test('every published allocation and counterfactual agrees with independent enumeration', () => {
  const f = scarceLotFrame();
  for (const bids of [c.twoSidedRounding.honest, c.twoSidedRounding.fake,
    c.falseNames.singleBids, c.falseNames.splitBids, c.netBudget.bids]) {
    same(solveLotCandidate(f, bids), solveLotCandidate(f, bids, 'exhaustive'));
  }
});
test('malformed frames, lots, identities and excessive research work reject explicitly', () => {
  const f = scarceLotFrame();
  for (const price of [0n, MIN_PRICE - 1n, MAX_PRICE_EXCLUSIVE]) assert.throws(() => spotLots(price), RangeError);
  for (const m of [0n, -1n, MAX_INPUT + 1n]) assert.throws(() => spotLots(Q96, m), RangeError);
  const badRatio = { ...f, sell0: { ...f.sell0, lotSize: 5n } };
  assert.throws(() => solveLotCandidate(badRatio, []), RangeError);
  assert.throws(() => buildLotFrame(fullPool(1000n), [Q96, Q96], 1n, 0), RangeError);
  assert.throws(() => buildLotFrame(fullPool(1000n), [sqrtPriceAtTick(-100), sqrtPriceAtTick(100)], 1n, 33), RangeError);
  assert.throws(() => buildLotFrame({ ...fullPool(1000n), bitmap: new Map() },
    [sqrtPriceAtTick(-100), sqrtPriceAtTick(100)], 1n, 1), IncompleteSnapshot);
  assert.throws(() => solveLotCandidate(f, [lotBid(1, true, 0n, 4n), lotBid(1, false, 0n, 9n)]), RangeError);
  assert.throws(() => solveLotCandidate(f, [lotBid(1, true, -1n, 4n)]), RangeError);
  assert.throws(() => solveLotCandidate(f, [lotBid(1, true, 0n, BigInt(MAX_SIDE_LOTS + 1) * 4n)]), RangeError);
  const huge: Domain = { lotSize: MAX_INPUT, output: [0n] };
  assert.throws(() => solveLotCandidate({ price: Q96, sell0: huge, sell1: huge },
    [lotBid(1, true, 0n, MAX_INPUT), lotBid(2, true, 0n, 1n)]), RangeError);
  assert.throws(() => solveLotCandidate(f, Array.from({ length: 9 }, (_, i) => lotBid(i, true, 0n, 0n))), RangeError);
  assert.throws(() => solveLotCandidate({ ...f, sell0: { lotSize: 4n, output: [0n, MAX_OUTPUT + 1n] } }, []), RangeError);
  assert.throws(() => candidatePayments(c.netBudget.result, 'invalid' as never), RangeError);
  assert.throws(() => netUtility(c.netBudget.bids, c.netBudget.result, ['missing'], true, 0n, 4n, 'claims'), RangeError);
  assert.throws(() => netUtility([...c.netBudget.bids].reverse(), c.netBudget.result,
    c.netBudget.bids.map(b => b.id), true, 0n, 4n, 'claims'), RangeError);
});

let seed = 0x4E2026;
function random(): number { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; }
const symmetric = buildLotFrame(fullPool(1000n, 60), [sqrtPriceAtTick(-20000), sqrtPriceAtTick(20000)], 100n, 6);
const price = Q96 * 3n / 2n, tick = tickAtSqrtPrice(price);
const varied = buildLotFrame(fullPool(1000n, 60, price), [sqrtPriceAtTick(tick - 20000), sqrtPriceAtTick(tick + 20000)], 10n, 6);
const concentrated = buildLotFrame(pool([{ lower: -240, upper: 240, liquidity: 1000n },
  { lower: -960, upper: -480, liquidity: 1000n }, { lower: 480, upper: 960, liquidity: 1000n }]),
  [sqrtPriceAtTick(-20000), sqrtPriceAtTick(20000)], 10n, 6);

test('1000 seeded two-sided batches match independent allocation and counterfactuals', () => {
  const frames = [scarceLotFrame(), symmetric, varied, concentrated];
  for (let i = 0; i < 1000; i++) {
    const f = frames[random() % frames.length];
    const bids = Array.from({ length: 1 + random() % 5 }, (_, j) => {
      const side = random() % 2 === 0, size = lot(f, side);
      return lotBid(j + 1, side, BigInt(random() % 11) * rate(f, side) / 8n,
        BigInt(random() % 4) * size + BigInt(random() % Number(size)));
    });
    const r = solveLotCandidate(f, bids);
    same(r, solveLotCandidate(f, bids, 'exhaustive'));
    assert.deepEqual(byId(bids, r), byId([...bids].reverse(), solveLotCandidate(f, [...bids].reverse())));
    for (let j = 0; j < bids.length; j++) {
      assert.ok(r.spend[j] >= 0n && r.spend[j] <= bids[j].budget);
      assert.equal(r.spend[j] % lot(f, bids[j].sellingCurrency0), 0n);
      assert.equal(r.spend[j] + r.unspent[j], bids[j].budget);
      assert.ok(r.paymentNumerator[j] >= bids[j].ask * r.spend[j]);
      assert.ok(r.ceilPayment[j] >= r.minimumPayment[j]);
      if (!r.eligible[j]) assert.equal(r.spend[j], 0n);
    }
    if (r.certified) {
      assert.equal(r.claimsFunded, true);
      assert.equal(r.ceilFunded, true);
    }
    const pool = r.dominantSellsCurrency0 ? f.sell0 : f.sell1;
    assert.equal(r.swapOutput, pool.output[Number(r.swapInput / pool.lotSize)]);
    assert.equal(r.claimResidualNumerator[r.dominantSellsCurrency0 ? 0 : 1], 0n);
  }
});
test('uncertified curves retain diagnostic failures instead of inheriting a proof', () => {
  const f = buildLotFrame(fullPool(1000n, 60), [sqrtPriceAtTick(-100), sqrtPriceAtTick(100)], 1n, 3);
  const r = solveLotCandidate(f, [lotBid(1, true, 0n, 1n), lotBid(2, true, 0n, 1n)]);
  assert.equal(r.certified, false);
  assert.equal(r.claimsFunded, false);
  assert.deepEqual(r.claimResidualNumerator, [0n, -WAD]);
  assert.deepEqual(r.ceilResidual, [0n, -1n]);
});
test('bounded single-identity direction/ask/budget and two-identity deviations under exact nominal claims', () => {
  // Evidence for these grids only; not a complete UIC or builder/LP proof.
  let feasible = 0, catastrophic = 0, directionFlips = 0, grossOverBudget = 0;
  for (const f of [scarceLotFrame(), symmetric]) for (const side of [true, false]) {
    const inputLot = lot(f, side);
    for (const otherShape of [0, 1]) {
      const others = [lotBid(10, true, rate(f, true) / 2n, f.sell0.lotSize * BigInt(otherShape + 1)),
        lotBid(11, false, rate(f, false) / 2n, f.sell1.lotSize * BigInt(2 - otherShape))];
      const reports = [true, false].flatMap(down => grid(f, down).slice(0, 4).flatMap(ask =>
        [0n, 1n, 2n].map(cap => ({ down, ask, budget: lot(f, down) * cap }))));
      for (const trueAsk of grid(f, side)) for (const cap of [0n, 1n, 2n]) {
        const trueBudget = inputLot * cap + (cap === 1n ? inputLot - 1n : 0n);
        const honest = [lotBid(1, side, trueAsk, trueBudget), ...others];
        const truth = solveLotCandidate(f, honest);
        const uTruth = netUtility(honest, truth, [honest[0].id], side, trueAsk, trueBudget, 'claims');
        assert.notEqual(uTruth, null);
        assert.ok(uTruth! >= 0n);
        const check = (fake: LotBid[], controlled: string[]) => {
          const r = solveLotCandidate(f, fake);
          assert.equal(r.certified, true); assert.equal(r.claimsFunded, true);
          const utility = netUtility(fake, r, controlled, side, trueAsk, trueBudget, 'claims');
          if (utility === null) { catastrophic++; return; }
          assert.ok(utility <= uTruth!, 'profitable nominal-claim deviation in declared grid');
          if (r.dominantSellsCurrency0 !== truth.dominantSellsCurrency0) directionFlips++;
          const gross = fake.reduce((total, b, i) => total + (controlled.includes(b.id)
            && b.sellingCurrency0 === side ? r.spend[i] : 0n), 0n);
          if (gross > trueBudget) grossOverBudget++;
          feasible++;
        };
        for (const report of reports) {
          check([lotBid(1, report.down, report.ask, report.budget), ...others], [honest[0].id]);
        }
        for (const a of reports) for (const b of reports) {
          const fake = [lotBid(1, a.down, a.ask, a.budget), lotBid(2, b.down, b.ask, b.budget), ...others];
          check(fake, [fake[0].id, fake[1].id]);
        }
      }
    }
  }
  assert.equal(feasible + catastrophic, 72_000);
  assert.ok(feasible > 10_000); assert.ok(catastrophic > 0);
  assert.ok(directionFlips > 0); assert.ok(grossOverBudget > 0);
  console.log(`  ${feasible} feasible, ${catastrophic} catastrophic; ${directionFlips} side flips; ${grossOverBudget} feasible gross-over-budget cases`);
});
test('checked-in two-sided candidate evidence reproduces byte-for-byte', () => {
  assert.equal(readFileSync(new URL('../../fixtures/research/lot-candidate.json', import.meta.url), 'utf8'), renderLotCases());
});
console.log(`${groups} lot candidate groups passed; representation and domain gates remain open.`);
