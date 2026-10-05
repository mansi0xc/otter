/** Local Forge test bridge. The RPC is an in-memory table of real core storage;
 * block metadata is synthetic. No HTTP, wallet or sending capability exists.
 */
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, keccak256, type Hash } from 'viem'
import { captureExecution, captureExecutionCurves, EXTSLOAD_ABI, POOL_KEY_COMPONENTS, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'

const fixtureAbi = [{ type: 'tuple', components: [
  { name: 'chainId', type: 'uint256' }, { name: 'blockNumber', type: 'uint256' }, { name: 'blockHash', type: 'bytes32' },
  { name: 'manager', type: 'address' }, { name: 'code', type: 'bytes' }, { name: 'key', type: 'tuple', components: POOL_KEY_COMPONENTS },
  { name: 'down', type: 'bool' }, { name: 'amount', type: 'uint256' }, { name: 'limit', type: 'uint160' },
  { name: 'slots', type: 'bytes32[]' }, { name: 'values', type: 'bytes32[]' },
] }] as const
const curveFixtureAbi = [fixtureAbi[0], { type: 'uint160' }] as const
const quoteAbi = [{ type: 'tuple', components: [
  { name: 'status', type: 'uint8' }, { name: 'requestedInput', type: 'uint256' }, { name: 'consumedInput', type: 'uint256' },
  { name: 'output', type: 'uint256' }, { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
  { name: 'liquidity', type: 'uint128' }, { name: 'bitmapWords', type: 'uint8' }, { name: 'initializedTicksCrossed', type: 'uint8' }, { name: 'steps', type: 'uint16' },
] }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] as const
const curveQuotesAbi = [{ ...quoteAbi[0], type: 'tuple[]' }, { ...quoteAbi[0], type: 'tuple[]' }, ...quoteAbi.slice(1)] as const
try {
  const payload = process.argv[2], curves = process.argv.length === 4 && process.argv[3] === '--curves'
  if ((!curves && process.argv.length !== 3) || !payload || payload.length > 250000 || !/^0x(?:[0-9a-fA-F]{2})+$/.test(payload)) throw new Error('Expected one bounded ABI fixture and optional --curves mode.')
  const [f, upLimit] = curves ? decodeAbiParameters(curveFixtureAbi, payload as Hash) : [...decodeAbiParameters(fixtureAbi, payload as Hash), 0n] as const
  const canonical = curves ? encodeAbiParameters(curveFixtureAbi, [f, upLimit]) : encodeAbiParameters(fixtureAbi, [f])
  if (canonical.toLowerCase() !== payload.toLowerCase() || f.slots.length !== f.values.length || f.slots.length > (curves ? 8226 : 4114)) throw new Error('Noncanonical fixture arrays.')
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
  const source = { chainId: f.chainId, manager: f.manager, runtimeHash: keccak256(f.code), key: f.key }
  if (curves) {
    if (!f.down) throw new Error('Curve fixture must put the downward limit first.')
    const result = await captureExecutionCurves(rpc, source, { blockNumber: f.blockNumber, domains: [
      { down: true, maxInput: f.amount, limit: f.limit }, { down: false, maxInput: f.amount, limit: upLimit },
    ] })
    process.stdout.write(encodeAbiParameters(curveQuotesAbi, [result.curves[0].points, result.curves[1].points,
      BigInt(result.stateReads), BigInt(result.snapshot.bitmap.size), BigInt(result.snapshot.ticks.size)]))
  } else {
    const result = await captureExecution(rpc, source, { down: f.down, amount: f.amount, limit: f.limit, blockNumber: f.blockNumber })
    process.stdout.write(encodeAbiParameters(quoteAbi, [result.quote, BigInt(result.stateReads), BigInt(result.snapshot.bitmap.size), BigInt(result.snapshot.ticks.size)]))
  }
} catch (e) {
  console.error(`Snapshot reader test bridge failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
}
