/** Fixed offline fixtures, not authenticated on-chain snapshots or signed IDs. */
import {
  Q96, MIN_TICK, MAX_TICK, bitmapPosition, sqrtPriceAtTick, tickAtSqrtPrice, swapStep,
  type PoolSnapshot,
} from '../src/execution.ts';
import { executionTable, pivots, concavity, refundOnDeficit, minorityAtSpot, WAD, type Bid } from '../src/discrete-research.ts';

export const id = (n: number): string => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
export const bid = (n: number, ask: bigint, budget: bigint): Bid => ({ id: id(n), ask, budget });

export function pool(
  positions: { lower: number; upper: number; liquidity: bigint }[],
  spacing = 60, price = Q96, tick = tickAtSqrtPrice(price),
): PoolSnapshot {
  const ticks = new Map<number, { gross: bigint; net: bigint }>();
  let liquidity = 0n;
  for (const p of positions) {
    if (p.lower >= p.upper || p.lower % spacing !== 0 || p.upper % spacing !== 0 || p.liquidity <= 0n) {
      throw new RangeError('invalid synthetic range');
    }
    for (const [t, net] of [[p.lower, p.liquidity], [p.upper, -p.liquidity]] as const) {
      const old = ticks.get(t) ?? { gross: 0n, net: 0n };
      ticks.set(t, { gross: old.gross + p.liquidity, net: old.net + net });
    }
    if (p.lower <= tick && tick < p.upper) liquidity += p.liquidity;
  }
  const downWord = bitmapPosition(Math.floor(tick / spacing)).word;
  const upWord = bitmapPosition(Math.floor(tick / spacing) + 1).word;
  const bitmap = new Map<number, bigint>();
  for (let i = 0; i < 16; i++) { bitmap.set(downWord - i, 0n); bitmap.set(upWord + i, 0n); }
  for (const t of ticks.keys()) {
    const { word, bit } = bitmapPosition(t / spacing);
    if (bitmap.has(word)) bitmap.set(word, bitmap.get(word)! | 1n << BigInt(bit));
  }
  return { keyFee: 0, tickSpacing: spacing, sqrtPriceX96: price, tick, liquidity,
    protocolFee: 0, lpFee: 0, bitmap, ticks };
}
export const fullPool = (liquidity: bigint, spacing = 60, price = Q96): PoolSnapshot => pool([{
  lower: Math.ceil(MIN_TICK / spacing) * spacing, upper: Math.floor(MAX_TICK / spacing) * spacing, liquidity,
}], spacing, price);

export function cases() {
  const staircase = executionTable(fullPool(1000n, 1), true, sqrtPriceAtTick(-100), 1n, 8);
  const zeroAskBids = [bid(1, 0n, 1n), bid(2, 0n, 1n)];
  const zeroAsk = pivots(staircase, zeroAskBids);
  const positiveBids = [bid(1, WAD / 10n, 1n), bid(2, WAD / 10n, 1n)];
  const positive = pivots(staircase, positiveBids);
  const fractionalBids = [bid(1, WAD / 2n, 1n), bid(2, WAD / 2n, 1n)];
  const fractional = pivots(staircase, fractionalBids);

  const honestBids = [bid(1, 0n, 2n), bid(2, 0n, 1n)];
  const dishonestBids = [bid(1, WAD, 2n), bid(2, 0n, 1n)];
  const honest = pivots(staircase, honestBids);
  const dishonest = pivots(staircase, dishonestBids);
  const refunded = refundOnDeficit(honest);
  const accepted = refundOnDeficit(dishonest);

  const price = Q96 * 3n / 2n;
  const s = fullPool(1000n, 60, price);
  const tick = tickAtSqrtPrice(price);
  const broadLimit = sqrtPriceAtTick(tick - 100);
  const limit = swapStep(price, broadLimit, 1000n, 1n).price;
  const scarce = executionTable(s, true, limit, 1n, 3);
  const truth = pivots(scarce, [bid(1, WAD * 3n / 4n, 1n), bid(2, WAD / 2n, 1n)]);
  const deviation = pivots(scarce, [bid(1, WAD / 4n, 1n), bid(2, WAD / 2n, 1n)]);
  const trueUtility = truth.ceilPayment[0] * WAD - WAD * 3n / 4n * truth.fill[0];
  const deviatingUtility = deviation.ceilPayment[0] * WAD - WAD * 3n / 4n * deviation.fill[0];

  const linearLimit = swapStep(price, broadLimit, 1000n, 2n).price;
  const linear = executionTable(s, true, linearLimit, 1n, 4);
  const unsplitBids = [bid(1, WAD / 4n, 2n), bid(3, WAD / 2n, 2n)];
  const splitBids = [bid(1, WAD / 4n, 1n), bid(2, WAD / 4n, 1n), bid(3, WAD / 2n, 2n)];
  const unsplit = pivots(linear, unsplitBids);
  const split = pivots(linear, splitBids);

  return {
    schema: 'otter/discrete-research/v1',
    qualification: 'Offline negative controls; no production solver, authenticated snapshot, or accepted mechanism.',
    pivotFunding: { curve: staircase.output, bids: zeroAskBids, result: zeroAsk },
    noIntegerIRPaymentVector: { curve: staircase.output, bids: positiveBids, result: positive,
      minimumTotal: positive.minimumPayment.reduce((a, b) => a + b, 0n) },
    roundingOnlyDeficit: { bids: fractionalBids, result: fractional },
    refundOnDeficitDeviation: { honestBids, dishonestBids, honest, dishonest,
      truthful: refunded, deviating: accepted,
      gainNumerator: (accepted.payment[0] - refunded.payment[0]) * WAD },
    ceilPaymentAskDeviation: { snapshotPrice: price, limit, curve: scarce.output, certificate: concavity(scarce),
      partialRequest: scarce.quotes[2], truth, deviation, trueUtilityNumerator: trueUtility,
      deviatingUtilityNumerator: deviatingUtility, gainNumerator: deviatingUtility - trueUtility },
    ceilPaymentFalseName: { snapshotPrice: price, limit: linearLimit, curve: linear.output, certificate: concavity(linear),
      partialRequest: linear.quotes[3],
      unsplitBids, splitBids, unsplit, split,
      rawGainNumerator: split.paymentNumerator[0] + split.paymentNumerator[1] - unsplit.paymentNumerator[0],
      roundedGain: split.ceilPayment[0] + split.ceilPayment[1] - unsplit.ceilPayment[0] },
    minorityDust: { snapshotPrice: price,
      sellsCurrency1: minorityAtSpot(price, false, WAD * 2n / 5n, 1n),
      sellsCurrency0: minorityAtSpot(price, true, 2n * WAD, 1n) },
  };
}

export const renderCases = (): string => JSON.stringify(cases(), (_key, value) =>
  typeof value === 'bigint' ? value.toString() : value, 2) + '\n';
