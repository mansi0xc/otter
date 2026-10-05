/** Local Forge test bridge. The RPC is an in-memory table of real core storage;
 * block metadata is synthetic. No HTTP, wallet or sending capability exists.
 */
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, keccak256, type Hash } from 'viem'
import { captureExecution, EXTSLOAD_ABI, POOL_KEY_COMPONENTS, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'

const fixtureAbi = [{ type: 'tuple', components: [
  { name: 'chainId', type: 'uint256' }, { name: 'blockNumber', type: 'uint256' }, { name: 'blockHash', type: 'bytes32' },
  { name: 'manager', type: 'address' }, { name: 'code', type: 'bytes' }, { name: 'key', type: 'tuple', components: POOL_KEY_COMPONENTS },
  { name: 'down', type: 'bool' }, { name: 'amount', type: 'uint256' }, { name: 'limit', type: 'uint160' },
  { name: 'slots', type: 'bytes32[]' }, { name: 'values', type: 'bytes32[]' },
] }] as const
const quoteAbi = [{ type: 'tuple', components: [
  { name: 'status', type: 'uint8' }, { name: 'requestedInput', type: 'uint256' }, { name: 'consumedInput', type: 'uint256' },
  { name: 'output', type: 'uint256' }, { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
  { name: 'liquidity', type: 'uint128' }, { name: 'bitmapWords', type: 'uint8' }, { name: 'initializedTicksCrossed', type: 'uint8' }, { name: 'steps', type: 'uint16' },
] }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] as const
try {
  const payload = process.argv[2]
  if (process.argv.length !== 3 || !payload || payload.length > 250000 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) throw new Error('Expected one bounded ABI fixture.')
  const [f] = decodeAbiParameters(fixtureAbi, payload as Hash)
  if (encodeAbiParameters(fixtureAbi, [f]).toLowerCase() !== payload.toLowerCase() || f.slots.length !== f.values.length || f.slots.length > 4114) throw new Error('Noncanonical fixture arrays.')
  const storage = new Map<Hash, Hash>()
  f.slots.forEach((slot, i) => { if (storage.has(slot)) throw new Error('Duplicate storage fixture slot.'); storage.set(slot, f.values[i]) })
  const rpc: SnapshotRpc = async (method, params) => {
    if (method === 'eth_chainId') return `0x${f.chainId.toString(16)}`
    if (method === 'eth_getBlockByNumber') {
      if (params[0] !== `0x${f.blockNumber.toString(16)}` || params[1] !== false) throw new Error('Unpinned fixture block query.')
      return { number: params[0], hash: f.blockHash }
    }
    const selector = params[1] as { blockHash: Hash; requireCanonical: boolean }
    if (selector.blockHash !== f.blockHash || selector.requireCanonical !== true || Object.keys(selector).length !== 2) throw new Error('Unpinned fixture state query.')
    if (method === 'eth_getCode') { if (params[0] !== f.manager) throw new Error('Wrong fixture manager.'); return f.code }
    const call = params[0] as { to: string; data: Hash }
    if (call.to !== f.manager) throw new Error('Wrong fixture storage target.')
    const decoded = decodeFunctionData({ abi: EXTSLOAD_ABI, data: call.data }), value = storage.get(decoded.args[0])
    if (value === undefined) throw new Error('Required real-core storage was not exported.')
    return value
  }
  const result = await captureExecution(rpc, { chainId: f.chainId, manager: f.manager, runtimeHash: keccak256(f.code), key: f.key },
    { down: f.down, amount: f.amount, limit: f.limit, blockNumber: f.blockNumber })
  process.stdout.write(encodeAbiParameters(quoteAbi, [result.quote, BigInt(result.stateReads), BigInt(result.snapshot.bitmap.size), BigInt(result.snapshot.ticks.size)]))
} catch (e) {
  console.error(`Snapshot reader test bridge failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
}
