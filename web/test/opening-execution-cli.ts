/** Test-only bridge: actual local book records/core storage, synthetic RPC and
 * block identity. It is NOT a production book reader or authenticated anchor. */
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, keccak256, type Hash } from 'viem'
import { bindOpeningExecution, OPENING_RECORD_COMPONENTS } from '../src/protocol/openingExecution.ts'
import { captureExecutionCurves, EXTSLOAD_ABI, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'

const fixtureAbi = [{ type: 'tuple', components: [
  { name: 'record', type: 'tuple', components: OPENING_RECORD_COMPONENTS }, { name: 'snapshotHash', type: 'bytes32' },
  { name: 'blockNumber', type: 'uint256' }, { name: 'blockHash', type: 'bytes32' }, { name: 'code', type: 'bytes' },
  { name: 'slots', type: 'bytes32[]' }, { name: 'values', type: 'bytes32[]' }, { name: 'cap', type: 'uint256' },
  { name: 'downLimit', type: 'uint160' }, { name: 'upLimit', type: 'uint160' },
] }] as const
const outputAbi = [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }] as const
try {
  const payload = process.argv[2]
  if (process.argv.length !== 3 || !payload || payload.length > 250000 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) throw new Error('Expected one bounded opening fixture.')
  const [f] = decodeAbiParameters(fixtureAbi, payload as Hash)
  if (encodeAbiParameters(fixtureAbi, [f]).toLowerCase() !== payload.toLowerCase() || f.slots.length !== f.values.length || f.slots.length > 36) throw new Error('Noncanonical opening fixture.')
  const storage = new Map<Hash, Hash>()
  f.slots.forEach((slot, i) => { if (storage.has(slot)) throw new Error('Duplicate opening storage slot.'); storage.set(slot, f.values[i]) })
  const rpc: SnapshotRpc = async (method, params) => {
    if (method === 'eth_chainId') return `0x${f.record.chainId.toString(16)}`
    if (method === 'eth_getBlockByNumber') {
      if (params[0] !== `0x${f.blockNumber.toString(16)}` || params[1] !== false) throw new Error('Unpinned opening block query.')
      return { number: params[0], hash: f.blockHash }
    }
    const selector = params[1] as { blockHash: Hash; requireCanonical: boolean }
    if (selector.blockHash !== f.blockHash || selector.requireCanonical !== true) throw new Error('Unpinned opening state query.')
    if (method === 'eth_getCode') { if (params[0] !== f.record.pool.manager) throw new Error('Wrong opening manager.'); return f.code }
    const call = params[0] as { to: string; data: Hash }
    if (call.to !== f.record.pool.manager) throw new Error('Wrong opening storage target.')
    const slot = decodeFunctionData({ abi: EXTSLOAD_ABI, data: call.data }).args[0], value = storage.get(slot)
    if (value === undefined) throw new Error('Required opening storage was not exported.')
    return value
  }
  const r = f.record
  const frame = await captureExecutionCurves(rpc, { chainId: r.chainId, manager: r.pool.manager, runtimeHash: keccak256(f.code), key: r.pool.key },
    { blockNumber: f.blockNumber, domains: [{ down: true, maxInput: f.cap, limit: f.downLimit }, { down: false, maxInput: f.cap, limit: f.upLimit }] })
  const binding = bindOpeningExecution({ chainId: r.chainId, book: r.book, guard: r.guard, poolId: r.poolId, epoch: r.epoch,
    configVersion: r.configVersion, rewardPolicyHash: r.rewardPolicyHash, snapshotHash: f.snapshotHash, blockNumber: f.blockNumber, blockHash: f.blockHash }, r, frame)
  process.stdout.write(encodeAbiParameters(outputAbi, [binding.positionsHash, binding.weightsHash, binding.snapshotHash, binding.curvesHash, BigInt(binding.pointCount)]))
} catch (e) {
  console.error(`Opening execution bridge failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
}
