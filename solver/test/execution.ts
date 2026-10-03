import assert from 'node:assert/strict';
import {
  Q96, MIN_PRICE, MAX_PRICE_EXCLUSIVE, MAX_INPUT, MAX_OUTPUT, MAX_LIQUIDITY,
  MIN_TICK, MAX_TICK, CORE_MIN_PRICE, CORE_MAX_PRICE, Status, IncompleteSnapshot,
  sqrtPriceAtTick, tickAtSqrtPrice, bitmapPosition, amount0Delta, amount1Delta,
  swapStep, quoteExactInput, usableQuote, type PoolSnapshot,
} from '../src/execution.ts';
import { encodeRequest, decodeRequest, encodeQuote, decodeQuote } from '../src/execution-abi.ts';

type Position = { lower: number; upper: number; liquidity: bigint };
// Synthetic complete position schedule for tests, not a live-state reader.
function pool(positions: Position[] = [], spacing = 1, price = Q96, down = true, tick = tickAtSqrtPrice(price)): PoolSnapshot {
  const ticks = new Map<number, { gross: bigint; net: bigint }>();
  let liquidity = 0n;
  for (const p of positions) {
    assert.ok(p.lower % spacing === 0);
    assert.ok(p.upper % spacing === 0);
    for (const [t, net] of [[p.lower, p.liquidity], [p.upper, -p.liquidity]] as const) {
      const old = ticks.get(t) ?? { gross: 0n, net: 0n };
      ticks.set(t, { gross: old.gross + p.liquidity, net: old.net + net });
    }
    if (p.lower <= tick && tick < p.upper) liquidity += p.liquidity;
  }
  const first = bitmapPosition(Math.floor(tick / spacing) + (down ? 0 : 1)).word;
  const bitmap = new Map<number, bigint>();
  for (let i = 0; i < 16; i++) bitmap.set(first + (down ? -i : i), 0n);
  for (const t of ticks.keys()) {
    const { word, bit } = bitmapPosition(t / spacing);
    if (bitmap.has(word)) bitmap.set(word, bitmap.get(word)! | 1n << BigInt(bit));
  }
  return { keyFee: 0, tickSpacing: spacing, sqrtPriceX96: price, tick, liquidity, protocolFee: 0, lpFee: 0, bitmap, ticks };
}
const full = (liquidity: bigint): Position[] => [{ lower: MIN_TICK, upper: MAX_TICK, liquidity }];
let tests = 0;
function test(name: string, body: () => void): void { body(); tests++; console.log(`PASS ${name}`); }
let seed = 0xD4719;
function random32(): number {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed >>> 0;
}
function randomBig(bits: number): bigint {
  let x = 0n;
  for (let i = 0; i < bits; i += 32) x = x << 32n | BigInt(random32());
  return x & ((1n << BigInt(bits)) - 1n);
}

test('forward tick protocol constants and core boundaries', () => {
  assert.equal(sqrtPriceAtTick(0), Q96);
  assert.equal(sqrtPriceAtTick(MIN_TICK), CORE_MIN_PRICE);
  assert.equal(sqrtPriceAtTick(MAX_TICK), CORE_MAX_PRICE);
  assert.equal(sqrtPriceAtTick(1), 79232123823359799118286999568n);
  assert.equal(sqrtPriceAtTick(-1), 79224201403219477170569942574n);
  assert.throws(() => sqrtPriceAtTick(MAX_TICK + 1), RangeError);
  assert.throws(() => sqrtPriceAtTick(-1.5), RangeError);
  assert.throws(() => tickAtSqrtPrice(CORE_MIN_PRICE - 1n), RangeError);
  assert.throws(() => tickAtSqrtPrice(CORE_MAX_PRICE), RangeError);
});
test('binary-search inverse: tick prices, adjacent raw units, and random prices', () => {
  for (let i = 0; i < 2048; i++) {
    const t = i < 601 ? i - 300 : MIN_TICK + 1 + random32() % (MAX_TICK - MIN_TICK - 1);
    const p = sqrtPriceAtTick(t);
    assert.equal(tickAtSqrtPrice(p), t);
    assert.equal(tickAtSqrtPrice(p - 1n), t - 1);
    assert.equal(tickAtSqrtPrice(p + 1n), t);
    const raw = MIN_PRICE + randomBig(128) % (MAX_PRICE_EXCLUSIVE - MIN_PRICE);
    const floor = tickAtSqrtPrice(raw);
    assert.ok(sqrtPriceAtTick(floor) <= raw && sqrtPriceAtTick(floor + 1) > raw);
  }
});
test('direct amount fractions equal nested core floor/ceil divisions', () => {
  const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
  for (let i = 0; i < 2048; i++) {
    const a = MIN_PRICE + randomBig(128) % (MAX_PRICE_EXCLUSIVE - MIN_PRICE);
    const b = MIN_PRICE + randomBig(128) % (MAX_PRICE_EXCLUSIVE - MIN_PRICE);
    const low = a < b ? a : b, high = a < b ? b : a, l = randomBig(88);
    const numerator = l * Q96 * (high - low);
    assert.equal(amount0Delta(a, b, l, false), numerator / high / low);
    assert.equal(amount0Delta(a, b, l, true), ceil(ceil(numerator, high), low));
    assert.equal(amount1Delta(a, b, l, false), l * (high - low) / Q96);
    const delta = l * (high - low);
    assert.equal(amount1Delta(a, b, l, true), delta / Q96 + (delta % Q96 === 0n ? 0n : 1n));
  }
  assert.throws(() => amount0Delta(0n, Q96, 1n, true), RangeError);
  assert.throws(() => swapStep(Q96, Q96 - 1n, 1n, MAX_INPUT + 1n), RangeError);
});
test('signed word/bit positions and negative floor compression', () => {
  assert.deepEqual(bitmapPosition(-1), { word: -1, bit: 255 });
  assert.deepEqual(bitmapPosition(-256), { word: -1, bit: 0 });
  assert.deepEqual(bitmapPosition(-257), { word: -2, bit: 255 });
  assert.deepEqual(bitmapPosition(256), { word: 1, bit: 0 });
  const s = pool([{ lower: -120, upper: 0, liquidity: 1000n }], 60, sqrtPriceAtTick(-61));
  const q = quoteExactInput(s, true, MAX_INPUT, sqrtPriceAtTick(-100));
  assert.equal(q.status, Status.PriceLimit);
  assert.equal(q.initializedTicksCrossed, 0);
  assert.equal(q.tick, -100);
});
test('zero model input ignores limit without requiring bitmap data', () => {
  const s = pool(full(1000n));
  s.bitmap = new Map();
  const q = quoteExactInput(s, true, 0n, 0n);
  assert.equal(q.status, Status.Complete);
  assert.equal(q.sqrtPriceX96, Q96);
  assert.equal(q.tick, 0);
  assert.equal(q.steps, 0);
  assert.equal(q.bitmapWords, 0);
});
test('missing snapshot words and ticks fail instead of inventing empty liquidity', () => {
  const s = pool([{ lower: -120, upper: 0, liquidity: 1000n }]);
  assert.throws(() => quoteExactInput({ ...s, bitmap: new Map() }, true, 10n, sqrtPriceAtTick(-100)), IncompleteSnapshot);
  assert.throws(() => quoteExactInput({ ...s, ticks: new Map() }, true, 10n, sqrtPriceAtTick(-100)), IncompleteSnapshot);
  assert.throws(() => quoteExactInput({ ...s, bitmap: new Map([[0, 1n << 256n]]) }, true, 10n, sqrtPriceAtTick(-100)), RangeError);
});
test('ABI representations are checked before unlimited BigInt arithmetic', () => {
  const s = pool();
  assert.throws(() => quoteExactInput(s, true, -1n, MIN_PRICE), RangeError);
  assert.throws(() => quoteExactInput(s, true, 1n << 256n, MIN_PRICE), RangeError);
  assert.throws(() => quoteExactInput(s, true, 1n, 1n << 160n), RangeError);
  assert.throws(() => quoteExactInput({ ...s, tickSpacing: 1.5 }, true, 1n, MIN_PRICE), RangeError);
  assert.throws(() => quoteExactInput({ ...s, liquidity: 1n << 128n }, true, 1n, MIN_PRICE), RangeError);
});
test('domain rejections and status precedence match the contract policy', () => {
  const s = pool(full(1000n));
  const status = (change: Partial<PoolSnapshot>, amount = 1n, limit = MIN_PRICE) => quoteExactInput({ ...s, ...change }, true, amount, limit).status;
  assert.equal(status({ tickSpacing: 0 }), Status.UnsupportedPool);
  assert.equal(status({ tickSpacing: 32768 }), Status.UnsupportedPool);
  assert.equal(status({ sqrtPriceX96: 0n }), Status.UnsupportedPool);
  assert.equal(status({ keyFee: 0x800000 }), Status.UnsupportedFees);
  assert.equal(status({ lpFee: 100 }), Status.UnsupportedFees);
  assert.equal(status({ protocolFee: 1000 }, 0n, 0n), Status.UnsupportedFees);
  assert.equal(status({ protocolFee: 1000, liquidity: MAX_LIQUIDITY + 1n }, MAX_INPUT + 1n), Status.UnsupportedFees);
  assert.equal(status({ sqrtPriceX96: MIN_PRICE - 1n }, MAX_INPUT + 1n), Status.UnsupportedPrice);
  assert.equal(status({ sqrtPriceX96: MAX_PRICE_EXCLUSIVE }), Status.UnsupportedPrice);
  assert.equal(status({ liquidity: MAX_LIQUIDITY + 1n }, MAX_INPUT + 1n), Status.LiquidityLimit);
  assert.equal(status({}, MAX_INPUT + 1n, 0n), Status.UnsupportedAmount);
  assert.equal(status({}, 1n, MIN_PRICE - 1n), Status.UnsupportedPrice);
  assert.equal(status({}, 1n, Q96), Status.InvalidPriceLimit);
});
test('downward zero-amount crossing activates a range', () => {
  const s = pool([{ lower: -120, upper: 0, liquidity: 10n ** 18n }], 60);
  const q = quoteExactInput(s, true, 1n, sqrtPriceAtTick(-100));
  assert.equal(q.status, Status.Complete);
  assert.equal(q.initializedTicksCrossed, 1);
  assert.equal(q.steps, 2);
  assert.equal(q.liquidity, 10n ** 18n);
});
test('exact lower/upper tick endings preserve core tick/liquidity semantics', () => {
  for (const down of [true, false]) {
    const s = pool([{ lower: -60, upper: 60, liquidity: 10n ** 18n }], 60, Q96, down);
    const limit = sqrtPriceAtTick(down ? -60 : 60);
    const input = down ? amount0Delta(limit, Q96, s.liquidity, true) : amount1Delta(Q96, limit, s.liquidity, true);
    const q = quoteExactInput(s, down, input, limit);
    assert.equal(q.status, Status.Complete);
    assert.equal(q.liquidity, 0n);
    assert.equal(q.tick, down ? -61 : 60);
  }
});
test('empty words change rounding compared with a single-step shortcut', () => {
  for (const down of [true, false]) {
    const s = pool(full(1000000n), 1, Q96, down);
    const limit = sqrtPriceAtTick(down ? -1200 : 1200);
    const q = quoteExactInput(s, down, MAX_INPUT, limit);
    const naive = swapStep(Q96, limit, s.liquidity, MAX_INPUT);
    assert.equal(q.status, Status.PriceLimit);
    assert.ok(q.bitmapWords > 1);
    assert.ok(q.consumedInput !== naive.input || q.output !== naive.output);
  }
});
test('empty-liquidity traversal reports no consumption/output', () => {
  for (const down of [true, false]) {
    const q = quoteExactInput(pool([], 1, Q96, down), down, 100n, sqrtPriceAtTick(down ? -800 : 800));
    assert.equal(q.status, Status.PriceLimit);
    assert.equal(q.consumedInput, 0n);
    assert.equal(q.output, 0n);
  }
});
test('sixteen words supported; unfinished seventeenth word is unusable', () => {
  for (const down of [true, false]) {
    const s = pool([], 1, Q96, down);
    const end = down ? -3840 : 4095;
    const q = quoteExactInput(s, down, 1n, sqrtPriceAtTick(end));
    assert.equal(q.status, Status.PriceLimit);
    assert.equal(q.bitmapWords, 16);
    const unsupported = quoteExactInput(s, down, 1n, sqrtPriceAtTick(end + (down ? -1 : 1)));
    assert.equal(unsupported.status, Status.WordLimit);
    assert.equal(unsupported.bitmapWords, 16);
    assert.equal(usableQuote(unsupported), false);
  }
});
test('64 crossings and 80 steps supported; unfinished traces remain unsupported', () => {
  const positions = Array.from({ length: 32 }, (_, i) => ({ lower: 1 + i * 128, upper: 64 + i * 128, liquidity: 10n ** 12n }));
  const s = pool(positions, 1, Q96, false);
  const q = quoteExactInput(s, false, MAX_INPUT, sqrtPriceAtTick(4095));
  assert.equal(q.status, Status.PriceLimit);
  assert.equal(q.bitmapWords, 16);
  assert.equal(q.initializedTicksCrossed, 64);
  assert.equal(q.steps, 80);
  assert.equal(quoteExactInput(s, false, MAX_INPUT, sqrtPriceAtTick(4096)).status, Status.StepLimit);
  const dense = pool(Array.from({ length: 33 }, (_, i) => ({ lower: 1 + i * 3, upper: 2 + i * 3, liquidity: 10n ** 12n })), 1, Q96, false);
  const limited = quoteExactInput(dense, false, MAX_INPUT, sqrtPriceAtTick(110));
  assert.equal(limited.status, Status.TickLimit);
  assert.equal(limited.initializedTicksCrossed, 64);
  assert.equal(limited.tick, 95);
});
test('crossing liquidity bounds reject before committing an invalid step', () => {
  const inactive = pool([{ lower: -120, upper: 0, liquidity: MAX_LIQUIDITY + 1n }]);
  const q = quoteExactInput(inactive, true, 1n, sqrtPriceAtTick(-100));
  assert.equal(q.status, Status.LiquidityLimit);
  assert.equal(q.consumedInput, 0n);
  assert.equal(q.steps, 0);
  const grows = pool([{ lower: -600, upper: 600, liquidity: 1n << 87n }, { lower: 60, upper: 120, liquidity: 1n << 87n }], 1, Q96, false);
  const overflow = quoteExactInput(grows, false, MAX_INPUT, sqrtPriceAtTick(100));
  assert.equal(overflow.status, Status.LiquidityLimit);
  assert.equal(overflow.liquidity, 1n << 87n);
  assert.equal(overflow.initializedTicksCrossed, 0);
});
test('maximum spacing, raw price endpoints and maximum amounts', () => {
  const positions = [{ lower: -884709, upper: 884709, liquidity: MAX_LIQUIDITY }];
  for (const down of [true, false]) {
    const price = down ? MIN_PRICE + 1n : MAX_PRICE_EXCLUSIVE - 2n;
    const limit = down ? MIN_PRICE : MAX_PRICE_EXCLUSIVE - 1n;
    const q = quoteExactInput(pool(positions, 32767, price, down), down, MAX_INPUT, limit);
    assert.equal(q.status, Status.PriceLimit);
    assert.equal(q.sqrtPriceX96, limit);
    assert.ok(q.output <= MAX_OUTPUT);
  }
});
test('quotes do not mutate caller snapshots', () => {
  const s = pool(full(1000n));
  const before = structuredClone(s);
  quoteExactInput(s, true, 10n, sqrtPriceAtTick(-100));
  assert.deepEqual(s, before);
});
test('raw integer curve has a staircase, violating continuous concavity', () => {
  const s = pool(full(1000n));
  const outputs = [0n, 1n, 2n].map(a => quoteExactInput(s, true, a, sqrtPriceAtTick(-100)).output);
  assert.deepEqual(outputs, [0n, 0n, 1n]);
  // For a concave curve on equally spaced inputs, marginal increments cannot
  // increase. This is a counterexample to treating the integer quote as smooth F.
  assert.ok(outputs[2] - outputs[1] > outputs[1] - outputs[0]);
});
test('seeded bounded quote invariants across 4096 independent snapshots', () => {
  for (let i = 0; i < 4096; i++) {
    const down = (random32() & 1) === 0;
    const start = random32() % 1001 - 500;
    const l = 1n + randomBig(64);
    const positions = [{ lower: -6000, upper: 6000, liquidity: l },
      { lower: -1200, upper: 1200, liquidity: l * 2n }, { lower: -120, upper: 120, liquidity: l * 3n }];
    const s = pool(positions, down ? 1 : 60, sqrtPriceAtTick(start), down);
    const input = randomBig(96);
    const q = quoteExactInput(s, down, input, sqrtPriceAtTick(down ? -3000 : 3000));
    assert.ok(usableQuote(q));
    assert.ok(q.consumedInput >= 0n && q.consumedInput <= input && q.output >= 0n && q.output <= MAX_OUTPUT);
    assert.ok(q.bitmapWords <= 16 && q.initializedTicksCrossed <= 64 && q.steps <= 80);
    assert.equal(q.status === Status.Complete, q.consumedInput === input);
  }
});
test('ABI bridge roundtrips signed metadata and results without truncation', () => {
  const snapshot = pool([{ lower: -120, upper: 120, liquidity: 1000n }], 60, sqrtPriceAtTick(-61));
  const request = { snapshot, down: true, amount: MAX_INPUT, limit: MIN_PRICE };
  assert.deepEqual(decodeRequest(encodeRequest(request)), request);
  const q = quoteExactInput(snapshot, true, 1n, sqrtPriceAtTick(-100));
  assert.deepEqual(decodeQuote(encodeQuote(q)), q);
  assert.throws(() => decodeRequest(encodeRequest(request).slice(0, -2)), RangeError);
  assert.throws(() => decodeRequest(encodeRequest(request) + '0'.repeat(64)), RangeError);
  assert.throws(() => decodeQuote(encodeQuote(q) + '0'.repeat(64)), RangeError);
  assert.throws(() => encodeRequest({ ...request, amount: 1n << 256n }), RangeError);
  const wire = encodeRequest(request);
  const replaceWord = (hex: string, index: number, replacement: string) =>
    hex.slice(0, 2 + index * 64) + replacement + hex.slice(2 + (index + 1) * 64);
  const value = (n: bigint) => n.toString(16).padStart(64, '0');
  assert.throws(() => decodeRequest(replaceWord(wire, 0, value(64n))), RangeError);
  assert.throws(() => decodeRequest(replaceWord(wire, 8, value(2n))), RangeError);
  assert.throws(() => decodeRequest(replaceWord(wire, 2, value((1n << 24n) - 1n))), RangeError);
  assert.throws(() => decodeRequest(replaceWord(wire, 10, value(1n << 160n))), RangeError);
  // Duplicate the first word position and the first initialized tick index.
  assert.throws(() => decodeRequest(replaceWord(wire, 16, wire.slice(2 + 14 * 64, 2 + 15 * 64))), RangeError);
  assert.throws(() => decodeRequest(replaceWord(wire, 50, wire.slice(2 + 47 * 64, 2 + 48 * 64))), RangeError);
});

console.log(`${tests} execution reference groups passed; all randomized checks use a fixed seed.`);
