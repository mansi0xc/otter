/** Deterministic offline evidence. Integer cost reports change the type domain. */
import { WAD } from '../src/discrete-research.ts';
import { costPivots, layerCakeWelfare, rawAskEncoding, rawCostEncoding, wadPreservingLots, solveCostCandidate, netCostUtility,
  type CostBid, type SideCostBid } from '../src/cost-grid-research.ts';
import { fraction } from '../src/representation-research.ts';
import { id } from './discrete-cases.ts';
import { scarceLotFrame } from './lot-cases.ts';
import { fullPool } from './discrete-cases.ts';
import { Q96, Status, sqrtPriceAtTick, tickAtSqrtPrice, quoteExactInput } from '../src/execution.ts';
import { buildLotFrame, spotLots } from '../src/lot-candidate.ts';

export function wadPreservingFrame() {
  const price = Q96 * 3n / 2n, s = fullPool(1000n * WAD, 60, price), tick = tickAtSqrtPrice(price);
  const down = quoteExactInput(s, true, 4n * WAD, sqrtPriceAtTick(tick - 1000));
  const up = quoteExactInput(s, false, 9n * WAD, sqrtPriceAtTick(tick + 1000));
  if (down.status !== Status.Complete || up.status !== Status.Complete) throw new Error('scaled fixture incomplete');
  return buildLotFrame(s, [down.sqrtPriceX96, up.sqrtPriceX96], WAD, 3);
}

export const costBid = (n: number, costPerLot: bigint, budget: bigint): CostBid => ({ id: id(n), costPerLot, budget });
export const sideCostBid = (n: number, down: boolean, cost: bigint, budget: bigint): SideCostBid =>
  ({ ...costBid(n, cost, budget), sellingCurrency0: down });

export function costGridCases() {
  const frame = scarceLotFrame();
  const whole = [sideCostBid(1, true, 1n, 8n), sideCostBid(4, false, 0n, 9n), sideCostBid(5, true, 2n, 8n)];
  const split = [sideCostBid(1, true, 1n, 4n), sideCostBid(2, true, 1n, 4n), whole[1], whole[2]];
  const single = solveCostCandidate(frame, whole), sybils = solveCostCandidate(frame, split);
  const ceilingReports = [sideCostBid(2, true, 1n, 4n), sideCostBid(1, true, 1n, 4n)];
  const ceilingFake = ceilingReports.map((b, i) => i === 0 ? { ...b, costPerLot: 0n } : { ...b });
  const ceilingTruth = solveCostCandidate(frame, ceilingReports), ceilingDeviation = solveCostCandidate(frame, ceilingFake);
  const floorReports = [sideCostBid(1, true, 1n, 4n), sideCostBid(2, true, 1n, 4n)];
  const floorResult = solveCostCandidate(frame, floorReports);
  const example = [costBid(1, 1n, 4n), costBid(2, 2n, 4n)];
  const scaled = wadPreservingFrame();
  return {
    schema: 'otter/cost-grid-research/v1',
    qualification: 'Offline restricted type-domain research; not a selected mechanism or full two-sided UIC proof. No original ask is automatically rounded.',
    frame: { price: frame.price, lot0: frame.sell0.lotSize, lot1: frame.sell1.lotSize,
      downOutput: frame.sell0.output, upOutput: frame.sell1.output },
    exactIntegerPivots: { bids: whole, result: single, splitBids: split, splitResult: sybils,
      singleUtility: netCostUtility(whole, single, [whole[0].id], true, fraction(1n), 8n),
      splitUtility: netCostUtility(split, sybils, [split[0].id, split[1].id], true, fraction(1n), 8n) },
    oneSidedLayerCake: { domain: { lotSize: frame.sell0.lotSize, output: frame.sell0.output },
      bids: example, result: costPivots(frame.sell0, example), independentWelfare: layerCakeWelfare(frame.sell0, example) },
    originalEncoding: { costOnePerFourInput: rawAskEncoding(1n, 4n),
      costOnePerNineInput: rawAskEncoding(1n, 9n) },
    wadPreservingMinimumLots: { atNineFourths: wadPreservingLots(frame.price),
      atTickOne: wadPreservingLots(sqrtPriceAtTick(1)),
      examples: [1n, WAD * 3n / 16n, WAD * 2n / 5n].map(ask => ({ rawWadAsk: ask,
        sell0: rawCostEncoding(ask, scaled.sell0.lotSize), sell1: rawCostEncoding(ask, scaled.sell1.lotSize) })),
      quoteAfterFirstResidual: scaled.sell0.quotes[1],
      primitiveLotsAtNextPrice: spotLots(scaled.sell0.quotes[1].sqrtPriceX96),
      minimumLotsAtNextPrice: wadPreservingLots(scaled.sell0.quotes[1].sqrtPriceX96),
      sixDecimalInputTokenMinimum: scaled.sell0.lotSize / 10n ** 6n,
      eighteenDecimalInputTokenMinimum: scaled.sell0.lotSize / WAD },
    outOfGridCeiling: { trueRawWadAsk: WAD * 3n / 16n, trueCostPerLot: fraction(3n, 4n),
      roundedReports: ceilingReports, lowerReport: ceilingFake, truth: ceilingTruth, deviation: ceilingDeviation,
      truthfulRoundedUtility: netCostUtility(ceilingReports, ceilingTruth, [ceilingReports[0].id], true, fraction(3n, 4n), 4n),
      deviatingUtility: netCostUtility(ceilingFake, ceilingDeviation, [ceilingFake[0].id], true, fraction(3n, 4n), 4n) },
    outOfGridFloor: { trueRawWadAsk: WAD * 5n / 16n, trueCostPerLot: fraction(5n, 4n),
      roundedReports: floorReports, result: floorResult, originalMinimumWholeOutput: 2n,
      underlyingUtility: netCostUtility(floorReports, floorResult, [floorReports[0].id], true, fraction(5n, 4n), 4n) },
  };
}

export const renderCostGridCases = (): string => JSON.stringify(costGridCases(), (_k, value) =>
  typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
