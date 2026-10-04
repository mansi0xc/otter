/** Reproducible offline candidate evidence; supplied IDs and maps are synthetic. */
import { Q96, Status, sqrtPriceAtTick, tickAtSqrtPrice, quoteExactInput } from '../src/execution.ts';
import { WAD } from '../src/discrete-research.ts';
import { buildLotFrame, solveLotCandidate, spotLots, netUtility, type LotBid } from '../src/lot-candidate.ts';
import { bid, fullPool } from './discrete-cases.ts';

export const lotBid = (n: number, sellingCurrency0: boolean, ask: bigint, budget: bigint): LotBid =>
  ({ ...bid(n, ask, budget), sellingCurrency0 });

export function scarceLotFrame() {
  const s = fullPool(1000n, 60, Q96 * 3n / 2n);
  const tick = tickAtSqrtPrice(s.sqrtPriceX96);
  const down = quoteExactInput(s, true, 4n, sqrtPriceAtTick(tick - 1000));
  const up = quoteExactInput(s, false, 9n, sqrtPriceAtTick(tick + 1000));
  if (down.status !== Status.Complete || up.status !== Status.Complete) throw new Error('scarce fixture quote incomplete');
  return buildLotFrame(s, [down.sqrtPriceX96, up.sqrtPriceX96], 1n, 3);
}

export function lotCases() {
  const frame = scarceLotFrame();
  // Total currency0 supply 3 lots, minority supply 1 lot, residual capacity 1.
  // Three sellers compete for two fills; A's true per-lot cost is 0.75.
  const honest = [lotBid(1, true, WAD * 3n / 16n, 4n),
    lotBid(2, true, WAD / 8n, 4n), lotBid(3, true, WAD / 8n, 4n),
    lotBid(4, false, WAD * 2n / 5n, 9n)];
  const fake = honest.map((b, i) => i === 0 ? { ...b, ask: WAD / 16n } : { ...b });
  const truth = solveLotCandidate(frame, honest);
  const deviation = solveLotCandidate(frame, fake);
  const claimsTruth = netUtility(honest, truth, [honest[0].id], true, honest[0].ask, 4n, 'claims')!;
  const claimsFake = netUtility(fake, deviation, [fake[0].id], true, honest[0].ask, 4n, 'claims')!;
  const ceilTruth = netUtility(honest, truth, [honest[0].id], true, honest[0].ask, 4n, 'ceil')!;
  const ceilFake = netUtility(fake, deviation, [fake[0].id], true, honest[0].ask, 4n, 'ceil')!;

  const roundTripBids = [lotBid(1, true, 0n, 8n), lotBid(2, false, 0n, 9n)];
  const roundTrip = solveLotCandidate(frame, roundTripBids);
  const split = [lotBid(1, true, WAD / 16n, 8n), lotBid(4, false, 0n, 9n),
    lotBid(5, true, WAD / 8n, 8n)];
  const splitFake = [lotBid(1, true, WAD / 16n, 4n), lotBid(2, true, WAD / 16n, 4n), split[1], split[2]];
  const single = solveLotCandidate(frame, split), sybils = solveLotCandidate(frame, splitFake);
  const rawSplitGain = netUtility(splitFake, sybils, [splitFake[0].id, splitFake[1].id], true, WAD / 16n, 8n, 'claims')!
    - netUtility(split, single, [split[0].id], true, WAD / 16n, 8n, 'claims')!;
  const ceilSplitGain = netUtility(splitFake, sybils, [splitFake[0].id, splitFake[1].id], true, WAD / 16n, 8n, 'ceil')!
    - netUtility(split, single, [split[0].id], true, WAD / 16n, 8n, 'ceil')!;

  let fits = 0;
  for (let tick = -400_000; tick <= 400_000; tick += 400) if (spotLots(sqrtPriceAtTick(tick)).fits) fits++;
  return {
    schema: 'otter/lot-candidate/v1',
    qualification: 'Offline two-sided candidate; no production mechanism, authenticated data, tokenized claims, or full incentive proof.',
    exactLots: { atNineFourths: spotLots(frame.price), atTickOne: spotLots(sqrtPriceAtTick(1)),
      sampledTicks: 2001, fittingSamples: fits },
    twoSidedRounding: { frame, honest, fake, truth, deviation,
      utilityScale: (WAD * WAD).toString(), claimsGainNumerator: claimsFake - claimsTruth,
      ceilGainNumerator: ceilFake - ceilTruth },
    fractionalIR: { payments: truth.paymentNumerator, minimumInteger: truth.minimumPayment,
      floorRedemption: truth.floorPayment, failures: truth.floorIRFailures },
    falseNames: { singleBids: split, splitBids: splitFake, single, sybils,
      claimsGainNumerator: rawSplitGain, ceilGainNumerator: ceilSplitGain },
    netBudget: { bids: roundTripBids, result: roundTrip,
      grossInput: roundTrip.spend[0], oppositeInputReturned: roundTrip.paymentNumerator[1] / WAD,
      trueBudget: 4n, netUtilityNumerator: netUtility(roundTripBids, roundTrip,
        roundTripBids.map(b => b.id), true, 0n, 4n, 'claims') },
  };
}

export const renderLotCases = (): string => JSON.stringify(lotCases(), (_k, value) =>
  typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
