/** Local-test bridge only: real exported staticcall replies/runtime/storage,
 * synthetic RPC/block hash. Never connects to a provider or sends a transaction. */
import { decodeAbiParameters, encodeAbiParameters, decodeFunctionData, type Hash, type Hex } from 'viem'
import { captureEpochExecution, epochReads, EPOCH_TARGETS, type EpochSource } from '../src/protocol/epochSnapshot.ts'
import { captureEpochBatch, storedBatchReads, ORDER_COMPONENTS, type BatchRpc } from '../src/protocol/epochBatch.ts'
import type { Order } from '../src/protocol/orders.ts'
import { POOL_KEY_COMPONENTS, EXTSLOAD_ABI, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'
const fingerprint = [{ name: 'address', type: 'address' }, { name: 'runtimeHash', type: 'bytes32' }] as const
const sourceComponents = [{ name: 'chainId', type: 'uint256' }, { name: 'configVersion', type: 'uint256' },
  { name: 'rewardPolicyHash', type: 'bytes32' }, { name: 'key', type: 'tuple', components: POOL_KEY_COMPONENTS },
  { name: 'contracts', type: 'tuple', components: EPOCH_TARGETS.map(name => ({ name, type: 'tuple', components: fingerprint })) }] as const
const readComponents = [{ name: 'id', type: 'string' }, { name: 'target', type: 'address' }, { name: 'data', type: 'bytes' }] as const
const planAbi = [{ type: 'tuple', components: sourceComponents }, { type: 'uint256' }] as const
const batchPlanAbi = [...planAbi, { type: 'tuple[]', components: ORDER_COMPONENTS }] as const
const replyComponents = [...readComponents, { name: 'ok', type: 'bool' }, { name: 'result', type: 'bytes' }] as const
const fixtureAbi = [{ type: 'tuple', components: [
  { name: 'source', type: 'tuple', components: sourceComponents }, { name: 'epoch', type: 'uint256' }, { name: 'caller', type: 'address' },
  { name: 'blockNumber', type: 'uint256' }, { name: 'blockHash', type: 'bytes32' }, { name: 'timestamp', type: 'uint256' },
  { name: 'codes', type: 'bytes[]' }, { name: 'replies', type: 'tuple[]', components: replyComponents },
  { name: 'slots', type: 'bytes32[]' }, { name: 'values', type: 'bytes32[]' },
  { name: 'cap', type: 'uint256' }, { name: 'downLimit', type: 'uint160' }, { name: 'upLimit', type: 'uint160' },
  { name: 'nativeBalance', type: 'uint256' },
] }] as const
const outputAbi = [
  ...Array.from({ length: 4 }, () => ({ type: 'bytes32' })),
  ...Array.from({ length: 4 }, () => ({ type: 'uint256' })),
  { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' },
] as const
try {
  const mode = process.argv[2], payload = process.argv[3]
  if (process.argv.length !== 4 || !['--reads', '--capture', '--batch-reads', '--batch'].includes(mode) || !payload || payload.length > 500000 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) throw new Error('Expected one bounded epoch fixture and mode.')
  if (mode === '--reads') {
    const [source, epoch] = decodeAbiParameters(planAbi, payload as Hex)
    if (encodeAbiParameters(planAbi, [source, epoch]).toLowerCase() !== payload.toLowerCase()) throw new Error('Noncanonical epoch read plan.')
    process.stdout.write(encodeAbiParameters([{ type: 'tuple[]', components: readComponents }], [epochReads(source as EpochSource, epoch as bigint)]))
  } else if (mode === '--batch-reads') {
    const [source, epoch, orders] = decodeAbiParameters(batchPlanAbi, payload as Hex)
    if (encodeAbiParameters(batchPlanAbi, [source, epoch, orders]).toLowerCase() !== payload.toLowerCase()) throw new Error('Noncanonical stored batch read plan.')
    process.stdout.write(encodeAbiParameters([{ type: 'tuple[]', components: readComponents }], [storedBatchReads(source as EpochSource, epoch as bigint, orders as Order[])]))
  } else {
    const [f] = decodeAbiParameters(fixtureAbi, payload as Hex)
    if (encodeAbiParameters(fixtureAbi, [f]).toLowerCase() !== payload.toLowerCase() || f.codes.length !== 5
      || (mode === '--capture' ? f.replies.length !== 36 : f.replies.length < 36 || f.replies.length > 110)
      || f.slots.length !== f.values.length || f.slots.length > 36) throw new Error('Noncanonical epoch capture fixture.')
    const s = f.source as EpochSource, storage = new Map<Hash, Hash>(), replies = new Map<string, typeof f.replies[number]>()
    f.slots.forEach((slot, i) => { if (storage.has(slot)) throw new Error('Duplicate epoch core slot.'); storage.set(slot, f.values[i]) })
    for (const r of f.replies) { const key = `${r.target.toLowerCase()}/${r.data.toLowerCase()}`; if (replies.has(key)) throw new Error('Duplicate epoch reply.'); replies.set(key, r) }
    const rpc: BatchRpc = async (method, params) => {
      if (method === 'eth_chainId') return `0x${s.chainId.toString(16)}`
      if (method === 'eth_getBlockByNumber') {
        if (params[0] !== `0x${f.blockNumber.toString(16)}` || params[1] !== false) throw new Error('Unpinned epoch block query.')
        return { number: params[0], hash: f.blockHash, timestamp: `0x${f.timestamp.toString(16)}` }
      }
      const selector = params[1] as { blockHash: Hash; requireCanonical: boolean }
      if (selector.blockHash !== f.blockHash || selector.requireCanonical !== true) throw new Error('Unpinned epoch state query.')
      if (method === 'eth_getBalance') {
        if (String(params[0]).toLowerCase() !== s.contracts.book.address.toLowerCase()) throw new Error('Wrong native balance target.')
        return `0x${f.nativeBalance.toString(16)}`
      }
      if (method === 'eth_getCode') {
        const i = EPOCH_TARGETS.findIndex(t => s.contracts[t].address.toLowerCase() === String(params[0]).toLowerCase())
        if (i < 0) throw new Error('Wrong epoch code target.')
        return f.codes[i]
      }
      const c = params[0] as { to: string; data: Hex }
      if (c.to.toLowerCase() === s.contracts.manager.address.toLowerCase()) {
        const slot = decodeFunctionData({ abi: EXTSLOAD_ABI, data: c.data }).args[0], value = storage.get(slot)
        if (value === undefined) throw new Error('Required epoch core slot was not exported.')
        return value
      }
      const r = replies.get(`${c.to.toLowerCase()}/${c.data.toLowerCase()}`)
      if (!r || !r.ok) throw new Error('Epoch staticcall reverted or was not exported.')
      return r.result
    }
    const request = { epoch: f.epoch as bigint, caller: f.caller, blockNumber: f.blockNumber as bigint,
      domains: [{ down: true, maxInput: f.cap as bigint, limit: f.downLimit }, { down: false, maxInput: f.cap as bigint, limit: f.upLimit }] }
    const result = mode === '--batch' ? await captureEpochBatch(rpc, s, request) : await captureEpochExecution(rpc, s, request)
    const b = result.binding, e = result.eligibility
    const values = [b.positionsHash, b.weightsHash, b.snapshotHash, b.curvesHash,
      BigInt(b.pointCount), e.blockTimestamp, BigInt(e.count), result.record.executeUntil, e.batchDigest, e.solver, e.exclusiveUntil]
    if ('batchBinding' in result) {
      const extraAbi = [{ type: 'bytes32' }, ...Array.from({ length: 8 }, () => ({ type: 'uint256' }))] as const
      const x = result.batchBinding, [l0, l1] = result.liabilities
      process.stdout.write(encodeAbiParameters([...outputAbi, ...extraAbi], [...values, x.ordersHash, x.budget0, x.budget1,
        l0.balance, l1.balance, l0.escrow, l1.escrow, l0.claimable, l1.claimable]))
    } else process.stdout.write(encodeAbiParameters(outputAbi, values))
  }
} catch (e) { console.error(`Epoch capture bridge failed: ${e instanceof Error ? e.message : String(e)}`); process.exitCode = 1 }
