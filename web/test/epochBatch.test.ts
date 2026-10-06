import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, keccak256, zeroHash, zeroAddress, type Address, type Hash, type Hex } from 'viem'
import { captureEpochBatch, storedBatchCommitment, storedBatchReads, BATCH_ABI, STORED_ORDER_TYPEHASH, type BatchContext, type BatchRpc } from '../src/protocol/epochBatch.ts'
import { orderHash, type Order } from '../src/protocol/orders.ts'
import type { SnapshotRpc } from '../src/protocol/executionSnapshot.ts'
import { fixture as epochFixture } from './epoch-batch-fixture.ts'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex
function digest(orders: readonly Order[]) { return orders.reduce((h, o) => keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [h, orderHash(o)])), zeroHash) }
function fixture() {
  const f = epochFixture()
  const orders: Order[] = [0, 1].map(i => ({ trader: addr(100 + i), poolId: f.record.poolId, sellingCurrency0: i === 0,
    ask: 0n, budget: BigInt(10 - 3 * i), deadline: 1000n, nonce: BigInt(256 * i), configVersion: 1n, epoch: 0n, maxExecutionTime: 1960n }))
  const context = (): BatchContext => ({ chainId: f.source.chainId, book: f.record.book, poolId: f.record.poolId, epoch: 0n, configVersion: 1n,
    executeUntil: 1960n, count: orders.length, batchDigest: digest(orders) })
  const state = { escrow: [50n, 70n], claims: [5n, 6n], balances: [55n, 76n], raw: new Map<string, unknown>(),
    calls: [] as { method: string; params: readonly unknown[] }[], onRpc: () => {} }
  const reset = () => { f.values.set('book.batches', [1060n, orders.length, false]); f.values.set('book.batchDigest', digest(orders)) }
  reset()
  const rpc: BatchRpc = async (method, params) => {
    state.onRpc()
    if (method === 'eth_getBalance') {
      state.calls.push({ method, params }); assert.equal(params[0], f.record.book)
      assert.deepEqual(params[1], { blockHash: f.state.hash, requireCanonical: true })
      return state.raw.get('native') ?? `0x${state.balances[0].toString(16)}`
    }
    if (method !== 'eth_call') return f.rpc(method, params)
    const call = params[0] as { to: Address; data: Hex }
    let decoded
    try { decoded = decodeFunctionData({ abi: BATCH_ABI, data: call.data }) } catch { return f.rpc(method, params) }
    state.calls.push({ method, params }); assert.deepEqual(params[1], { blockHash: f.state.hash, requireCanonical: true })
    const name = decoded.functionName, args = decoded.args ?? []; let result: unknown, key = name
    if (name !== 'balanceOf') assert.equal(call.to, f.record.book)
    if (name === 'getOrders') result = orders
    else if (name === 'DOMAIN_SEPARATOR') result = storedBatchCommitment(context(), orders).domainSeparator
    else if (name === 'ORDER_TYPEHASH') result = STORED_ORDER_TYPEHASH
    else if (name === 'orderRecovered') { key = `recovered/${args[2]}`; result = false }
    else if (name === 'nonceBitmap') {
      key = `nonce/${String(args[0]).toLowerCase()}/${args[1]}`
      result = orders.filter(o => o.trader.toLowerCase() === String(args[0]).toLowerCase() && o.nonce >> 8n === args[1]).reduce((b, o) => b | 1n << (o.nonce & 255n), 0n)
    } else if (name === 'totalEscrow' || name === 'totalClaimable') {
      const i = args[0] === f.source.key.currency0 ? 0 : 1; key = `${name}/${i}`; result = name === 'totalEscrow' ? state.escrow[i] : state.claims[i]
    } else if (name === 'balanceOf') { assert.equal(call.to, f.source.key.currency1); key = 'balance/1'; result = state.balances[1] }
    else if (name === 'replay') { assert.deepEqual(args[2], orders); result = undefined }
    else throw new Error('Unexpected stored batch view')
    if (state.raw.has(key)) { const raw = state.raw.get(key); if (raw instanceof Error) throw raw; return raw }
    return encodeFunctionResult({ abi: BATCH_ABI, functionName: name, result: result as never })
  }
  return { ...f, orders, context, batchState: state, batchRpc: rpc, reset }
}
test('complete batch commitment binds order sequence, budgets and wide signing-domain identity without input mutation', () => {
  const f = fixture(), before = structuredClone(f.orders), result = storedBatchCommitment(f.context(), f.orders)
  assert.equal(result.batchDigest, digest(f.orders)); assert.equal(result.budget0, 10n); assert.equal(result.budget1, 7n)
  assert.deepEqual(f.orders, before); assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.orders)); assert.ok(result.orders.every(Object.isFrozen))
  const wide = storedBatchCommitment({ ...f.context(), chainId: 1n << 200n }, f.orders)
  assert.notEqual(wide.domainSeparator, result.domainSeparator)
  assert.equal(wide.ordersHash, result.ordersHash)
  const extra = { ...f.orders[0], extra: { mutable: [] } }
  assert.ok(!Object.hasOwn(storedBatchCommitment(f.context(), [extra, f.orders[1]]).orders[0], 'extra'))
})
test('missing, reordered, duplicated and altered orders cannot inherit the stored digest', () => {
  const f = fixture()
  for (const orders of [[], f.orders.slice(1), [...f.orders].reverse(), [f.orders[0], f.orders[0]],
    [{ ...f.orders[0], ask: 1n }, f.orders[1]], [{ ...f.orders[0], trader: addr(99) }, f.orders[1]]]) assert.throws(() => storedBatchCommitment(f.context(), orders), /mismatch/)
})
test('rehashing cannot bypass identity, numeric, positive-budget, nonce or execution-validity constraints', () => {
  for (const change of [{ poolId: hash(99) }, { epoch: 1n }, { configVersion: 2n }, { trader: zeroAddress },
    { budget: 0n }, { budget: 1n << 96n }, { ask: 1n << 128n }, { deadline: 1n << 64n }, { nonce: 1n << 256n },
    { maxExecutionTime: 1959n }, { maxExecutionTime: 1n << 64n }, { sellingCurrency0: 1 as unknown as boolean }]) {
    const f = fixture(), orders = [{ ...f.orders[0], ...change }, f.orders[1]]
    assert.throws(() => storedBatchCommitment({ ...f.context(), batchDigest: digest(orders) }, orders))
  }
  const f = fixture(), duplicates = [f.orders[0], { ...f.orders[1], trader: f.orders[0].trader, nonce: f.orders[0].nonce }]
  assert.throws(() => storedBatchCommitment({ ...f.context(), batchDigest: digest(duplicates) }, duplicates), /nonce/)
  const tooMuch = f.orders.map(o => ({ ...o, sellingCurrency0: true, budget: (1n << 96n) - 1n }))
  assert.throws(() => storedBatchCommitment({ ...f.context(), batchDigest: digest(tooMuch) }, tooMuch), /aggregate/)
})
test('admission deadlines may have expired; max fields and same nonce across different traders remain valid', () => {
  const f = fixture(), orders = f.orders.map(o => ({ ...o, budget: (1n << 96n) - 1n, ask: (1n << 128n) - 1n,
    nonce: (1n << 256n) - 1n, maxExecutionTime: (1n << 64n) - 1n }))
  const result = storedBatchCommitment({ ...f.context(), batchDigest: digest(orders) }, orders)
  assert.equal(result.budget0, (1n << 96n) - 1n); assert.equal(result.orders[0].deadline, 1000n)
})
test('full collector verifies native/ERC20 shared ledgers and returns detached immutable orders and metadata', async () => {
  const f = fixture(), result = await captureEpochBatch(f.batchRpc, f.source, f.request)
  assert.equal(result.orders.length, 2); assert.equal(result.batchBinding.ordersHash, storedBatchCommitment(f.context(), f.orders).ordersHash)
  assert.equal(result.batchBinding.budget0, 10n); assert.equal(result.batchBinding.budget1, 7n)
  assert.deepEqual(result.liabilities.map(l => [l.requiredForBatch, l.escrow, l.claimable, l.balance]), [[10n, 50n, 5n, 55n], [7n, 70n, 6n, 76n]])
  assert.equal(result.binding.pointCount, 18); assert.ok(Object.isFrozen(result.batchBinding)); assert.ok(result.orders.every(Object.isFrozen))
  assert.equal(f.state.blockReads, 5); assert.equal(f.state.chainReads, 5)
  const methods = new Set([...f.state.calls, ...f.batchState.calls].map(c => c.method))
  assert.deepEqual(methods, new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance']))
  const saved = structuredClone(result.orders); f.orders[0].budget = 999n; assert.deepEqual(result.orders, saved)
})
test('32 same-trader nonce checks deduplicate words without confusing order indices or another trader', async () => {
  const f = fixture(), template = f.orders[0]
  f.orders.splice(0, 2, ...Array.from({ length: 32 }, (_, i) => ({ ...template, budget: 1n, nonce: BigInt(i) }))); f.reset()
  const result = await captureEpochBatch(f.batchRpc, f.source, f.request)
  const calls = f.batchState.calls.filter(c => c.method === 'eth_call').map(c => decodeFunctionData({ abi: BATCH_ABI, data: (c.params[0] as { data: Hex }).data }))
  assert.equal(calls.filter(c => c.functionName === 'nonceBitmap').length, 1)
  assert.equal(calls.filter(c => c.functionName === 'orderRecovered').length, 32)
  assert.equal(result.batchBinding.budget0, 32n); assert.equal(result.orders.length, 32)
  const plan = storedBatchReads(f.source, 0n, f.orders)
  assert.equal(plan.length, 42) // 3 roots + 32 flags + 1 word + 4 ledgers + 1 ERC20 balance + replay.
  const unique = f.orders.map((o, i) => ({ ...o, nonce: BigInt(i * 256) }))
  assert.equal(storedBatchReads(f.source, 0n, unique).length, 73)
  assert.throws(() => storedBatchReads(f.source, 1n, f.orders), /identity/)
})
test('wrong signing domain/type, recovered orders, absent nonce bits and replay failures reject without fallback', async () => {
  const fail = [['DOMAIN_SEPARATOR', hash(99)], ['ORDER_TYPEHASH', hash(99)], ['recovered/0', word(1n)],
    [`nonce/${addr(100)}/0`, word(0n)], ['replay', new Error('book replay reverted')]] as const
  for (const [key, raw] of fail) {
    const f = fixture(); f.batchState.raw.set(key, raw)
    await assert.rejects(captureEpochBatch(f.batchRpc, f.source, f.request), /domain|recovered|replay/)
  }
})
test('batch coverage and full shared-currency solvency fail closed, including liability overflow', async () => {
  for (const kind of ['escrow0', 'escrow1', 'claims0', 'balance0', 'balance1', 'overflow'] as const) {
    const f = fixture()
    if (kind === 'escrow0') f.batchState.escrow[0] = 9n
    if (kind === 'escrow1') f.batchState.escrow[1] = 6n
    if (kind === 'claims0') f.batchState.claims[0]++
    if (kind === 'balance0') f.batchState.balances[0]--
    if (kind === 'balance1') f.batchState.balances[1]--
    if (kind === 'overflow') { f.batchState.escrow[0] = (1n << 256n) - 1n; f.batchState.claims[0] = 1n }
    await assert.rejects(captureEpochBatch(f.batchRpc, f.source, f.request), /coverage/)
  }
})
test('hostile/truncated/noncanonical stored-order arrays and scalar replies are rejected before unsafe decoding', async () => {
  const f = fixture(), valid = encodeFunctionResult({ abi: BATCH_ABI, functionName: 'getOrders', result: f.orders })
  for (const [key, raw] of [['getOrders', '0x' + '00'.repeat(10305)], ['getOrders', word(64n) + valid.slice(66)],
    ['getOrders', word(32n) + word((1n << 256n) - 1n).slice(2)], ['getOrders', valid.slice(0, -2)], ['getOrders', valid + '00'],
    ['recovered/0', word(2n)], ['balance/1', word(76n) + '00'], ['native', '0x00']] as const) {
    const x = fixture(); x.batchState.raw.set(key, raw); await assert.rejects(captureEpochBatch(x.batchRpc, x.source, x.request))
  }
})
test('missing native/balance/recovery RPC responses fail without substituting zeros or numbered state', async () => {
  for (const key of ['balance/1', 'recovered/0', `nonce/${addr(100)}/0`]) {
    const f = fixture(); f.batchState.raw.set(key, new Error('batch provider unavailable'))
    await assert.rejects(captureEpochBatch(f.batchRpc, f.source, f.request), /provider unavailable/)
  }
  const f = fixture(), original = f.batchRpc
  await assert.rejects(captureEpochBatch(async (m, p) => { if (m === 'eth_getBalance') throw new Error('hash selector unsupported'); return original(m, p) }, f.source, f.request), /selector unsupported/)
})
test('late block/hash/timestamp or chain movement after epoch collection invalidates the complete batch', async () => {
  for (const kind of ['number', 'hash', 'timestamp', 'chain'] as const) {
    const f = fixture(), original = f.batchRpc
    const changed: BatchRpc = async (m, p) => {
      const raw = await original(m, p)
      if (m === 'eth_getBlockByNumber' && f.state.blockReads === 5 && kind !== 'chain') return { ...(raw as object), [kind]: kind === 'hash' ? hash(99) : '0x1' }
      return m === 'eth_chainId' && f.state.chainReads === 5 && kind === 'chain' ? '0x1' : raw
    }
    await assert.rejects(captureEpochBatch(changed, f.source, f.request), /changed/)
  }
})
test('source and request controls are detached before the first await', async () => {
  const f = fixture(), source = structuredClone(f.source), request = structuredClone(f.request)
  f.state.onRpc = () => { source.chainId = 1n; source.contracts.book.address = addr(99); source.key.currency1 = addr(99); request.epoch = 1n; request.domains[0].maxInput = 64n }
  const result = await captureEpochBatch(f.batchRpc, source, request)
  assert.equal(result.batchBinding.chainId, 31337n); assert.equal(result.binding.pointCount, 18)
})
test('stored-batch ABI types match current primary contract artifacts', () => {
  const artifacts = ['OtterOrderBook', 'MockERC20'].flatMap(n => JSON.parse(readFileSync(new URL(`../../contracts/out/${n}.sol/${n}.json`, import.meta.url), 'utf8')).abi)
  const shape = (p: any): any => ({ type: p.type, ...(p.components ? { components: p.components.map(shape) } : {}) })
  for (const fn of BATCH_ABI) assert.ok(artifacts.some(a => a.type === 'function' && a.name === fn.name && a.stateMutability === 'view'
    && JSON.stringify(a.inputs.map(shape)) === JSON.stringify(fn.inputs.map(shape)) && JSON.stringify(a.outputs.map(shape)) === JSON.stringify(fn.outputs.map(shape))), fn.name)
})
