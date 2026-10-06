/** Read-only, fingerprint-checked full-range epoch collection at one block hash.
 * Configured bytes and RPC are trust inputs, not consensus or an audit. No send,
 * canonical outcome check, complete budget domain or future-execution promise. */
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, keccak256,
  type Abi, type AbiParameter, type Address, type Hash, type Hex } from 'viem'
import { address, bytes32 } from './deployment.ts'
import { captureExecutionCurves, executionPoolId, MAX_CURVE_INPUT,
  type ExecutionPoolKey, type ExecutionCurveDomain, type SnapshotRpc, type CapturedExecutionCurves } from './executionSnapshot.ts'
import { bindOpeningExecution, OPENING_TYPEHASH, OPENING_POOL_COMPONENTS, POSITION_COMPONENTS,
  type OpeningRecord, type OpeningBinding, type OpeningPool, type OpeningPosition } from './openingExecution.ts'

export const EPOCH_TARGETS = ['book', 'guard', 'hook', 'settlement', 'manager'] as const
export type EpochTarget = typeof EPOCH_TARGETS[number]
export interface EpochSource {
  chainId: bigint; configVersion: bigint; rewardPolicyHash: Hash; key: ExecutionPoolKey
  contracts: Record<EpochTarget, { address: Address; runtimeHash: Hash }>
}
export interface EpochRequest { epoch: bigint; caller: Address; domains: readonly ExecutionCurveDomain[]; blockNumber?: bigint }
export interface CapturedEpoch {
  binding: Readonly<OpeningBinding>; record: OpeningRecord; frame: CapturedExecutionCurves
  eligibility: Readonly<{ blockTimestamp: bigint; count: number; batchDigest: Hash; caller: Address; solver: Address; exclusiveUntil: bigint }>
}
const id = [{ name: 'poolId', type: 'bytes32' }] as const
const pair = [...id, { name: 'epoch', type: 'uint256' }] as const
const out = (type: string) => [{ name: '', type }]
const view = (name: string, inputs: readonly AbiParameter[], outputs: readonly AbiParameter[]) =>
  ({ type: 'function', name, stateMutability: 'view', inputs, outputs } as const)
// Separate read-only ABI; wallet signing/sending ABI is unchanged.
export const EPOCH_ABI = [
  ...['settlement', 'orderBook', 'poolManager', 'approvedHook', 'liquidityVault', 'hook', 'solver'].map(n => view(n, [], out('address'))),
  view('exclusivityWindow', [], out('uint64')), view('SNAPSHOT_TYPEHASH', [], out('bytes32')),
  ...['registered', 'executionInProgress'].map(n => view(n, id, out('bool'))),
  ...['currency0Of', 'currency1Of', 'liquidityGuardOf'].map(n => view(n, id, out('address'))),
  ...['configVersionOf', 'currentBatchId'].map(n => view(n, id, out('uint256'))),
  view('rewardPolicyHashOf', id, out('bytes32')),
  view('batches', pair, [{ name: 'closesAt', type: 'uint64' }, { name: 'count', type: 'uint32' }, { name: 'terminal', type: 'bool' }]),
  view('batchState', pair, out('uint8')), view('executionDeadline', pair, out('uint64')),
  ...['escrowReleased', 'payoutsCredited'].map(n => view(n, pair, out('bool'))),
  ...['snapshotHash', 'batchDigest'].map(n => view(n, pair, out('bytes32'))),
  ...['openingBlock', 'openingRewardWeight'].map(n => view(n, pair, out('uint256'))),
  view('openingSnapshot', pair, [{ name: '', type: 'tuple', components: OPENING_POOL_COMPONENTS }]),
  view('openingPositions', pair, [{ name: '', type: 'tuple[]', components: POSITION_COMPONENTS }]),
  view('openingRewardWeights', pair, out('uint256[]')),
  view('assertSnapshot', pair, []), view('assertBatchSupported', id, []),
] as const satisfies Abi

function uint(n: bigint, bits = 256) {
  if (typeof n !== 'bigint' || n < 0n || n >= 1n << BigInt(bits)) throw new Error(`Epoch quantity must fit uint${bits}.`)
}
function quantity(n: unknown) {
  if (typeof n !== 'string' || n.length > 66 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(n)) throw new Error('Malformed epoch RPC quantity.')
  return BigInt(n)
}
function block(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw new Error('Epoch block is unavailable.')
  const b = raw as Record<string, unknown>
  return { number: quantity(b.number), hash: bytes32(b.hash), timestamp: quantity(b.timestamp) }
}
function source(input: EpochSource): EpochSource {
  uint(input.chainId); uint(input.configVersion)
  if (input.chainId === 0n || input.configVersion === 0n) throw new Error('Epoch chain/configuration must be positive.')
  const contracts = Object.fromEntries(EPOCH_TARGETS.map(t => [t, { address: address(input.contracts[t].address), runtimeHash: bytes32(input.contracts[t].runtimeHash) }])) as EpochSource['contracts']
  if (new Set(EPOCH_TARGETS.map(t => contracts[t].address)).size !== EPOCH_TARGETS.length) throw new Error('Epoch contract targets must be distinct.')
  const k = input.key, key = { currency0: address(k.currency0, true), currency1: address(k.currency1), hooks: address(k.hooks), fee: k.fee, tickSpacing: k.tickSpacing }
  if (BigInt(key.currency0) >= BigInt(key.currency1) || key.hooks !== contracts.hook.address || key.fee !== 0
    || !Number.isSafeInteger(key.tickSpacing) || key.tickSpacing < 1 || key.tickSpacing > 32767) throw new Error('Epoch pool key is outside the configured full-range model.')
  return { chainId: input.chainId, configVersion: input.configVersion, rewardPolicyHash: bytes32(input.rewardPolicyHash), key, contracts }
}
interface Read { id: string; target: Address; data: Hex; name: string }
/** Fixed read plan for local differential tests and RPC collection. */
export function epochReads(input: EpochSource, epoch: bigint): readonly Read[] {
  const s = source(input); uint(epoch); const poolId = executionPoolId(s.key)
  const reads: Read[] = []
  const add = (target: EpochTarget, name: string, args: readonly unknown[] = []) => reads.push({ id: `${target}.${name}`,
    target: s.contracts[target].address, name, data: encodeFunctionData({ abi: EPOCH_ABI, functionName: name, args }) })
  add('book', 'SNAPSHOT_TYPEHASH'); add('book', 'settlement')
  for (const n of ['registered', 'currency0Of', 'currency1Of', 'configVersionOf', 'liquidityGuardOf', 'rewardPolicyHashOf', 'currentBatchId', 'executionInProgress']) add('book', n, [poolId])
  for (const n of ['batches', 'batchState', 'executionDeadline', 'escrowReleased', 'payoutsCredited', 'snapshotHash', 'openingBlock', 'openingSnapshot', 'openingPositions', 'openingRewardWeights', 'openingRewardWeight', 'batchDigest']) add('book', n, [poolId, epoch])
  for (const n of ['orderBook', 'poolManager', 'approvedHook', 'solver', 'exclusivityWindow']) add('settlement', n)
  for (const n of ['poolManager', 'settlement', 'orderBook', 'liquidityVault']) add('hook', n)
  for (const n of ['poolManager', 'orderBook', 'hook']) add('guard', n)
  add('book', 'assertSnapshot', [poolId, epoch]); add('guard', 'assertBatchSupported', [poolId])
  return reads
}
export const MAX_EPOCH_VIEW_READS = 36
// Precheck bounded dynamic array shape before passing hostile data to the decoder.
function decode(read: Read, raw: unknown): unknown {
  if (typeof raw !== 'string' || raw.length > 12002 || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) throw new Error('Malformed/bounded epoch call result.')
  if (read.name === 'openingPositions' || read.name === 'openingRewardWeights') {
    if (raw.length < 130 || BigInt(`0x${raw.slice(2, 66)}`) !== 32n) throw new Error('Noncanonical epoch array offset.')
    const n = BigInt(`0x${raw.slice(66, 130)}`), width = read.name === 'openingPositions' ? 5n : 1n
    if (n < 1n || n > 32n || BigInt(raw.length) !== 2n + (2n + n * width) * 64n) throw new Error('Epoch array exceeds the roster bound.')
  }
  const result = decodeFunctionResult({ abi: EPOCH_ABI, functionName: read.name, data: raw as Hex })
  if (encodeFunctionResult({ abi: EPOCH_ABI, functionName: read.name, result }).toLowerCase() !== raw.toLowerCase()) throw new Error('Noncanonical epoch call result.')
  return result
}

export async function captureEpochExecution(rpc: SnapshotRpc, input: EpochSource, request: EpochRequest): Promise<CapturedEpoch> {
  // Copy and validate all caller controls before the first await.
  const s = source(input), epoch = request.epoch, caller = address(request.caller), at = request.blockNumber
  uint(epoch); if (at !== undefined) uint(at)
  if (!Array.isArray(request.domains) || request.domains.length < 1 || request.domains.length > 2) throw new Error('Expected bounded epoch curve domains.')
  const domains = request.domains.map(d => ({ down: d.down, maxInput: d.maxInput, limit: d.limit }))
  if (new Set(domains.map(d => d.down)).size !== domains.length) throw new Error('Epoch curve directions must be distinct.')
  for (const d of domains) { uint(d.maxInput); uint(d.limit, 160); if (typeof d.down !== 'boolean' || d.maxInput > MAX_CURVE_INPUT) throw new Error('Invalid epoch curve domain.') }
  if (quantity(await rpc('eth_chainId', [])) !== s.chainId) throw new Error('Epoch RPC is on the wrong chain.')
  const b = block(await rpc('eth_getBlockByNumber', [at === undefined ? 'latest' : `0x${at.toString(16)}`, false]))
  if (at !== undefined && b.number !== at) throw new Error('Wrong requested epoch block.')
  const selector = Object.freeze({ blockHash: b.hash, requireCanonical: true })
  await Promise.all(EPOCH_TARGETS.map(async t => {
    const code = await rpc('eth_getCode', [s.contracts[t].address, selector])
    if (typeof code !== 'string' || code.length > 131074 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)
      || keccak256(code as Hex) !== s.contracts[t].runtimeHash) throw new Error(`Epoch ${t} runtime fingerprint mismatch.`)
  }))
  const reads = epochReads(s, epoch)
  if (reads.length !== MAX_EPOCH_VIEW_READS) throw new Error('Epoch read-plan bound changed.')
  const values = new Map(await Promise.all(reads.map(async r => [r.id, decode(r, await rpc('eth_call', [{ to: r.target, data: r.data }, selector]))] as const)))
  const get = (t: EpochTarget, n: string) => values.get(`${t}.${n}`)
  const equal = (t: EpochTarget, n: string, expected: unknown) => {
    if (get(t, n) !== expected) throw new Error(`Epoch ${t}.${n} mismatch.`)
  }
  const addr = (t: EpochTarget) => s.contracts[t].address, poolId = executionPoolId(s.key)
  equal('book', 'SNAPSHOT_TYPEHASH', OPENING_TYPEHASH); equal('book', 'registered', true)
  equal('book', 'currency0Of', s.key.currency0); equal('book', 'currency1Of', s.key.currency1)
  equal('book', 'configVersionOf', s.configVersion); equal('book', 'liquidityGuardOf', addr('guard'))
  equal('book', 'rewardPolicyHashOf', s.rewardPolicyHash); equal('book', 'settlement', addr('settlement'))
  equal('settlement', 'orderBook', addr('book')); equal('settlement', 'poolManager', addr('manager')); equal('settlement', 'approvedHook', addr('hook'))
  equal('hook', 'poolManager', addr('manager')); equal('hook', 'settlement', addr('settlement')); equal('hook', 'orderBook', addr('book')); equal('hook', 'liquidityVault', addr('guard'))
  equal('guard', 'poolManager', addr('manager')); equal('guard', 'orderBook', addr('book')); equal('guard', 'hook', addr('hook'))
  equal('book', 'currentBatchId', epoch); equal('book', 'executionInProgress', false)
  equal('book', 'escrowReleased', false); equal('book', 'payoutsCredited', false)
  const [closesAt, count, terminal] = get('book', 'batches') as readonly [bigint, number, boolean]
  const executeUntil = get('book', 'executionDeadline') as bigint
  if (terminal || count < 1 || count > 32 || closesAt === 0n || executeUntil <= closesAt
    || b.timestamp < closesAt || b.timestamp >= executeUntil || get('book', 'batchState') !== 2) throw new Error('Epoch is outside the current closed execution window.')
  const solver = address(get('settlement', 'solver'), true), exclusiveUntil = closesAt + (get('settlement', 'exclusivityWindow') as bigint)
  if (exclusiveUntil >= executeUntil) throw new Error('Epoch exclusivity conflicts with its execution deadline.')
  if (caller !== solver && b.timestamp < exclusiveUntil) throw new Error('Epoch caller is inside the solver-only window.')
  const record: OpeningRecord = { chainId: s.chainId, book: addr('book'), guard: addr('guard'), poolId, epoch,
    configVersion: s.configVersion, rewardPolicyHash: s.rewardPolicyHash, closesAt, executeUntil,
    openingBlock: get('book', 'openingBlock') as bigint, pool: get('book', 'openingSnapshot') as OpeningPool,
    positions: get('book', 'openingPositions') as OpeningPosition[], weights: get('book', 'openingRewardWeights') as bigint[], totalWeight: get('book', 'openingRewardWeight') as bigint }
  const anchor = { chainId: s.chainId, book: addr('book'), guard: addr('guard'), poolId, epoch, configVersion: s.configVersion,
    rewardPolicyHash: s.rewardPolicyHash, snapshotHash: bytes32(get('book', 'snapshotHash')), blockNumber: b.number, blockHash: b.hash }
  // The inner reader may reselect the numbered block, but never read state at a
  // different hash. A change is rejected before any inner code/storage reads.
  const pinnedRpc: SnapshotRpc = async (method, params) => {
    if (method === 'eth_getBlockByNumber') {
      if (params[0] !== `0x${b.number.toString(16)}`) throw new Error('Unpinned inner epoch block query.')
      const raw = await rpc(method, params), next = block(raw)
      if (next.number !== b.number || next.hash !== b.hash || next.timestamp !== b.timestamp) throw new Error('Epoch block changed during collection.')
      return raw
    }
    if (method === 'eth_getCode' || method === 'eth_call') {
      const selected = params[1] as { blockHash: Hash; requireCanonical: boolean }
      if (selected.blockHash !== b.hash || selected.requireCanonical !== true) throw new Error('Unpinned inner epoch state query.')
    }
    return rpc(method, params)
  }
  const frame = await captureExecutionCurves(pinnedRpc, { chainId: s.chainId, manager: addr('manager'), runtimeHash: s.contracts.manager.runtimeHash, key: s.key }, { blockNumber: b.number, domains })
  const binding = bindOpeningExecution(anchor, record, frame)
  const last = block(await rpc('eth_getBlockByNumber', [`0x${b.number.toString(16)}`, false]))
  if (last.number !== b.number || last.hash !== b.hash || last.timestamp !== b.timestamp
    || quantity(await rpc('eth_chainId', [])) !== s.chainId) throw new Error('Epoch block or chain changed. No result retained.')
  return { binding, record, frame, eligibility: Object.freeze({ blockTimestamp: b.timestamp, count, batchDigest: bytes32(get('book', 'batchDigest')), caller, solver, exclusiveUntil }) }
}
