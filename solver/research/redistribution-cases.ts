/** Fixed-history cash noninterference and intertemporal negative controls.
 * Calendar ownership/funding/clock are synthetic; no contract implements it. */
import { costPivots, netCostUtility } from '../src/cost-grid-research.ts';
import { fraction, subtractFraction } from '../src/representation-research.ts';
import { solveCostCandidate } from '../src/cost-grid-research.ts';
import { createFixedCalendar, commitFixedGrant, releaseFixedGrant, claimFixedGrant,
  fixedCalendarAccounting, discountedUtility, walletUtility } from '../src/redistribution-research.ts';
import { rewardCompositionCase } from './reward-composition-cases.ts';
import { id } from './discrete-cases.ts';

export const beneficiaryAddress = (n: number) => `0x${BigInt(n).toString(16).padStart(40, '0')}`;
export const OWNER_A = beneficiaryAddress(0xA1), OWNER_B = beneficiaryAddress(0xB1);
export const COMMUNITY = beneficiaryAddress(0xD057), TOKEN = beneficiaryAddress(0xC0FFEE);
export const NATIVE = beneficiaryAddress(0);
export const beneficiaries = [{ owner: OWNER_A, weight: 58n }, { owner: OWNER_B, weight: 58n }];
export const renderResearch = (value: unknown): string => JSON.stringify(value, (_key, value) =>
  typeof value === 'bigint' ? value.toString() : value instanceof Map ? [...value] : value, 2) + '\n';

export function redistributionCases() {
  const base = rewardCompositionCase(), discount = fraction(1n, 2n), delay = 8;
  const vestedTruth = discountedUtility(base.tradingTruth, [{ delay, amount: base.composedTruth.lpReward }], discount);
  const vestedFake = discountedUtility(base.tradingDeviation, [{ delay, amount: base.composedDeviation.lpReward }], discount);
  const initial = createFixedCalendar(TOKEN, 7n);
  const committed = commitFixedGrant(initial, id(1), 7n, 0n, 100n, 200n, beneficiaries, COMMUNITY);
  const released = releaseFixedGrant(committed, id(1), 200n);
  const delivered = claimFixedGrant(released, OWNER_A, 3n);
  const fixedTruth = discountedUtility(base.tradingTruth, [{ delay, amount: 3n }], discount);
  const fixedFake = discountedUtility(base.tradingDeviation, [{ delay, amount: 3n }], discount);
  const caps = Array.from({ length: 8 }, (_n, i) => {
    const cap = BigInt(i + 1), domain = { lotSize: 4n, output: [0n, 2n * cap + 3n, 2n * cap + 8n, null] };
    const bids = [{ id: id(1), costPerLot: 4n, budget: 8n }, { id: id(2), costPerLot: 0n, budget: 4n }];
    const truth = costPivots(domain, bids), fake = costPivots(domain, [{ ...bids[0], costPerLot: 2n }, bids[1]]);
    const uncapped = [-truth.deficit / 2n, -fake.deficit / 2n];
    const capped = uncapped.map(n => n < cap ? n : cap);
    return { cap, domain, truth, fake, uncapped, capped, gain: capped[1] - capped[0] };
  });
  const futureFunding = [base.truth.residual[1], base.deviation.residual[1]].map(priorCash => {
    const calendar = createFixedCalendar(TOKEN, priorCash);
    try {
      const committed = commitFixedGrant(calendar, id(1), 5n, 100n, 200n, 300n, beneficiaries, COMMUNITY);
      const released = releaseFixedGrant(committed, id(1), 300n);
      return { priorCash, funded: true, nextClaim: released.ledger.claims.get(OWNER_A) ?? 0n };
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      return { priorCash, funded: false, failure: error.message };
    }
  });
  const empty = solveCostCandidate(base.frame, [{ id: id(1), sellingCurrency0: true, costPerLot: 20n, budget: 4n }]);
  const ineligible = [{ id: id(1), sellingCurrency0: true, costPerLot: 16n, budget: 4n }];
  const opposite = [{ id: id(1), sellingCurrency0: false, costPerLot: 0n, budget: 9n }];
  const original = solveCostCandidate(base.frame, ineligible), oppositeResult = solveCostCandidate(base.frame, opposite);
  const oppositeTrading = netCostUtility(opposite, oppositeResult, [id(1)], true, fraction(16n), 4n);
  const trueDelta: [bigint, bigint] = [0n, 0n], oppositeDelta: [bigint, bigint] = [3n, -9n];
  const fixedGift: [bigint, bigint] = [0n, 9n];
  const variants = ['settled with fills', 'settled with zero fills', 'expired', 'never admitted'];
  return { schema: 'otter/redistribution-research/v1',
    qualification: 'Offline fixed-calendar candidate and rejected alternatives; no adopted reward rule, real token delivery or full multi-epoch/LP incentive proof.',
    plateau: { input: 4n, ownPayment: 6n, trueCost: 4n, falseCost: 2n,
      currentPot: [3n, 5n], openingReward: [1n, 2n], combinedUtility: [fraction(3n), fraction(4n)] },
    vesting: { discount, delay, vestedTruth, vestedFake, gain: subtractFraction(vestedFake, vestedTruth) },
    cappedShares: { qualification: 'Synthetic certified finite domains, not additional real-v4 fixtures.', cases: caps },
    fixedCalendar: { initial, committed, released, delivered, accounting: fixedCalendarAccounting(delivered),
      outcomeVariants: variants.map(variant => ({ variant, fixedClaim: 3n, allocation: [...released.ledger.claims] })),
      fixedTruth, fixedFake, gain: subtractFraction(fixedFake, fixedTruth) },
    priorSurplusFunding: { attemptedFixedAmount: 5n, variants: futureFunding,
      qualification: 'Fixing a promise after history is known does not remove an earlier trader\'s influence on that history or funding availability.' },
    netFlowInterpretation: { qualification: 'Alternate all-wallet-flow utility, not the paper\'s additive fixed-fee convention or a selected mechanism.',
      trueAsk: fraction(4n), trueBudget: 4n, ineligible, opposite, original, oppositeResult,
      originalTradeUtility: netCostUtility(ineligible, original, [id(1)], true, fraction(16n), 4n),
      oppositeTradeUtility: oppositeTrading, trueDelta, oppositeDelta, fixedGift,
      additiveTruth: fraction(9n), additiveOpposite: null,
      walletTruth: walletUtility(trueDelta, fixedGift, true, fraction(4n), 4n),
      walletOpposite: walletUtility(oppositeDelta, fixedGift, true, fraction(4n), 4n) },
    emptyEpochFarming: { emptyCandidate: empty, perStartedEpochBonus: 3n, starts: 3,
      noStartedEpochsReward: 0n, admissionTriggeredReward: 9n, fixedCalendarReward: 3n,
      qualification: 'Hypothetical per-start external subsidy; net principal is refunded, before gas/latency. Precommitted calendar pays the same amount without a start.' } };
}

export const renderRedistributionCases = () => renderResearch(redistributionCases());
