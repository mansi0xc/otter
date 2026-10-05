/** Reproducible offline evidence. The pool maps, bid IDs and ownership are
 * synthetic; the matching core swap/cash-ledger test is separately on-chain. */
import { Q96, Status, sqrtPriceAtTick, tickAtSqrtPrice, quoteExactInput } from '../src/execution.ts';
import { WAD } from '../src/discrete-research.ts';
import { buildLotFrame, solveLotCandidate } from '../src/lot-candidate.ts';
import { solveCostCandidate, rawAskEncoding, netCostUtility, type SideCostBid } from '../src/cost-grid-research.ts';
import { fraction } from '../src/representation-research.ts';
import { capitalWeight } from '../src/rewards.ts';
import { rewardUtility, sameRangeSplit } from '../src/reward-composition-research.ts';
import { fullPool, id } from './discrete-cases.ts';

export function rewardCompositionCase() {
  const price = Q96 * 3n / 2n, snapshot = fullPool(40n, 60, price);
  const tick = tickAtSqrtPrice(price);
  // Limits/capacity are fixed from pool state before considering any report.
  const down = quoteExactInput(snapshot, true, 8n, sqrtPriceAtTick(tick - 20000));
  const up = quoteExactInput(snapshot, false, 18n, sqrtPriceAtTick(tick + 20000));
  if (down.status !== Status.Complete || up.status !== Status.Complete) throw new Error('incomplete role fixture');
  const frame = buildLotFrame(snapshot, [down.sqrtPriceX96, up.sqrtPriceX96], 1n, 3);
  const honest: SideCostBid[] = [{ id: id(1), sellingCurrency0: true, costPerLot: 4n, budget: 8n },
    { id: id(2), sellingCurrency0: true, costPerLot: 1n, budget: 4n }];
  const fake = honest.map((b, i) => i === 0 ? { ...b, costPerLot: 2n } : b);
  const raw = (bids: readonly SideCostBid[]) => bids.map(b => {
    const encoded = rawAskEncoding(b.costPerLot, frame.sell0.lotSize);
    if (encoded.ask === null) throw new Error('fixture ask has no exact original WAD representation');
    return { id: b.id, sellingCurrency0: b.sellingCurrency0, ask: encoded.ask, budget: b.budget };
  });
  const truth = solveCostCandidate(frame, honest), deviation = solveCostCandidate(frame, fake);
  const rawTruth = solveLotCandidate(frame, raw(honest)), rawDeviation = solveLotCandidate(frame, raw(fake));
  const capital = capitalWeight(price, -887220, 887220, 20n), weights = [capital.weight, capital.weight];
  const tradingTruth = netCostUtility(honest, truth, [honest[0].id], true, fraction(4n), 8n)!;
  // Evaluate the false report at A's TRUE cost, not at its reported cost 2.
  const tradingDeviation = netCostUtility(fake, deviation, [fake[0].id], true, fraction(4n), 8n)!;
  return { schema: 'otter/reward-composition/v1',
    qualification: 'Local bounded candidate plus current reward policy; no canonical production settlement or full incentive proof.',
    snapshot: { price, tick, liquidity: 40n, spacing: 60, lower: -887220, upper: 887220 },
    frame, down, up, honest, fake, rawHonest: raw(honest), rawFake: raw(fake),
    truth, deviation, rawTruth, rawDeviation, capital, weights, tradingTruth, tradingDeviation,
    composedTruth: rewardUtility(tradingTruth, truth.residual[1], weights, [0]),
    composedDeviation: rewardUtility(tradingDeviation, deviation.residual[1], weights, [0]),
    noStakeTruth: rewardUtility(tradingTruth, truth.residual[1], weights, []),
    noStakeDeviation: rewardUtility(tradingDeviation, deviation.residual[1], weights, []),
    // Negative control only: a report-independent exogenous amount adds the
    // same utility to both reports. It is not funded/implemented as a policy.
    fixedSubsidyTruth: rewardUtility(tradingTruth, truth.residual[1], weights, [], false, 7n),
    fixedSubsidyDeviation: rewardUtility(tradingDeviation, deviation.residual[1], weights, [], false, 7n),
    splitting: sameRangeSplit(price, -887220, 887220, [10n, 10n], [capital.weight], 100n),
    utilityUnit: 'currency1 raw units; same input spend, swap, LP principal and ownership between reports; before transaction gas',
    wad: WAD };
}

export const renderRewardCompositionCase = (): string => JSON.stringify(rewardCompositionCase(),
  (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
