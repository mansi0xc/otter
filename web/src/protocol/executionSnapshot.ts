import { encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hash, type Hex } from 'viem'
import { address, bytes32 } from './deployment.ts'
import { CORE_MIN_PRICE, CORE_MAX_PRICE, IncompleteSnapshot, MAX_WORDS, MAX_CROSSINGS, MIN_TICK, MAX_TICK,
  quoteExactInput, sqrtPriceAtTick, tickAtSqrtPrice, type PoolSnapshot, type Quote, type TickLiquidity } from '../../../solver/src/execution.ts'

export const CORE_LAYOUT = 'v4-core/e50237c43811bd9b526eff40f26772152a42daba' as const
export const MAX_STATE_READS = 2 + MAX_WORDS + MAX_CROSSINGS
// Exhaustive research prefixes, not a production trade-size or valuation rule.
export const MAX_CURVE_INPUT = 64n
export const MAX_CURVE_POINTS = 2 * (Number(MAX_CURVE_INPUT) + 1)
export const MAX_CURVE_STATE_READS = 2 + 2 * (MAX_WORDS + MAX_CROSSINGS)
export const EXTSLOAD_ABI = [{ type: 'function', name: 'extsload', stateMutability: 'view', inputs: [{ name: 'slot', type: 'bytes32' }], outputs: [{ name: 'value', type: 'bytes32' }] }] as const
export const POOL_KEY_COMPONENTS = [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] as const
export interface ExecutionPoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export interface ExecutionSource { chainId: bigint; manager: Address; runtimeHash: Hash; key: ExecutionPoolKey }
export interface ExecutionRequest { down: boolean; amount: bigint; limit: bigint; blockNumber?: bigint }
export type SnapshotRpc = (method: 'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call', params: readonly unknown[]) => Promise<unknown>
export interface CapturedExecution {
  layout: typeof CORE_LAYOUT; source: ExecutionSource; poolId: Hash
  blockNumber: bigint; blockHash: Hash; snapshot: PoolSnapshot; quote: Quote; stateReads: number
}
export interface ExecutionCurveDomain { down: boolean; maxInput: bigint; limit: bigint }
export interface ExecutionCurvesRequest { domains: readonly ExecutionCurveDomain[]; blockNumber?: bigint }
export interface ExecutionCurve { domain: ExecutionCurveDomain; points: readonly Quote[] }
export interface CapturedExecutionCurves extends Omit<CapturedExecution, 'quote'> { curves: readonly ExecutionCurve[] }
interface CapturedFrame extends Omit<CapturedExecution, 'quote'> { quotes: Quote[] }
const U256 = 1n << 256n, MASK128 = (1n << 128n) - 1n, MASK24 = (1n << 24n) - 1n
function unsigned(n: bigint, bits: number, name: string) {
  if (typeof n !== 'bigint' || n < 0n || n >= 1n << BigInt(bits)) throw new Error(`${name} must fit uint${bits}.`)
}
function hexWord(input: unknown): Hex {
  if (typeof input !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(input)) throw new Error('Storage call did not return one complete bytes32 word.')
  return input.toLowerCase() as Hex
}
function quantity(input: unknown): bigint {
  if (typeof input !== 'string' || input.length > 66 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(input)) throw new Error('Malformed RPC quantity.')
  return BigInt(input)
}
function block(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('RPC block is unavailable.')
  const b = input as Record<string, unknown>
  return { number: quantity(b.number), hash: bytes32(b.hash) }
}
function source(input: ExecutionSource): ExecutionSource {
  unsigned(input.chainId, 256, 'Chain ID')
  if (input.chainId === 0n) throw new Error('Chain ID must be positive.')
  const k = input.key
  const key = { currency0: address(k.currency0, true), currency1: address(k.currency1), hooks: address(k.hooks, true), fee: k.fee, tickSpacing: k.tickSpacing }
  if (BigInt(key.currency0) >= BigInt(key.currency1)) throw new Error('Pool currencies must be in increasing address order.')
  if (!Number.isInteger(key.fee) || key.fee < 0 || key.fee >= 1 << 24 || !Number.isInteger(key.tickSpacing)
    || key.tickSpacing < -(1 << 23) || key.tickSpacing >= 1 << 23) throw new Error('Pool key is outside ABI representation.')
  return { chainId: input.chainId, manager: address(input.manager), runtimeHash: bytes32(input.runtimeHash), key }
}
export function executionPoolId(key: ExecutionPoolKey): Hash {
  return keccak256(encodeAbiParameters([{ type: 'tuple', components: POOL_KEY_COMPONENTS }], [key]))
}
// Storage layout and signed-key extension match the pinned StateLibrary.
export function executionSlots(poolId: Hash) {
  const base = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [bytes32(poolId), 6n]))
  const offset = (n: bigint) => {
    const value = BigInt(base) + n
    if (value >= U256) throw new Error('Pool storage offset overflow.')
    return `0x${value.toString(16).padStart(64, '0')}` as Hash
  }
  const mapping = (index: number, bits: number, root: Hash) => {
    if (!Number.isInteger(index) || index < -(2 ** (bits - 1)) || index >= 2 ** (bits - 1)) throw new Error('Storage mapping index outside representation.')
    return keccak256(encodeAbiParameters([{ type: 'int256' }, { type: 'bytes32' }], [BigInt(index), root]))
  }
  return { slot0: base, liquidity: offset(3n), bitmap: (word: number) => mapping(word, 16, offset(5n)), tick: (tick: number) => mapping(tick, 24, offset(4n)) }
}

/** Read-only raw-core quote preparation, not an authenticated epoch or an auction.
 * Every code/storage query requires EIP-1898 blockHash + requireCanonical.
 * Unsupported providers fail explicitly; there is no block-number/latest fallback.
 * The configured runtime hash is a caller-provided trust anchor, not an audit.
 * Only the state needed by this request is captured, not a whole-pool export.
 */
export async function captureExecution(rpc: SnapshotRpc, input: ExecutionSource, request: ExecutionRequest): Promise<CapturedExecution> {
  const { quotes, ...frame } = await captureFrame(rpc, input, [{ down: request.down, amount: request.amount, limit: request.limit }], request.blockNumber, 1)
  return { ...frame, quote: quotes[0] }
}

/** Exhaust every raw input 0..maxInput in one or both declared directions.
 * Every point starts from the same opening state; these are alternative swaps,
 * never sequential execution. Partial/unsupported quotes stay in the table.
 * No interpolation, convexification, lot conversion or mechanism is selected.
 */
export async function captureExecutionCurves(rpc: SnapshotRpc, input: ExecutionSource, request: ExecutionCurvesRequest): Promise<CapturedExecutionCurves> {
  if (!Array.isArray(request.domains) || request.domains.length < 1 || request.domains.length > 2) throw new Error('Expected one or two bounded curve domains.')
  const domains = request.domains.map(d => ({ down: d.down, maxInput: d.maxInput, limit: d.limit }))
  if (new Set(domains.map(d => d.down)).size !== domains.length) throw new Error('Curve directions must be distinct.')
  const queries: Omit<ExecutionRequest, 'blockNumber'>[] = []
  for (const d of domains) {
    unsigned(d.maxInput, 256, 'Curve maximum input')
    if (d.maxInput > MAX_CURVE_INPUT) throw new Error('Curve maximum input exceeds the exhaustive research bound.')
    for (let amount = 0n; amount <= d.maxInput; amount++) queries.push({ down: d.down, amount, limit: d.limit })
  }
  const { quotes, ...frame } = await captureFrame(rpc, input, queries, request.blockNumber, domains.length)
  let cursor = 0
  const curves = domains.map(domain => {
    const points = quotes.slice(cursor, cursor + Number(domain.maxInput) + 1)
    cursor += points.length
    return { domain, points }
  })
  return { ...frame, curves }
}

async function captureFrame(rpc: SnapshotRpc, input: ExecutionSource, queries: readonly Omit<ExecutionRequest, 'blockNumber'>[], at: bigint | undefined,
  directions: number): Promise<CapturedFrame> {
  const s = source(input)
  if (at !== undefined) unsigned(at, 256, 'Block number')
  const bitmap = new Map<number, bigint>(), ticks = new Map<number, TickLiquidity>()
  const snapshot: PoolSnapshot = { keyFee: s.key.fee, tickSpacing: s.key.tickSpacing, sqrtPriceX96: 0n, tick: 0,
    liquidity: 0n, protocolFee: 0, lpFee: 0, bitmap, ticks }
  // Validate request representations before doing any RPC work.
  for (const q of queries) quoteExactInput(snapshot, q.down, q.amount, q.limit)
  if (quantity(await rpc('eth_chainId', [])) !== s.chainId) throw new Error('Snapshot RPC is on the wrong chain.')
  const anchor = block(await rpc('eth_getBlockByNumber', [at === undefined ? 'latest' : `0x${at.toString(16)}`, false]))
  if (at !== undefined && anchor.number !== at) throw new Error('RPC returned the wrong requested block number.')
  const selector = Object.freeze({ blockHash: anchor.hash, requireCanonical: true })
  const code = await rpc('eth_getCode', [s.manager, selector])
  if (typeof code !== 'string' || code.length > 131074 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)
    || keccak256(code as Hex) !== s.runtimeHash) throw new Error('Manager runtime does not match the configured fingerprint.')
  const poolId = executionPoolId(s.key), slots = executionSlots(poolId)
  let stateReads = 0
  const read = async (slot: Hash) => {
    if (++stateReads > 2 + directions * (MAX_WORDS + MAX_CROSSINGS)) throw new Error('Snapshot exceeds its bounded storage-read budget.')
    const data = encodeFunctionData({ abi: EXTSLOAD_ABI, functionName: 'extsload', args: [slot] })
    return BigInt(hexWord(await rpc('eth_call', [{ to: s.manager, data }, selector])))
  }
  if (s.key.tickSpacing >= 1 && s.key.tickSpacing <= 32767) {
    const [packed, liquidity] = await Promise.all([read(slots.slot0), read(slots.liquidity)])
    if (packed >> 232n !== 0n || liquidity >> 128n !== 0n) throw new Error('Noncanonical packed header/liquidity storage.')
    snapshot.sqrtPriceX96 = packed & ((1n << 160n) - 1n)
    const rawTick = Number(packed >> 160n & MASK24)
    snapshot.tick = rawTick >= 1 << 23 ? rawTick - (1 << 24) : rawTick
    snapshot.protocolFee = Number(packed >> 184n & MASK24); snapshot.lpFee = Number(packed >> 208n & MASK24)
    snapshot.liquidity = liquidity
    if (snapshot.sqrtPriceX96 !== 0n) {
      if (snapshot.sqrtPriceX96 < CORE_MIN_PRICE || snapshot.sqrtPriceX96 >= CORE_MAX_PRICE) throw new Error('Pool header price is outside the core domain.')
      const floor = tickAtSqrtPrice(snapshot.sqrtPriceX96)
      if (snapshot.tick !== floor && !(snapshot.tick === floor - 1 && sqrtPriceAtTick(floor) === snapshot.sqrtPriceX96)) {
        throw new Error('Stored tick is inconsistent with the core price/boundary state.')
      }
    } else if (liquidity !== 0n) throw new Error('Uninitialized pool has nonzero liquidity.')
  }
  const quotes: Quote[] = []
  for (const { down, amount, limit } of queries) {
    let quote: Quote | undefined
    // Each replay adds one missing record or finishes. Math and per-quote bounds are unchanged.
    for (let attempt = 0; attempt <= MAX_WORDS + MAX_CROSSINGS; attempt++) {
      try { quote = quoteExactInput(snapshot, down, amount, limit); break }
      catch (e) {
        if (!(e instanceof IncompleteSnapshot) || !Number.isInteger(e.position)) throw e
        const position = e.position!
        if (e.kind === 'bitmap' && bitmap.size < directions * MAX_WORDS && !bitmap.has(position)) {
          bitmap.set(position, await read(slots.bitmap(position)))
        } else if (e.kind === 'tick' && ticks.size < directions * MAX_CROSSINGS && !ticks.has(position)
          && position >= MIN_TICK && position <= MAX_TICK && position % s.key.tickSpacing === 0) {
          const packed = await read(slots.tick(position)), gross = packed & MASK128, unsignedNet = packed >> 128n
          const net = unsignedNet >= 1n << 127n ? unsignedNet - (1n << 128n) : unsignedNet
          if (gross === 0n || net < -gross || net > gross) throw new Error('Initialized tick has inconsistent gross/net liquidity.')
          ticks.set(position, { gross, net })
        } else throw new Error('Missing-state request is repeated or outside the supported capture bounds.')
      }
    }
    if (!quote) throw new Error('Bounded snapshot did not produce a quote.')
    quotes.push(quote)
  }
  const canonical = block(await rpc('eth_getBlockByNumber', [`0x${anchor.number.toString(16)}`, false]))
  if (canonical.number !== anchor.number || canonical.hash !== anchor.hash
    || quantity(await rpc('eth_chainId', [])) !== s.chainId) throw new Error('Snapshot block or chain changed during collection. No result retained.')
  return { layout: CORE_LAYOUT, source: s, poolId, blockNumber: anchor.number, blockHash: anchor.hash, snapshot, quotes, stateReads }
}
