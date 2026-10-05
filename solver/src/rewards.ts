/** Exact offline reference for the selected opening-capital reward policy.
 * It neither authenticates ownership nor proves LP incentive compatibility. */
import { Q96, sqrtPriceAtTick } from './execution.ts';

const MAX256 = (1n << 256n) - 1n;
export function capitalWeight(price: bigint, lowerTick: number, upperTick: number, liquidity: bigint) {
  if (typeof price !== 'bigint' || price < 1n << 64n || price >= 1n << 128n
    || typeof liquidity !== 'bigint' || liquidity < 0n || liquidity >= 1n << 128n
    || !Number.isSafeInteger(lowerTick) || !Number.isSafeInteger(upperTick) || lowerTick >= upperTick) {
    throw new RangeError('invalid reward principal domain');
  }
  const lower = sqrtPriceAtTick(lowerTick), upper = sqrtPriceAtTick(upperTick);
  const bottom = price > lower ? price : lower, top = price < upper ? price : upper;
  const principal0 = price < upper ? liquidity * Q96 * (upper - bottom) / (upper * bottom) : 0n;
  const principal1 = price > lower ? liquidity * (top - lower) / Q96 : 0n;
  const weight = principal1 + principal0 * price * price / (Q96 * Q96);
  if (weight > MAX256) throw new RangeError('reward value overflow');
  return { principal0, principal1, weight };
}

export function divideReward(amount: bigint, weights: readonly bigint[]) {
  if (typeof amount !== 'bigint' || amount < 0n || amount > MAX256
    || weights.length === 0 || weights.length > 32
    || weights.some(w => typeof w !== 'bigint' || w < 0n || w > MAX256)) throw new RangeError('invalid reward pot');
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n || total > MAX256) throw new RangeError('invalid reward weight total');
  const rewards = weights.map(w => amount * w / total);
  return { rewards, dust: amount - rewards.reduce((a, b) => a + b, 0n) };
}
