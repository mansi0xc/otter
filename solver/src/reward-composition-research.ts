/** Offline role-composition diagnostics, NOT a selected redistribution rule.
 * A fixed opening stake is not an outcome-independent payment. This laboratory
 * includes the stake's cash reward in the trader's utility. It does not value
 * changing LP principal, prove inclusion, or authenticate any supplied owner. */
import { capitalWeight, divideReward } from './rewards.ts';
import { fraction, addFraction, type Fraction } from './representation-research.ts';

export function rewardUtility(trading: Fraction, outputPot: bigint, weights: readonly bigint[],
  controlledPositions: readonly number[], controlsCommunity = false, fixedOutputSubsidy = 0n) {
  const value = fraction(trading.numerator, trading.denominator);
  const distribution = divideReward(outputPot, weights);
  if (typeof controlsCommunity !== 'boolean' || typeof fixedOutputSubsidy !== 'bigint'
      || fixedOutputSubsidy < 0n || fixedOutputSubsidy >= 1n << 256n
      || new Set(controlledPositions).size !== controlledPositions.length
      || controlledPositions.some(i => !Number.isSafeInteger(i) || i < 0 || i >= weights.length)) {
    throw new RangeError('invalid controlled reward positions or fixed subsidy');
  }
  const lpReward = controlledPositions.reduce((sum, i) => sum + distribution.rewards[i], 0n);
  const communityReward = controlsCommunity ? distribution.dust : 0n;
  return { distribution, lpReward, communityReward, fixedOutputSubsidy,
    utility: addFraction(value, fraction(lpReward + communityReward + fixedOutputSubsidy)) };
}

/** Conditional partition comparison: fixed price/range, aggregate liquidity,
 * other weights and pot. No deposit/withdrawal/fee flows or gas are assumed
 * equal by this diagnostic. Different ranges are not a liquidity partition. */
export function sameRangeSplit(price: bigint, lower: number, upper: number,
  parts: readonly bigint[], otherWeights: readonly bigint[], pot: bigint) {
  if (parts.length < 1 || parts.length + otherWeights.length > 32
      || parts.some(n => typeof n !== 'bigint' || n <= 0n)) {
    throw new RangeError('invalid liquidity partition or position count');
  }
  const liquidity = parts.reduce((a, b) => a + b, 0n);
  const mergedWeight = capitalWeight(price, lower, upper, liquidity).weight;
  const splitWeights = parts.map(n => capitalWeight(price, lower, upper, n).weight);
  const merged = rewardUtility(fraction(0n), pot, [mergedWeight, ...otherWeights], [0]);
  const split = rewardUtility(fraction(0n), pot, [...splitWeights, ...otherWeights], parts.map((_n, i) => i));
  return { liquidity, mergedWeight, splitWeights,
    splitWeight: splitWeights.reduce((a, b) => a + b, 0n), merged, split,
    mergedOthers: merged.distribution.rewards.slice(1),
    splitOthers: split.distribution.rewards.slice(parts.length) };
}
