/** Small dependency-free codec for the local Forge/BigInt differential test. */
import { type PoolSnapshot, type Quote, type TickLiquidity } from './execution.ts';

export interface Request { snapshot: PoolSnapshot; down: boolean; amount: bigint; limit: bigint }
const MODULUS = 1n << 256n;
const HEADER_BYTES = 12 * 32;

function representation(value: bigint, bits: number, signed: boolean): bigint {
  const lo = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const hi = signed ? 1n << BigInt(bits - 1) : 1n << BigInt(bits);
  if (value < lo || value >= hi) throw new RangeError(`noncanonical ${signed ? 'int' : 'uint'}${bits}`);
  return value;
}
function encoded(value: bigint, bits = 256, signed = false): string {
  representation(value, bits, signed);
  return (value < 0n ? value + MODULUS : value).toString(16).padStart(64, '0');
}
function readHex(hex: string): { word: (offset: number, bits?: number, signed?: boolean) => bigint; size: number } {
  if (!/^0x(?:[0-9a-fA-F]{64})+$/.test(hex)) throw new RangeError('expected whole ABI words');
  const body = hex.slice(2);
  const size = body.length / 2;
  const word = (offset: number, bits = 256, signed = false): bigint => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % 32 !== 0 || offset + 32 > size) {
      throw new RangeError('ABI word outside payload');
    }
    let value = BigInt('0x' + body.slice(offset * 2, offset * 2 + 64));
    if (signed && value >= 1n << 255n) value -= MODULUS;
    return representation(value, bits, signed);
  };
  return { word, size };
}

/** ABI encode a single dynamic tuple, as abi.encode(Request) in Solidity. */
export function encodeRequest(r: Request): string {
  if (typeof r.down !== 'boolean') throw new TypeError('direction must be boolean');
  const s = r.snapshot;
  const words = [...s.bitmap.entries()];
  const ticks = [...s.ticks.entries()];
  if (words.length > 16 || ticks.length > 4096) throw new RangeError('snapshot exceeds codec bound');
  const wordData = encoded(BigInt(words.length)) + words.map(([p, bitmap]) => encoded(BigInt(p), 16, true) + encoded(bitmap)).join('');
  const tickData = encoded(BigInt(ticks.length)) + ticks.map(([t, info]) =>
    encoded(BigInt(t), 24, true) + encoded(info.gross, 128) + encoded(info.net, 128, true)).join('');
  return '0x' + encoded(32n) + [
    encoded(BigInt(s.keyFee), 24), encoded(BigInt(s.tickSpacing), 24, true),
    encoded(s.sqrtPriceX96, 160), encoded(BigInt(s.tick), 24, true), encoded(s.liquidity, 128),
    encoded(BigInt(s.protocolFee), 24), encoded(BigInt(s.lpFee), 24), encoded(r.down ? 1n : 0n, 1),
    encoded(r.amount), encoded(r.limit, 160), encoded(BigInt(HEADER_BYTES)),
    encoded(BigInt(HEADER_BYTES + wordData.length / 2)),
  ].join('') + wordData + tickData;
}

/** Reject truncated, overlapping, duplicate, out-of-width and noncanonical data. */
export function decodeRequest(hex: string): Request {
  const { word, size } = readHex(hex);
  const root = 32;
  if (word(0) !== 32n || word(root + 10 * 32) !== BigInt(HEADER_BYTES)) throw new RangeError('invalid ABI root/word offset');
  const wordStart = root + HEADER_BYTES;
  const count = word(wordStart);
  if (count > 16n) throw new RangeError('too many bitmap words');
  const wordCount = Number(count);
  const tickStart = wordStart + 32 + wordCount * 64;
  if (word(root + 11 * 32) !== BigInt(tickStart - root)) throw new RangeError('noncanonical tick offset');
  const tickCount = word(tickStart);
  if (tickCount > 4096n || tickStart + 32 + Number(tickCount) * 96 !== size) throw new RangeError('invalid tick array/payload length');
  const bitmap = new Map<number, bigint>();
  for (let i = 0; i < wordCount; i++) {
    const offset = wordStart + 32 + i * 64;
    const p = Number(word(offset, 16, true));
    if (bitmap.has(p)) throw new RangeError('duplicate bitmap word');
    bitmap.set(p, word(offset + 32));
  }
  const ticks = new Map<number, TickLiquidity>();
  for (let i = 0; i < Number(tickCount); i++) {
    const offset = tickStart + 32 + i * 96;
    const t = Number(word(offset, 24, true));
    if (ticks.has(t)) throw new RangeError('duplicate initialized tick');
    ticks.set(t, { gross: word(offset + 32, 128), net: word(offset + 64, 128, true) });
  }
  const boolean = word(root + 7 * 32, 1);
  return { snapshot: {
    keyFee: Number(word(root, 24)), tickSpacing: Number(word(root + 32, 24, true)),
    sqrtPriceX96: word(root + 2 * 32, 160), tick: Number(word(root + 3 * 32, 24, true)),
    liquidity: word(root + 4 * 32, 128), protocolFee: Number(word(root + 5 * 32, 24)),
    lpFee: Number(word(root + 6 * 32, 24)), bitmap, ticks,
  }, down: boolean === 1n, amount: word(root + 8 * 32), limit: word(root + 9 * 32, 160) };
}

export function encodeQuote(q: Quote): string {
  if (!Number.isInteger(q.status) || q.status < 0 || q.status > 11) throw new RangeError('unknown quote status');
  return '0x' + [
    encoded(BigInt(q.status), 8), encoded(q.requestedInput), encoded(q.consumedInput), encoded(q.output),
    encoded(q.sqrtPriceX96, 160), encoded(BigInt(q.tick), 24, true), encoded(q.liquidity, 128),
    encoded(BigInt(q.bitmapWords), 8), encoded(BigInt(q.initializedTicksCrossed), 8), encoded(BigInt(q.steps), 16),
  ].join('');
}

export function decodeQuote(hex: string): Quote {
  const { word, size } = readHex(hex);
  const status = Number(word(0, 8));
  if (size !== 320 || status > 11) throw new RangeError('invalid quote payload');
  return { status, requestedInput: word(32), consumedInput: word(64), output: word(96),
    sqrtPriceX96: word(128, 160), tick: Number(word(160, 24, true)), liquidity: word(192, 128),
    bitmapWords: Number(word(224, 8)), initializedTicksCrossed: Number(word(256, 8)), steps: Number(word(288, 16)) };
}
