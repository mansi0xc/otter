/** Content/curve binding for the admitted full-range model.
 * The caller must authenticate the anchor's book/runtime and same-block reads.
 * This pure helper makes NO RPC, ownership-proof, finality or execution-validity
 * claim. A self-invented anchor can be forged along with its record.
 */
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hash } from 'viem'
import { address, bytes32 } from './deployment.ts'
import { CORE_LAYOUT, MAX_CURVE_INPUT, POOL_KEY_COMPONENTS, executionPoolId,
  type ExecutionPoolKey, type CapturedExecutionCurves } from './executionSnapshot.ts'
import { MIN_TICK, MAX_TICK, MIN_PRICE, MAX_PRICE_EXCLUSIVE, MAX_LIQUIDITY, bitmapPosition,
  quoteExactInput, sqrtPriceAtTick, tickAtSqrtPrice, type Quote } from '../../../solver/src/execution.ts'
import { capitalWeight } from '../../../solver/src/rewards.ts'

export const OPENING_TYPEHASH = keccak256(stringToHex('OtterOpeningSnapshot/v2'))
export const POSITION_COMPONENTS = [{ name: 'id', type: 'uint256' }, { name: 'owner', type: 'address' },
  { name: 'tickLower', type: 'int24' }, { name: 'tickUpper', type: 'int24' }, { name: 'liquidity', type: 'uint128' }] as const
export const OPENING_POOL_COMPONENTS = [{ name: 'key', type: 'tuple', components: POOL_KEY_COMPONENTS },
  { name: 'manager', type: 'address' }, { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
  { name: 'protocolFee', type: 'uint24' }, { name: 'lpFee', type: 'uint24' }, { name: 'activeLiquidity', type: 'uint128' },
  { name: 'totalLiquidity', type: 'uint128' }, { name: 'ownershipVersion', type: 'uint256' }, { name: 'positionsHash', type: 'bytes32' }] as const
export const OPENING_RECORD_COMPONENTS = [{ name: 'chainId', type: 'uint256' }, { name: 'book', type: 'address' },
  { name: 'poolId', type: 'bytes32' }, { name: 'epoch', type: 'uint256' }, { name: 'configVersion', type: 'uint256' },
  { name: 'closesAt', type: 'uint64' }, { name: 'executeUntil', type: 'uint64' }, { name: 'openingBlock', type: 'uint256' },
  { name: 'guard', type: 'address' }, { name: 'pool', type: 'tuple', components: OPENING_POOL_COMPONENTS },
  { name: 'rewardPolicyHash', type: 'bytes32' }, { name: 'totalWeight', type: 'uint256' },
  { name: 'positions', type: 'tuple[]', components: POSITION_COMPONENTS }, { name: 'weights', type: 'uint256[]' }] as const
export const QUOTE_COMPONENTS = [{ name: 'status', type: 'uint8' }, { name: 'requestedInput', type: 'uint256' },
  { name: 'consumedInput', type: 'uint256' }, { name: 'output', type: 'uint256' }, { name: 'sqrtPriceX96', type: 'uint160' },
  { name: 'tick', type: 'int24' }, { name: 'liquidity', type: 'uint128' }, { name: 'bitmapWords', type: 'uint8' },
  { name: 'initializedTicksCrossed', type: 'uint8' }, { name: 'steps', type: 'uint16' }] as const
export const CURVE_COMPONENTS = [{ name: 'down', type: 'bool' }, { name: 'maxInput', type: 'uint256' },
  { name: 'limit', type: 'uint160' }, { name: 'points', type: 'tuple[]', components: QUOTE_COMPONENTS }] as const
export interface OpeningPosition { id: bigint; owner: Address; tickLower: number; tickUpper: number; liquidity: bigint }
export interface OpeningPool { key: ExecutionPoolKey; manager: Address; sqrtPriceX96: bigint; tick: number;
  protocolFee: number; lpFee: number; activeLiquidity: bigint; totalLiquidity: bigint; ownershipVersion: bigint; positionsHash: Hash }
export interface OpeningRecord { chainId: bigint; book: Address; poolId: Hash; epoch: bigint; configVersion: bigint;
  closesAt: bigint; executeUntil: bigint; openingBlock: bigint; guard: Address; pool: OpeningPool;
  rewardPolicyHash: Hash; totalWeight: bigint; positions: readonly OpeningPosition[]; weights: readonly bigint[] }
export interface OpeningAnchor { chainId: bigint; book: Address; guard: Address; poolId: Hash; epoch: bigint;
  configVersion: bigint; rewardPolicyHash: Hash; snapshotHash: Hash; blockNumber: bigint; blockHash: Hash }
export interface OpeningBinding extends OpeningAnchor { positionsHash: Hash; weightsHash: Hash; curvesHash: Hash; pointCount: number }

function u(n: bigint, bits = 256) {
  if (typeof n !== 'bigint' || n < 0n || n >= 1n << BigInt(bits)) throw new Error(`Opening quantity must fit uint${bits}.`)
}
function integer(n: number, lo: number, hi: number) {
  if (!Number.isSafeInteger(n) || n < lo || n > hi) throw new Error('Opening integer outside representation.')
}
function key(k: ExecutionPoolKey): ExecutionPoolKey {
  const result = { currency0: address(k.currency0, true), currency1: address(k.currency1), hooks: address(k.hooks), fee: k.fee, tickSpacing: k.tickSpacing }
  integer(k.fee, 0, (1 << 24) - 1); integer(k.tickSpacing, 1, 32767)
  if (BigInt(result.currency0) >= BigInt(result.currency1)) throw new Error('Opening currencies must be ordered.')
  return result
}
function record(input: OpeningRecord): OpeningRecord {
  if (!Array.isArray(input.positions) || input.positions.length < 1 || input.positions.length > 32
    || !Array.isArray(input.weights) || input.weights.length !== input.positions.length) throw new Error('Opening roster/weight length is outside the bounded domain.')
  for (const n of [input.chainId, input.epoch, input.configVersion, input.openingBlock, input.totalWeight, input.pool.ownershipVersion]) u(n)
  u(input.closesAt, 64); u(input.executeUntil, 64)
  if (input.chainId === 0n || input.configVersion === 0n || input.closesAt === 0n || input.executeUntil <= input.closesAt) throw new Error('Invalid opening domain/configuration/clocks.')
  const p = input.pool
  u(p.sqrtPriceX96, 160); u(p.activeLiquidity, 128); u(p.totalLiquidity, 128)
  integer(p.tick, MIN_TICK, MAX_TICK); integer(p.protocolFee, 0, (1 << 24) - 1); integer(p.lpFee, 0, (1 << 24) - 1)
  const positions = input.positions.map(p => {
    u(p.id); u(p.liquidity, 128); integer(p.tickLower, MIN_TICK, MAX_TICK); integer(p.tickUpper, MIN_TICK, MAX_TICK)
    return { ...p, owner: address(p.owner) }
  })
  const weights = input.weights.map(w => { u(w); return w })
  return { ...input, book: address(input.book), guard: address(input.guard), poolId: bytes32(input.poolId), rewardPolicyHash: bytes32(input.rewardPolicyHash),
    pool: { ...p, key: key(p.key), manager: address(p.manager), positionsHash: bytes32(p.positionsHash) }, positions, weights }
}

/** Exact book v2 ABI commitment. Representation validation is not economic or
 * ownership authentication; bindOpeningExecution applies the full-range checks. */
export function openingCommitment(input: OpeningRecord) {
  const r = record(input)
  const positionsHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: POSITION_COMPONENTS }], [r.positions]))
  const weightsHash = keccak256(encodeAbiParameters([{ type: 'uint256[]' }], [r.weights]))
  const snapshotHash = keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' },
    { type: 'uint64' }, { type: 'uint64' }, { type: 'uint256' }, { type: 'address' }, { type: 'tuple', components: OPENING_POOL_COMPONENTS },
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes32' },
  ], [OPENING_TYPEHASH, r.chainId, r.book, r.poolId, r.epoch, r.configVersion, r.closesAt, r.executeUntil, r.openingBlock,
    r.guard, r.pool, r.rewardPolicyHash, r.totalWeight, weightsHash]))
  return { positionsHash, weightsHash, snapshotHash }
}

export function bindOpeningExecution(anchor: OpeningAnchor, input: OpeningRecord, frame: CapturedExecutionCurves): Readonly<OpeningBinding> {
  const r = record(input), p = r.pool, hashes = openingCommitment(r)
  for (const n of [anchor.chainId, anchor.epoch, anchor.configVersion, anchor.blockNumber]) u(n)
  const a: OpeningAnchor = { chainId: anchor.chainId, epoch: anchor.epoch, configVersion: anchor.configVersion,
    blockNumber: anchor.blockNumber, book: address(anchor.book), guard: address(anchor.guard), poolId: bytes32(anchor.poolId),
    rewardPolicyHash: bytes32(anchor.rewardPolicyHash), snapshotHash: bytes32(anchor.snapshotHash), blockHash: bytes32(anchor.blockHash) }
  for (const field of ['chainId', 'book', 'guard', 'poolId', 'epoch', 'configVersion', 'rewardPolicyHash'] as const) {
    if (a[field] !== r[field]) throw new Error(`Opening anchor ${field} mismatch.`)
  }
  if (hashes.snapshotHash !== a.snapshotHash || hashes.positionsHash !== p.positionsHash) throw new Error('Opening commitment/roster mismatch.')
  if (frame.layout !== CORE_LAYOUT || frame.poolId !== r.poolId || executionPoolId(p.key) !== r.poolId
    || frame.source.chainId !== r.chainId || address(frame.source.manager) !== p.manager
    || encodeAbiParameters([{ type: 'tuple', components: POOL_KEY_COMPONENTS }], [key(frame.source.key)])
      !== encodeAbiParameters([{ type: 'tuple', components: POOL_KEY_COMPONENTS }], [p.key])) throw new Error('Opening execution source mismatch.')
  bytes32(frame.source.runtimeHash)
  if (frame.blockNumber !== a.blockNumber || frame.blockHash !== a.blockHash || r.openingBlock > a.blockNumber) throw new Error('Opening read-block mismatch.')
  if (p.key.fee !== 0 || p.protocolFee !== 0 || p.lpFee !== 0 || p.activeLiquidity !== p.totalLiquidity
    || p.totalLiquidity === 0n || p.totalLiquidity > MAX_LIQUIDITY || p.sqrtPriceX96 < MIN_PRICE || p.sqrtPriceX96 >= MAX_PRICE_EXCLUSIVE) throw new Error('Opening pool outside the admitted full-range execution domain.')
  const floor = tickAtSqrtPrice(p.sqrtPriceX96)
  if (p.tick !== floor && !(p.tick === floor - 1 && sqrtPriceAtTick(floor) === p.sqrtPriceX96)) throw new Error('Opening price/tick mismatch.')
  const lower = Math.trunc(MIN_TICK / p.key.tickSpacing) * p.key.tickSpacing, upper = Math.trunc(MAX_TICK / p.key.tickSpacing) * p.key.tickSpacing
  const ids = new Set<bigint>(); let total = 0n, totalWeight = 0n
  r.positions.forEach((position, i) => {
    if (position.id === 0n || ids.has(position.id) || position.liquidity === 0n || position.tickLower !== lower || position.tickUpper !== upper) throw new Error('Opening position outside the unique full-range roster.')
    ids.add(position.id); total += position.liquidity
    const w = capitalWeight(p.sqrtPriceX96, lower, upper, position.liquidity).weight
    if (r.weights[i] !== w) throw new Error('Opening capital weight mismatch.')
    totalWeight += w
  })
  if (total !== p.totalLiquidity || totalWeight !== r.totalWeight || totalWeight === 0n) throw new Error('Opening liquidity/weight total mismatch.')
  const s = frame.snapshot
  if (s.keyFee !== 0 || s.tickSpacing !== p.key.tickSpacing || s.sqrtPriceX96 !== p.sqrtPriceX96 || s.tick !== p.tick
    || s.liquidity !== p.activeLiquidity || s.protocolFee !== 0 || s.lpFee !== 0) throw new Error('Opening execution header mismatch.')
  if (!Array.isArray(frame.curves) || frame.curves.length < 1 || frame.curves.length > 2
    || new Set(frame.curves.map(c => c.domain.down)).size !== frame.curves.length
    || !(s.bitmap instanceof Map) || !(s.ticks instanceof Map)
    || s.bitmap.size > 16 * frame.curves.length || s.ticks.size > 64 * frame.curves.length
    || frame.stateReads !== 2 + s.bitmap.size + s.ticks.size) throw new Error('Opening curve/cache bounds mismatch.')
  const endpoints = [lower, upper].map(tick => ({ tick, ...bitmapPosition(tick / p.key.tickSpacing) }))
  for (const [word, bits] of s.bitmap) {
    integer(word, -32768, 32767); u(bits)
    const expected = endpoints.reduce((b, e) => e.word === word ? b | 1n << BigInt(e.bit) : b, 0n)
    if (bits !== expected) throw new Error('Opening bitmap contradicts the full-range roster.')
  }
  for (const [tick, t] of s.ticks) {
    if ((tick !== lower && tick !== upper) || t.gross !== total || t.net !== (tick === lower ? total : -total)) throw new Error('Opening tick contradicts the full-range roster.')
  }
  let pointCount = 0
  for (const c of frame.curves) {
    u(c.domain.maxInput)
    if (c.domain.maxInput > MAX_CURVE_INPUT || !Array.isArray(c.points) || c.points.length !== Number(c.domain.maxInput) + 1) throw new Error('Opening curve prefix mismatch.')
    for (let i = 0; i < c.points.length; i++) {
      const actual = c.points[i], expected = quoteExactInput(s, c.domain.down, BigInt(i), c.domain.limit)
      if (!actual || QUOTE_COMPONENTS.some(f => actual[f.name as keyof Quote] !== expected[f.name as keyof Quote])) throw new Error('Opening curve quote mismatch.')
    }
    pointCount += c.points.length
  }
  const curvesHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: CURVE_COMPONENTS }],
    [frame.curves.map(c => ({ ...c.domain, points: c.points }))]))
  // Only primitive metadata is returned. This binding cannot authorize a send,
  // certify a later-mutated frame or declare all points usable.
  return Object.freeze({ ...a, ...hashes, curvesHash, pointCount })
}
