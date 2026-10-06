import assert from 'node:assert/strict'
import { storedBatchCommitment } from '../src/protocol/epochBatch.ts'
import { orderHash, type Order } from '../src/protocol/orders.ts'
import { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, keccak256, zeroAddress, zeroHash, type Address, type Hash, type Hex } from 'viem'
import { captureEpochExecution, epochReads, EPOCH_ABI, EPOCH_TARGETS, type EpochSource, type EpochRequest } from '../src/protocol/epochSnapshot.ts'
import { openingCommitment, OPENING_TYPEHASH, type OpeningRecord } from '../src/protocol/openingExecution.ts'
import { executionPoolId, executionSlots, EXTSLOAD_ABI, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'
import { Q96, bitmapPosition, sqrtPriceAtTick } from '../../solver/src/execution.ts'
import { capitalWeight } from '../../solver/src/rewards.ts'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex
export function fixture() {
  const codes = new Map(EPOCH_TARGETS.map((_, i) => [addr(i + 1), `0x60${(i + 1).toString(16).padStart(2, '0')}` as Hex]))
  const source: EpochSource = { chainId: 31337n, configVersion: 1n, rewardPolicyHash: hash(20),
    key: { currency0: zeroAddress, currency1: addr(20), hooks: addr(3), fee: 0, tickSpacing: 60 },
    contracts: Object.fromEntries(EPOCH_TARGETS.map((t, i) => [t, { address: addr(i + 1), runtimeHash: keccak256(codes.get(addr(i + 1))!) }])) as EpochSource['contracts'] }
  const poolId = executionPoolId(source.key), slots = executionSlots(poolId)
  const positions = [1000n, 1n].map((liquidity, i) => ({ id: BigInt(i + 1), owner: addr(100 + i), tickLower: -887220, tickUpper: 887220, liquidity }))
  const weights = positions.map(p => capitalWeight(Q96, p.tickLower, p.tickUpper, p.liquidity).weight)
  const state = { number: 9007199254740993n, timestamp: 1060n, hash: hash(21), chain: source.chainId,
    calls: [] as { method: string; params: readonly unknown[] }[], blockReads: 0, chainReads: 0, onRpc: () => {} }
  const record: OpeningRecord = { chainId: source.chainId, book: addr(1), guard: addr(2), poolId, epoch: 0n, configVersion: 1n,
    closesAt: 1060n, executeUntil: 1960n, openingBlock: state.number - 1n, rewardPolicyHash: source.rewardPolicyHash,
    positions, weights, totalWeight: weights.reduce((a, b) => a + b),
    pool: { key: source.key, manager: addr(5), sqrtPriceX96: Q96, tick: 0, protocolFee: 0, lpFee: 0, activeLiquidity: 1001n, totalLiquidity: 1001n, ownershipVersion: 2n, positionsHash: hash(1) } }
  record.pool.positionsHash = openingCommitment(record).positionsHash
  const values = new Map<string, unknown>([
    ['book.SNAPSHOT_TYPEHASH', OPENING_TYPEHASH], ['book.settlement', addr(4)], ['book.registered', true],
    ['book.currency0Of', zeroAddress], ['book.currency1Of', addr(20)], ['book.configVersionOf', 1n], ['book.liquidityGuardOf', addr(2)],
    ['book.rewardPolicyHashOf', hash(20)], ['book.currentBatchId', 0n], ['book.executionInProgress', false],
    ['book.batches', [1060n, 1, false]], ['book.batchState', 2], ['book.executionDeadline', 1960n],
    ['book.escrowReleased', false], ['book.payoutsCredited', false], ['book.snapshotHash', openingCommitment(record).snapshotHash],
    ['book.openingBlock', record.openingBlock], ['book.openingSnapshot', record.pool], ['book.openingPositions', positions],
    ['book.openingRewardWeights', weights], ['book.openingRewardWeight', record.totalWeight], ['book.batchDigest', hash(22)],
    ['settlement.orderBook', addr(1)], ['settlement.poolManager', addr(5)], ['settlement.approvedHook', addr(3)],
    ['settlement.solver', addr(100)], ['settlement.exclusivityWindow', 300n],
    ['hook.poolManager', addr(5)], ['hook.settlement', addr(4)], ['hook.orderBook', addr(1)], ['hook.liquidityVault', addr(2)],
    ['guard.poolManager', addr(5)], ['guard.orderBook', addr(1)], ['guard.hook', addr(3)],
    ['book.assertSnapshot', undefined], ['guard.assertBatchSupported', undefined],
  ])
  const reads = epochReads(source, 0n), responses = new Map<string, unknown>()
  const storage = new Map<Hash, Hex>([[slots.slot0, word(Q96)], [slots.liquidity, word(1001n)]])
  for (let i = -16; i <= 16; i++) storage.set(slots.bitmap(i), word(0n))
  for (const tick of [-887220, 887220]) {
    const { word: w, bit } = bitmapPosition(tick / 60)
    storage.set(slots.bitmap(w), word(1n << BigInt(bit)))
    storage.set(slots.tick(tick), word(1001n | ((tick < 0 ? 1001n : -1001n) & ((1n << 128n) - 1n)) << 128n))
  }
  const rpc: SnapshotRpc = async (method, params) => {
    state.calls.push({ method, params }); state.onRpc()
    if (method === 'eth_chainId') { state.chainReads++; return `0x${state.chain.toString(16)}` }
    if (method === 'eth_getBlockByNumber') { state.blockReads++; return { number: `0x${state.number.toString(16)}`, hash: state.hash, timestamp: `0x${state.timestamp.toString(16)}` } }
    assert.deepEqual(params[1], { blockHash: state.hash, requireCanonical: true })
    if (method === 'eth_getCode') return codes.get(params[0] as Address)
    const call = params[0] as { to: Address; data: Hex }
    if (call.to === addr(5)) {
      const slot = decodeFunctionData({ abi: EXTSLOAD_ABI, data: call.data }).args[0]
      if (!storage.has(slot)) throw new Error('Missing epoch core word')
      return storage.get(slot)
    }
    const read = reads.find(r => r.target === call.to && r.data === call.data)
    if (!read) throw new Error('Unexpected epoch view call')
    if (responses.has(read.id)) return responses.get(read.id)
    return encodeFunctionResult({ abi: EPOCH_ABI, functionName: read.name, result: values.get(read.id) })
  }
  const request: EpochRequest = { epoch: 0n, caller: addr(100), domains: [
    { down: true, maxInput: 8n, limit: sqrtPriceAtTick(-1200) }, { down: false, maxInput: 8n, limit: sqrtPriceAtTick(1200) }] }
  return { source, record, state, values, responses, storage, codes, rpc, request, reads, slots }
}

const digest = (orders: readonly Order[]) => orders.reduce((h, o) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [h, orderHash(o)])), zeroHash)
export async function coverageFixture(options: { cap?: bigint; overrides?: Partial<Order>[]; downLimit?: bigint; oneDirection?: boolean } = {}) {
  const f = fixture(), overrides = options.overrides ?? [{ budget: 3n }, { budget: 2n, sellingCurrency0: false }, { budget: 2n, trader: addr(101) }]
  const orders: Order[] = overrides.map((o, i) => ({ trader: addr(100), poolId: f.record.poolId, sellingCurrency0: true,
    budget: 1n, ask: 0n, deadline: 1000n, nonce: BigInt(i), configVersion: 1n, epoch: 0n, maxExecutionTime: 1960n, ...o }))
  f.values.set('book.batches', [1060n, orders.length, false]); f.values.set('book.batchDigest', digest(orders))
  f.request.domains.forEach(d => { d.maxInput = options.cap ?? 8n })
  if (options.downLimit !== undefined) f.request.domains[0].limit = options.downLimit
  if (options.oneDirection) f.request.domains.splice(1)
  const captured = await captureEpochExecution(f.rpc, f.source, f.request)
  const batch = storedBatchCommitment({ ...captured.binding, count: orders.length, executeUntil: captured.record.executeUntil, batchDigest: digest(orders) }, orders)
  const { orders: _, ...hashes } = batch
  const anchor = { ...captured.binding, ...hashes, count: orders.length }
  const args = () => [anchor, captured.record, captured.frame, orders] as const
  return { ...captured, orders, anchor, args }
}
