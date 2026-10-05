/**
 * Independent BigInt reference for OtterExecutionOracle's zero-fee core quote.
 * Targets v4-core e50237c43811bd9b526eff40f26772152a42daba.
 * Amounts use exact fractions; the tick inverse uses binary search rather than
 * core's logarithm approximation. The forward tick constants/rounding and the
 * empty-word endpoints are protocol rules and must remain identical to core.
 *
 * This is an offline model, not an RPC reader or authenticated pool snapshot.
 * Missing bitmap/tick data throws; it is never assumed to describe empty state.
 * It does not implement the auction or arbitrary hook/asset behavior.
 */
export const Q96 = 1n << 96n;
export const MAX_INPUT = (1n << 96n) - 1n;
export const MAX_OUTPUT = (1n << 120n) - 1n;
export const MAX_LIQUIDITY = (1n << 88n) - 1n;
export const MIN_PRICE = 1n << 64n;
export const MAX_PRICE_EXCLUSIVE = 1n << 128n;
export const MAX_WORDS = 16;
export const MAX_CROSSINGS = 64;
export const MAX_STEPS = 80;
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
export const CORE_MIN_PRICE = 4295128739n;
export const CORE_MAX_PRICE = 1461446703485210103287273052203988822378723970342n;
const U256_MAX = (1n << 256n) - 1n;

// Ordinals intentionally match the Solidity enum, including unsupported results.
// Use an object: Node's strip-types runtime does not transform TS enums.
export const Status = Object.freeze({
  UnsupportedPool: 0, UnsupportedFees: 1, UnsupportedPrice: 2,
  UnsupportedAmount: 3, InvalidPriceLimit: 4, LiquidityLimit: 5,
  OutputLimit: 6, WordLimit: 7, TickLimit: 8, StepLimit: 9,
  Complete: 10, PriceLimit: 11,
});

export interface TickLiquidity { gross: bigint; net: bigint }
export interface PoolSnapshot {
  keyFee: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  protocolFee: number;
  lpFee: number;
  bitmap: ReadonlyMap<number, bigint>;
  ticks: ReadonlyMap<number, TickLiquidity>;
}
export interface Quote {
  status: number;
  requestedInput: bigint;
  consumedInput: bigint;
  output: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  bitmapWords: number;
  initializedTicksCrossed: number;
  steps: number;
}

export class IncompleteSnapshot extends Error {
  kind: 'bitmap' | 'tick' | undefined;
  position: number | undefined;
  constructor(message: string, kind?: 'bitmap' | 'tick', position?: number) {
    super(message); this.kind = kind; this.position = position;
  }
}
export const usableQuote = (q: Quote): boolean => q.status === Status.Complete || q.status === Status.PriceLimit;

function uint(value: bigint, bits: number, name: string): void {
  if (typeof value !== 'bigint' || value < 0n || value >= 1n << BigInt(bits)) {
    throw new RangeError(`${name} must fit uint${bits}`);
  }
}
function signed(value: bigint, bits: number, name: string): void {
  if (typeof value !== 'bigint' || value < -(1n << BigInt(bits - 1)) || value >= 1n << BigInt(bits - 1)) {
    throw new RangeError(`${name} must fit int${bits}`);
  }
}
function integer(value: number, lo: number, hi: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < lo || value > hi) throw new RangeError(`${name} outside representation`);
}
function ceilDiv(n: bigint, d: bigint): bigint { return (n + d - 1n) / d; }
const priceSupported = (p: bigint) => p >= MIN_PRICE && p < MAX_PRICE_EXCLUSIVE;

// Q128.128 reciprocal factors for sqrt(1.0001^(2^i)), with core's quantization.
const TICK_FACTORS = [
  0xfffcb933bd6fad37aa2d162d1a594001n, 0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn, 0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n, 0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n, 0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n, 0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n, 0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n, 0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n, 0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n, 0x48a170391f7dc42444e8fa2n,
];

export function sqrtPriceAtTick(tick: number): bigint {
  integer(tick, MIN_TICK, MAX_TICK, 'tick');
  const magnitude = Math.abs(tick);
  let ratio = 1n << 128n;
  for (let i = 0; i < TICK_FACTORS.length; i++) {
    if ((magnitude & (1 << i)) !== 0) ratio = ratio * TICK_FACTORS[i] >> 128n;
  }
  if (tick > 0) ratio = U256_MAX / ratio;
  return ceilDiv(ratio, 1n << 32n);
}

/** Greatest tick whose quantized forward price is <= price, as required by core. */
export function tickAtSqrtPrice(price: bigint): number {
  if (typeof price !== 'bigint' || price < CORE_MIN_PRICE || price >= CORE_MAX_PRICE) {
    throw new RangeError('price outside core tick inverse domain');
  }
  let lo = MIN_TICK;
  let hi = MAX_TICK;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sqrtPriceAtTick(mid) <= price) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Direct rational amount math; nested floor/ceil divisions give this same result. */
export function amount0Delta(a: bigint, b: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (a <= 0n || b <= 0n || liquidity < 0n) throw new RangeError('invalid amount0 domain');
  const low = a < b ? a : b;
  const high = a < b ? b : a;
  const n = liquidity * Q96 * (high - low);
  const d = low * high;
  return roundUp ? ceilDiv(n, d) : n / d;
}
export function amount1Delta(a: bigint, b: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (a <= 0n || b <= 0n || liquidity < 0n) throw new RangeError('invalid amount1 domain');
  const n = liquidity * (a > b ? a - b : b - a);
  return roundUp ? ceilDiv(n, Q96) : n / Q96;
}

/** Zero-fee exact-input step, restricted to Otter's bounded price/L/input domain. */
export function swapStep(price: bigint, target: bigint, liquidity: bigint, remaining: bigint): {
  price: bigint; input: bigint; output: bigint;
} {
  if (!priceSupported(price) || !priceSupported(target) || liquidity < 0n || liquidity > MAX_LIQUIDITY
      || remaining <= 0n || remaining > MAX_INPUT) throw new RangeError('step outside supported domain');
  const down = price >= target;
  const required = down ? amount0Delta(target, price, liquidity, true) : amount1Delta(price, target, liquidity, true);
  let next = target;
  let input = required;
  if (remaining < required) {
    input = remaining;
    // In this supported domain amount*price < 2^224 and L*Q96 < 2^184:
    // core's uint256 product/denominator fallback cannot trigger.
    next = down ? ceilDiv(liquidity * Q96 * price, liquidity * Q96 + input * price)
      : price + input * Q96 / liquidity;
  }
  const output = down ? amount1Delta(next, price, liquidity, false) : amount0Delta(price, next, liquidity, false);
  return { price: next, input, output };
}

export function bitmapPosition(compressed: number): { word: number; bit: number } {
  const word = Math.floor(compressed / 256);
  return { word, bit: compressed - word * 256 };
}

function nextTick(bitmap: bigint, compressed: number, bit: number, spacing: number, down: boolean): {
  tick: number; initialized: boolean;
} {
  const mask = down ? (1n << BigInt(bit + 1)) - 1n : U256_MAX ^ ((1n << BigInt(bit)) - 1n);
  const masked = bitmap & mask;
  if (masked === 0n) return { tick: (compressed + (down ? -bit : 255 - bit)) * spacing, initialized: false };
  // Scan rather than sharing BitMath's implementation. At most 256 iterations.
  let found = bit;
  while ((masked & (1n << BigInt(found))) === 0n) found += down ? -1 : 1;
  return { tick: (compressed + found - bit) * spacing, initialized: true };
}

/**
 * Match Solidity's status/check order for ABI-representable requests and valid
 * manager snapshots. Malformed representations or missing snapshot data throw
 * separately; these are off-chain input failures, not on-chain quote statuses.
 * The source must provide every visited word (including explicit zero words)
 * and every reached initialized tick. Maps are not modified by this function.
 */
export function quoteExactInput(s: PoolSnapshot, down: boolean, amount: bigint, limit: bigint): Quote {
  integer(s.tickSpacing, -(1 << 23), (1 << 23) - 1, 'tick spacing');
  integer(s.keyFee, 0, (1 << 24) - 1, 'key fee');
  uint(amount, 256, 'amount');
  uint(limit, 160, 'limit');
  if (typeof down !== 'boolean') throw new TypeError('direction must be boolean');
  const q: Quote = { status: Status.UnsupportedPool, requestedInput: amount, consumedInput: 0n, output: 0n,
    sqrtPriceX96: 0n, tick: 0, liquidity: 0n, bitmapWords: 0, initializedTicksCrossed: 0, steps: 0 };
  if (s.tickSpacing < 1 || s.tickSpacing > 32767) return q;
  uint(s.sqrtPriceX96, 160, 'snapshot price');
  integer(s.tick, -(1 << 23), (1 << 23) - 1, 'snapshot tick');
  integer(s.protocolFee, 0, (1 << 24) - 1, 'protocol fee');
  integer(s.lpFee, 0, (1 << 24) - 1, 'LP fee');
  q.sqrtPriceX96 = s.sqrtPriceX96;
  q.tick = s.tick;
  if (q.sqrtPriceX96 === 0n) return q;
  uint(s.liquidity, 128, 'snapshot liquidity');
  q.liquidity = s.liquidity;
  const fail = (status: number): Quote => { q.status = status; return q; };
  if (s.keyFee !== 0 || s.protocolFee !== 0 || s.lpFee !== 0) return fail(Status.UnsupportedFees);
  if (!priceSupported(q.sqrtPriceX96)) return fail(Status.UnsupportedPrice);
  if (q.liquidity > MAX_LIQUIDITY) return fail(Status.LiquidityLimit);
  if (amount > MAX_INPUT) return fail(Status.UnsupportedAmount);
  if (amount === 0n) return fail(Status.Complete);
  if (!priceSupported(limit)) return fail(Status.UnsupportedPrice);
  if (down ? limit >= q.sqrtPriceX96 : limit <= q.sqrtPriceX96) return fail(Status.InvalidPriceLimit);

  let cachedPosition: number | undefined;
  let cachedWord = 0n;
  while (q.consumedInput < amount && q.sqrtPriceX96 !== limit) {
    if (q.steps === MAX_STEPS) return fail(Status.StepLimit);
    const compressed = Math.floor(q.tick / s.tickSpacing) + (down ? 0 : 1);
    const { word, bit } = bitmapPosition(compressed);
    if (cachedPosition !== word) {
      if (q.bitmapWords === MAX_WORDS) return fail(Status.WordLimit);
      const read = s.bitmap.get(word);
      if (read === undefined) throw new IncompleteSnapshot(`missing bitmap word ${word}`, 'bitmap', word);
      uint(read, 256, 'bitmap word');
      cachedWord = read;
      cachedPosition = word;
      q.bitmapWords++;
    }
    const found = nextTick(cachedWord, compressed, bit, s.tickSpacing, down);
    const tickNext = Math.max(MIN_TICK, Math.min(MAX_TICK, found.tick));
    const tickPrice = sqrtPriceAtTick(tickNext);
    const target = down ? (tickPrice > limit ? tickPrice : limit) : (tickPrice < limit ? tickPrice : limit);
    const step = swapStep(q.sqrtPriceX96, target, q.liquidity, amount - q.consumedInput);
    if (step.output > MAX_OUTPUT - q.output) return fail(Status.OutputLimit);
    let tick = q.tick;
    let liquidity = q.liquidity;
    if (step.price === tickPrice) {
      if (found.initialized) {
        if (q.initializedTicksCrossed === MAX_CROSSINGS) return fail(Status.TickLimit);
        const crossed = s.ticks.get(tickNext);
        if (crossed === undefined) throw new IncompleteSnapshot(`missing initialized tick ${tickNext}`, 'tick', tickNext);
        uint(crossed.gross, 128, 'tick gross');
        signed(crossed.net, 128, 'tick net');
        liquidity += down ? -crossed.net : crossed.net;
        if (crossed.gross > MAX_LIQUIDITY || liquidity < 0n || liquidity > MAX_LIQUIDITY) return fail(Status.LiquidityLimit);
        q.initializedTicksCrossed++;
      }
      tick = down ? tickNext - 1 : tickNext;
    } else if (step.price !== q.sqrtPriceX96) tick = tickAtSqrtPrice(step.price);
    q.sqrtPriceX96 = step.price;
    q.tick = tick;
    q.liquidity = liquidity;
    q.consumedInput += step.input;
    q.output += step.output;
    q.steps++;
  }
  return fail(q.consumedInput === amount ? Status.Complete : Status.PriceLimit);
}
