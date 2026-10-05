import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, keccak256, zeroAddress, type Address, type Hash } from 'viem'
import { captureExecution, captureExecutionCurves, executionPoolId, executionSlots, EXTSLOAD_ABI, MAX_STATE_READS,
  MAX_CURVE_INPUT, MAX_CURVE_POINTS, MAX_CURVE_STATE_READS, type ExecutionSource, type ExecutionRequest, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'
import { Q96, MIN_PRICE, MAX_INPUT, MAX_LIQUIDITY, Status, IncompleteSnapshot, bitmapPosition, quoteExactInput, sqrtPriceAtTick, tickAtSqrtPrice, type PoolSnapshot } from '../../solver/src/execution.ts'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}`
type Position = { lower: number; upper: number; liquidity: bigint }
function fixture(positions: Position[] = [{ lower: -120, upper: 120, liquidity: 1000n }], spacing = 60, price = Q96, storedTick = tickAtSqrtPrice(price)) {
  const source: ExecutionSource = { chainId: 31337n, manager: addr(1), runtimeHash: keccak256('0x6001'),
    key: { currency0: zeroAddress, currency1: addr(2), fee: 0, tickSpacing: spacing, hooks: zeroAddress } }
  const slots = executionSlots(executionPoolId(source.key)), bitmap = new Map<number, bigint>(), ticks = new Map<number, { gross: bigint; net: bigint }>()
  let liquidity = 0n
  for (const p of positions) {
    assert.ok(p.lower % spacing === 0); assert.ok(p.upper % spacing === 0)
    if (p.lower <= storedTick && storedTick < p.upper) liquidity += p.liquidity
    for (const [index, net] of [[p.lower, p.liquidity], [p.upper, -p.liquidity]] as const) {
      const previous = ticks.get(index) ?? { gross: 0n, net: 0n }
      ticks.set(index, { gross: previous.gross + p.liquidity, net: previous.net + net })
    }
  }
  // Explicitly populated empty words in both directions; no RPC zero fallback.
  const first = bitmapPosition(Math.floor(storedTick / spacing)).word
  for (let i = -16; i <= 16; i++) if (first + i >= -32768 && first + i <= 32767) bitmap.set(first + i, 0n)
  for (const index of ticks.keys()) {
    const { word: w, bit } = bitmapPosition(index / spacing)
    if (bitmap.has(w)) bitmap.set(w, bitmap.get(w)! | 1n << BigInt(bit))
  }
  const storage = new Map<Hash, bigint>()
  const packHeader = (protocol = 0n, lp = 0n) => price | (BigInt(storedTick) & ((1n << 24n) - 1n)) << 160n | protocol << 184n | lp << 208n
  storage.set(slots.slot0, packHeader()); storage.set(slots.liquidity, liquidity)
  bitmap.forEach((b, p) => storage.set(slots.bitmap(p), b))
  ticks.forEach((t, p) => storage.set(slots.tick(p), t.gross | (t.net & ((1n << 128n) - 1n)) << 128n))
  const state = { code: '0x6001', chain: '0x7a69', number: 9007199254740993n, blockHash: hash(40), blockReads: 0,
    reorg: false, changedChain: false, wrongNumber: false, missingBlock: false, missingWord: '', badWord: null as string | null,
    denySelector: false, failRpc: '', calls: [] as { method: string; params: readonly unknown[] }[], onRpc: () => {} }
  const rpc: SnapshotRpc = async (method, params) => {
    state.calls.push({ method, params }); state.onRpc()
    if (method === state.failRpc) throw new Error('RPC unavailable')
    switch (method) {
      case 'eth_chainId': return state.changedChain && state.calls.length > 1 ? '0x1' : state.chain
      case 'eth_getBlockByNumber':
        state.blockReads++
        return state.missingBlock ? null : { number: `0x${(state.number + (state.wrongNumber ? 1n : 0n)).toString(16)}`,
          hash: state.reorg && state.blockReads > 1 ? hash(41) : state.blockHash }
      case 'eth_getCode':
      case 'eth_call': {
        assert.deepEqual(params[1], { blockHash: state.blockHash, requireCanonical: true })
        if (state.denySelector) throw new Error('EIP-1898 unsupported')
        if (method === 'eth_getCode') return state.code
        const call = params[0] as { to: Address; data: Hash }
        assert.equal(call.to, source.manager)
        const decoded = decodeFunctionData({ abi: EXTSLOAD_ABI, data: call.data }), slot = decoded.args[0]
        if (slot === state.missingWord || !storage.has(slot)) throw new Error(`State unavailable at slot ${slot}`)
        return state.badWord ?? word(storage.get(slot)!)
      }
    }
  }
  const snapshot: PoolSnapshot = { keyFee: 0, tickSpacing: spacing, sqrtPriceX96: price, tick: storedTick, liquidity,
    protocolFee: 0, lpFee: 0, bitmap, ticks }
  return { source, storage, rpc, state, slots, snapshot, packHeader }
}
const request = (down = true, amount = MAX_INPUT, limit = sqrtPriceAtTick(down ? -600 : 600)): ExecutionRequest => ({ down, amount, limit })

test('captured raw-core quotes match the complete offline state in both directions through gaps and ranges', async () => {
  for (const down of [true, false]) {
    const f = fixture([{ lower: -120, upper: 120, liquidity: 1000n }, { lower: -480, upper: -360, liquidity: 700n }, { lower: 360, upper: 480, liquidity: 800n }])
    const r = request(down), result = await captureExecution(f.rpc, f.source, r)
    assert.deepEqual(result.quote, quoteExactInput(f.snapshot, r.down, r.amount, r.limit))
    assert.equal(result.quote.status, Status.PriceLimit); assert.ok(result.snapshot.ticks.size >= 3)
    assert.equal(result.blockNumber, 9007199254740993n); assert.equal(result.blockHash, f.state.blockHash)
    assert.equal(result.stateReads, 2 + result.snapshot.bitmap.size + result.snapshot.ticks.size)
    assert.ok(result.stateReads <= MAX_STATE_READS)
  }
})
test('state reads are demand-driven and never refetch a visited bitmap word or tick', async () => {
  const f = fixture(), result = await captureExecution(f.rpc, f.source, request(true, 1n, sqrtPriceAtTick(-60)))
  const reads = f.state.calls.filter(c => c.method === 'eth_call').map(c => decodeFunctionData({ abi: EXTSLOAD_ABI, data: (c.params[0] as { data: Hash }).data }).args[0])
  assert.equal(new Set(reads).size, reads.length)
  assert.equal(result.snapshot.ticks.size, 0); assert.equal(result.snapshot.bitmap.size, 2)
  assert.ok(!reads.includes(f.slots.tick(-120)))
  assert.deepEqual(result.quote, quoteExactInput(f.snapshot, true, 1n, sqrtPriceAtTick(-60)))
})
test('zero input requires no tick data and remains a model no-op rather than a public swap', async () => {
  const f = fixture(), result = await captureExecution(f.rpc, f.source, request(true, 0n, 0n))
  assert.equal(result.quote.status, Status.Complete); assert.equal(result.stateReads, 2)
  assert.equal(result.snapshot.bitmap.size, 0); assert.equal(result.snapshot.ticks.size, 0)
})
test('capture preserves a stored downward boundary tick instead of recomputing it from price', async () => {
  const price = sqrtPriceAtTick(-120)
  for (const down of [true, false]) {
    const f = fixture([{ lower: -120, upper: 120, liquidity: 1000n }], 60, price, -121), r = request(down)
    const result = await captureExecution(f.rpc, f.source, r)
    assert.equal(result.snapshot.tick, -121); assert.equal(result.snapshot.liquidity, 0n)
    assert.deepEqual(result.quote, quoteExactInput(f.snapshot, r.down, r.amount, r.limit))
  }
})
test('zero-amount downward crossing reads negative tick net exactly and activates a range', async () => {
  const f = fixture([{ lower: -120, upper: 0, liquidity: 10n ** 18n }]), r = request(true, 1n, sqrtPriceAtTick(-60))
  const result = await captureExecution(f.rpc, f.source, r)
  assert.equal(result.snapshot.liquidity, 0n); assert.equal(result.snapshot.ticks.get(0)?.net, -(10n ** 18n))
  assert.equal(result.quote.initializedTicksCrossed, 1); assert.equal(result.quote.liquidity, 10n ** 18n)
})
test('explicit empty words and zero-liquidity intervals are retained, not inferred from absent RPC data', async () => {
  const f = fixture([], 1), r = request(true, MAX_INPUT, sqrtPriceAtTick(-1200))
  const result = await captureExecution(f.rpc, f.source, r)
  assert.equal(result.quote.status, Status.PriceLimit); assert.equal(result.quote.consumedInput, 0n)
  assert.ok(result.snapshot.bitmap.size > 1); assert.ok([...result.snapshot.bitmap.values()].every(v => v === 0n))
})
test('missing bitmap or initialized-tick data aborts rather than silently assuming zero', async () => {
  for (const missing of ['word', 'tick'] as const) {
    const f = fixture([{ lower: -120, upper: 0, liquidity: 1000n }])
    f.state.missingWord = missing === 'word' ? f.slots.bitmap(0) : f.slots.tick(0)
    await assert.rejects(captureExecution(f.rpc, f.source, request()), /State unavailable/)
  }
})
test('unsupported EIP-1898, code or storage RPC errors never fall back to number or latest reads', async () => {
  for (const failure of ['selector', 'eth_getCode', 'eth_call'] as const) {
    const f = fixture()
    if (failure === 'selector') f.state.denySelector = true; else f.state.failRpc = failure
    await assert.rejects(captureExecution(f.rpc, f.source, request()), /unsupported|unavailable/)
    const queries = f.state.calls.filter(c => ['eth_getCode', 'eth_call'].includes(c.method))
    assert.ok(queries.every(c => (c.params[1] as { requireCanonical: boolean }).requireCanonical === true))
  }
})
test('wrong chain or manager runtime fails before any storage reads', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.state.chain = '0x1' },
    (f: ReturnType<typeof fixture>) => { f.state.code = '0x' },
    (f: ReturnType<typeof fixture>) => { f.state.code = '0x6002' },
    (f: ReturnType<typeof fixture>) => { f.state.code = '0x' + '11'.repeat(65537) }]) {
    const f = fixture(); mutate(f); await assert.rejects(captureExecution(f.rpc, f.source, request()), /chain|runtime/)
    assert.ok(!f.state.calls.some(c => c.method === 'eth_call'))
  }
})
test('block movement, wrong requested heights, disappearing blocks and changed chains abort capture', async () => {
  const f = fixture(); f.state.reorg = true; await assert.rejects(captureExecution(f.rpc, f.source, request()), /changed/)
  const wrong = fixture(); wrong.state.wrongNumber = true
  await assert.rejects(captureExecution(wrong.rpc, wrong.source, { ...request(), blockNumber: wrong.state.number }), /wrong requested/)
  const missing = fixture(); missing.state.missingBlock = true; await assert.rejects(captureExecution(missing.rpc, missing.source, request()), /unavailable/)
  const chain = fixture(); chain.state.changedChain = true; await assert.rejects(captureExecution(chain.rpc, chain.source, request()), /changed/)
})
test('requested historical block numbers are exact and every state request pins its returned hash', async () => {
  const f = fixture(), r = { ...request(), blockNumber: f.state.number }
  const result = await captureExecution(f.rpc, f.source, r)
  assert.equal(result.blockNumber, r.blockNumber)
  assert.deepEqual(f.state.calls.filter(c => c.method === 'eth_getBlockByNumber').map(c => c.params[0]), ['0x20000000000001', '0x20000000000001'])
})
test('malformed quantities and bytes32 returns cannot become partial or zero snapshots', async () => {
  for (const value of ['0x', '0x' + '0'.repeat(62), '0x' + '0'.repeat(66), 'bad', '0x' + 'g'.repeat(64)]) {
    const f = fixture(); f.state.badWord = value; await assert.rejects(captureExecution(f.rpc, f.source, request()), /complete bytes32/)
  }
  for (const value of ['0x', '0x00', '-1', '0x' + 'f'.repeat(65)]) {
    const f = fixture(); f.state.chain = value; await assert.rejects(captureExecution(f.rpc, f.source, request()), /quantity/)
  }
})
test('invalid key or query representations fail before contacting any RPC', async () => {
  const f = fixture()
  const sources = [{ ...f.source, chainId: 0n }, { ...f.source, manager: zeroAddress }, { ...f.source, runtimeHash: '0x0' as Hash },
    { ...f.source, key: { ...f.source.key, currency1: zeroAddress } }, { ...f.source, key: { ...f.source.key, currency0: addr(3) } },
    { ...f.source, key: { ...f.source.key, fee: 1 << 24 } }, { ...f.source, key: { ...f.source.key, tickSpacing: 0.5 } }]
  for (const s of sources) await assert.rejects(captureExecution(f.rpc, s, request()))
  for (const r of [{ ...request(), amount: -1n }, { ...request(), amount: 1n << 256n }, { ...request(), limit: 1n << 160n },
    { ...request(), down: 1 as unknown as boolean }, { ...request(), blockNumber: -1n }]) await assert.rejects(captureExecution(f.rpc, f.source, r))
  assert.equal(f.state.calls.length, 0)
})
test('inconsistent header, reserved bits, uninitialized liquidity and impossible tick net fail explicitly', async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => { f.storage.set(f.slots.slot0, Q96 | 1n << 160n) },
    (f: ReturnType<typeof fixture>) => { f.storage.set(f.slots.slot0, f.packHeader() | 1n << 232n) },
    (f: ReturnType<typeof fixture>) => { f.storage.set(f.slots.slot0, 0n) },
    (f: ReturnType<typeof fixture>) => { f.storage.set(f.slots.liquidity, 1n << 128n) },
    (f: ReturnType<typeof fixture>) => { f.storage.set(f.slots.tick(-120), 0n) },
    (f: ReturnType<typeof fixture>) => { f.storage.set(f.slots.tick(-120), 1n | 2n << 128n) }]) {
    const f = fixture(); mutate(f); await assert.rejects(captureExecution(f.rpc, f.source, request()), /inconsistent|Noncanonical|Uninitialized/)
  }
})
test('a caller changing its source/request while awaiting RPC cannot change the pinned query', async () => {
  const f = fixture(), r = request(true, 10n), originalSource = structuredClone(f.source)
  f.state.onRpc = () => { f.source.key.tickSpacing = 1; f.source.runtimeHash = hash(90); r.amount = 100n }
  const result = await captureExecution(f.rpc, f.source, r)
  assert.deepEqual(result.source, originalSource); assert.equal(result.quote.requestedInput, 10n)
})
test('unsupported fee/amount/price/liquidity requests retain the existing quote status with no traversal', async () => {
  for (const kind of ['keyFee', 'lpFee', 'protocolFee', 'amount', 'price', 'limit', 'liquidity', 'spacing', 'uninitialized'] as const) {
    const f = fixture(), r = request()
    let expected = Status.UnsupportedFees
    if (kind === 'keyFee') { f.source.key.fee = 0x800000; f.storage.set(executionSlots(executionPoolId(f.source.key)).slot0, f.packHeader()); f.storage.set(executionSlots(executionPoolId(f.source.key)).liquidity, f.snapshot.liquidity) }
    if (kind === 'lpFee') f.storage.set(f.slots.slot0, f.packHeader(0n, 1n))
    if (kind === 'protocolFee') f.storage.set(f.slots.slot0, f.packHeader(1n, 0n))
    if (kind === 'amount') { r.amount = MAX_INPUT + 1n; expected = Status.UnsupportedAmount }
    if (kind === 'price') { const p = MIN_PRICE - 1n; f.storage.set(f.slots.slot0, p | (BigInt(tickAtSqrtPrice(p)) & ((1n << 24n) - 1n)) << 160n); expected = Status.UnsupportedPrice }
    if (kind === 'limit') { r.limit = Q96; expected = Status.InvalidPriceLimit }
    if (kind === 'liquidity') { f.storage.set(f.slots.liquidity, MAX_LIQUIDITY + 1n); expected = Status.LiquidityLimit }
    if (kind === 'spacing') { f.source.key.tickSpacing = 0; expected = Status.UnsupportedPool }
    if (kind === 'uninitialized') { f.storage.set(f.slots.slot0, 0n); f.storage.set(f.slots.liquidity, 0n); expected = Status.UnsupportedPool }
    const result = await captureExecution(f.rpc, f.source, r)
    assert.equal(result.quote.status, expected, kind); assert.equal(result.snapshot.bitmap.size, 0); assert.equal(result.snapshot.ticks.size, 0)
  }
})
test('word and initialized-crossing limits stop reads before an unsupported next record', async () => {
  const words = fixture([], 1), wordResult = await captureExecution(words.rpc, words.source, request(true, MAX_INPUT, sqrtPriceAtTick(-10000)))
  assert.equal(wordResult.quote.status, Status.WordLimit); assert.equal(wordResult.snapshot.bitmap.size, 16)
  assert.equal(wordResult.stateReads, 18)
  const positions = Array.from({ length: 70 }, (_, i) => ({ lower: -(i + 1), upper: 100, liquidity: 1n }))
  const crossing = fixture(positions, 1), r = request(true, MAX_INPUT, sqrtPriceAtTick(-100))
  const result = await captureExecution(crossing.rpc, crossing.source, r)
  assert.equal(result.quote.status, Status.TickLimit); assert.equal(result.snapshot.ticks.size, 64)
  assert.equal(result.stateReads, 2 + result.snapshot.bitmap.size + 64); assert.ok(result.stateReads <= MAX_STATE_READS)
  assert.deepEqual(result.quote, quoteExactInput(crossing.snapshot, r.down, r.amount, r.limit))
})
test('structured missing-state diagnostics identify the required record without parsing an error message', () => {
  const f = fixture([{ lower: -120, upper: 0, liquidity: 1000n }])
  assert.throws(() => quoteExactInput({ ...f.snapshot, bitmap: new Map() }, true, 1n, MIN_PRICE),
    e => e instanceof IncompleteSnapshot && e.kind === 'bitmap' && e.position === 0)
  assert.throws(() => quoteExactInput({ ...f.snapshot, ticks: new Map() }, true, 1n, MIN_PRICE),
    e => e instanceof IncompleteSnapshot && e.kind === 'tick' && e.position === 0)
})

const domains = (maxInput = 8n) => [
  { down: true, maxInput, limit: sqrtPriceAtTick(-1200) },
  { down: false, maxInput, limit: sqrtPriceAtTick(1200) },
]
test('exhaustive curves retain every raw input in both directions from one opening state', async () => {
  const f = fixture([{ lower: -120, upper: 120, liquidity: 1000n }, { lower: -480, upper: -360, liquidity: 700n }, { lower: 360, upper: 480, liquidity: 800n }])
  const ds = domains(MAX_CURVE_INPUT), result = await captureExecutionCurves(f.rpc, f.source, { domains: ds })
  assert.equal(result.curves.reduce((n, c) => n + c.points.length, 0), MAX_CURVE_POINTS)
  for (const [i, curve] of result.curves.entries()) {
    assert.deepEqual(curve.domain, ds[i])
    for (const [amount, q] of curve.points.entries()) assert.deepEqual(q, quoteExactInput(f.snapshot, curve.domain.down, BigInt(amount), curve.domain.limit))
  }
  assert.equal(f.state.calls.filter(c => c.method === 'eth_getCode').length, 1)
  assert.equal(f.state.calls.filter(c => c.method === 'eth_getBlockByNumber').length, 2)
  assert.equal(f.state.calls.filter(c => c.method === 'eth_chainId').length, 2)
  const reads = f.state.calls.filter(c => c.method === 'eth_call').map(c => decodeFunctionData({ abi: EXTSLOAD_ABI, data: (c.params[0] as { data: Hash }).data }).args[0])
  assert.equal(reads.length, new Set(reads).size); assert.equal(result.stateReads, reads.length)
  assert.ok(result.stateReads <= MAX_CURVE_STATE_READS)
  assert.equal(result.snapshot.sqrtPriceX96, f.snapshot.sqrtPriceX96); assert.equal(result.snapshot.tick, f.snapshot.tick)
})
test('reversing curve order preserves independent results, opening metadata and storage coverage', async () => {
  const forward = fixture(), reverse = fixture(), ds = domains(16n)
  const a = await captureExecutionCurves(forward.rpc, forward.source, { domains: ds, blockNumber: forward.state.number })
  const b = await captureExecutionCurves(reverse.rpc, reverse.source, { domains: [...ds].reverse(), blockNumber: reverse.state.number })
  assert.deepEqual(a.curves, [...b.curves].reverse()); assert.equal(a.blockHash, b.blockHash)
  assert.deepEqual(a.snapshot, b.snapshot); assert.equal(a.stateReads, b.stateReads)
})
test('partial consumption and unsupported positive inputs remain explicit, with no interpolation', async () => {
  const f = fixture(), ds = domains(8n).map(d => ({ ...d, limit: sqrtPriceAtTick(d.down ? -60 : 60) }))
  const result = await captureExecutionCurves(f.rpc, f.source, { domains: ds })
  for (const curve of result.curves) {
    assert.equal(curve.points.length, 9); assert.equal(curve.points[0].status, Status.Complete)
    assert.ok(curve.points.some(q => q.status === Status.PriceLimit && q.consumedInput < q.requestedInput))
    for (const [amount, q] of curve.points.entries()) assert.deepEqual(q, quoteExactInput(f.snapshot, curve.domain.down, BigInt(amount), curve.domain.limit))
  }
  const invalid = fixture(), capture = await captureExecutionCurves(invalid.rpc, invalid.source, { domains: [{ down: true, maxInput: 3n, limit: Q96 }] })
  assert.deepEqual(capture.curves[0].points.map(q => q.status), [Status.Complete, Status.InvalidPriceLimit, Status.InvalidPriceLimit, Status.InvalidPriceLimit])
  assert.equal(capture.stateReads, 2)
})
test('zero-only curves ignore the limit without loading any bitmap or tick state', async () => {
  const f = fixture(), result = await captureExecutionCurves(f.rpc, f.source, { domains: [{ down: true, maxInput: 0n, limit: 0n }, { down: false, maxInput: 0n, limit: 0n }] })
  assert.equal(result.stateReads, 2); assert.equal(result.snapshot.bitmap.size, 0); assert.equal(result.snapshot.ticks.size, 0)
  for (const c of result.curves) assert.deepEqual(c.points, [quoteExactInput(f.snapshot, c.domain.down, 0n, 0n)])
})
test('per-quote word limits apply independently while the two directions share a bounded union', async () => {
  const f = fixture([], 1, sqrtPriceAtTick(255)), ds = [{ down: true, maxInput: 1n, limit: sqrtPriceAtTick(-10000) }, { down: false, maxInput: 1n, limit: sqrtPriceAtTick(10000) }]
  const result = await captureExecutionCurves(f.rpc, f.source, { domains: ds })
  assert.equal(result.snapshot.bitmap.size, 32); assert.equal(result.stateReads, 34)
  for (const c of result.curves) {
    assert.equal(c.points[1].status, Status.WordLimit); assert.equal(c.points[1].bitmapWords, 16)
    assert.deepEqual(c.points[1], quoteExactInput(f.snapshot, c.domain.down, 1n, c.domain.limit))
  }
})
test('cached opposite-direction ticks cannot bypass a quote crossing limit or broaden its status', async () => {
  const ps = Array.from({ length: 70 }, (_, i) => [
    { lower: -(i + 1), upper: 0, liquidity: 1n }, { lower: 0, upper: i + 1, liquidity: 1n },
  ]).flat()
  const f = fixture(ps, 1), ds = [{ down: false, maxInput: 64n, limit: sqrtPriceAtTick(100) }, { down: true, maxInput: 64n, limit: sqrtPriceAtTick(-100) }]
  const result = await captureExecutionCurves(f.rpc, f.source, { domains: ds })
  assert.equal(result.snapshot.ticks.size, 128); assert.ok(result.stateReads <= MAX_CURVE_STATE_READS)
  assert.equal(result.curves[1].points[64].status, Status.TickLimit)
  for (const c of result.curves) for (const [amount, q] of c.points.entries()) assert.deepEqual(q, quoteExactInput(f.snapshot, c.domain.down, BigInt(amount), c.domain.limit))
})
test('a missing record in the second direction aborts the entire curve collection', async () => {
  const f = fixture([], 1, sqrtPriceAtTick(255)), ds = [{ down: true, maxInput: 1n, limit: sqrtPriceAtTick(-1200) }, { down: false, maxInput: 1n, limit: sqrtPriceAtTick(1200) }]
  f.state.missingWord = f.slots.bitmap(1)
  await assert.rejects(captureExecutionCurves(f.rpc, f.source, { domains: ds }), /State unavailable/)
  assert.ok(f.state.calls.filter(c => c.method === 'eth_call').length > 2)
})
test('curve collection rejects final block or chain changes and clones domains before awaiting RPC', async () => {
  for (const changed of ['block', 'chain'] as const) {
    const f = fixture(); if (changed === 'block') f.state.reorg = true; else f.state.changedChain = true
    await assert.rejects(captureExecutionCurves(f.rpc, f.source, { domains: domains() }), /changed/)
  }
  const f = fixture(), ds = domains(), expected = structuredClone(ds)
  f.state.onRpc = () => { ds.reverse(); ds[0].maxInput = 64n; ds[1].limit = 0n; f.source.key.tickSpacing = 1 }
  const result = await captureExecutionCurves(f.rpc, f.source, { domains: ds, blockNumber: f.state.number })
  assert.deepEqual(result.curves.map(c => c.domain), expected); assert.equal(result.source.key.tickSpacing, 60)
  assert.equal(result.blockNumber, 9007199254740993n)
})
test('curve bounds, duplicate directions and malformed domains fail before any RPC work', async () => {
  const f = fixture()
  for (const ds of [[], [...domains(), ...domains()], [domains()[0], domains()[0]],
    [{ down: true, maxInput: 65n, limit: 0n }], [{ down: true, maxInput: -1n, limit: 0n }],
    [{ down: true, maxInput: 1 as unknown as bigint, limit: 0n }],
    [{ down: 1 as unknown as boolean, maxInput: 0n, limit: 0n }],
    [{ down: true, maxInput: 0n, limit: 1n << 160n }]]) {
    await assert.rejects(captureExecutionCurves(f.rpc, f.source, { domains: ds }))
  }
  await assert.rejects(captureExecutionCurves(f.rpc, f.source, { domains: domains(), blockNumber: -1n }))
  assert.equal(f.state.calls.length, 0)
})
test('bounded seeded concentrated curves agree point-for-point with the independent offline reference', async () => {
  let seed = 0x4c617261
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let i = 0; i < 64; i++) {
    const price = sqrtPriceAtTick((random() % 7 - 3) * 60), l = BigInt(random() % 10000 + 1)
    const f = fixture([{ lower: -240, upper: 0, liquidity: l }, { lower: 0, upper: 240, liquidity: l + 1n }, { lower: -900, upper: -600, liquidity: l / 2n + 1n }, { lower: 600, upper: 900, liquidity: l / 2n + 1n }], 60, price)
    const result = await captureExecutionCurves(f.rpc, f.source, { domains: domains(8n) })
    for (const c of result.curves) for (const [amount, q] of c.points.entries()) assert.deepEqual(q, quoteExactInput(f.snapshot, c.domain.down, BigInt(amount), c.domain.limit))
  }
})
