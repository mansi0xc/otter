import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunctionData, keccak256, zeroAddress, type Address, type Hash } from 'viem'
import { bindOpeningExecution, openingCommitment, type OpeningRecord, type OpeningAnchor } from '../src/protocol/openingExecution.ts'
import { captureExecutionCurves, executionPoolId, executionSlots, EXTSLOAD_ABI, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'
import { MIN_TICK, MAX_TICK, Q96, Status, MAX_LIQUIDITY, bitmapPosition, quoteExactInput, sqrtPriceAtTick, tickAtSqrtPrice } from '../../solver/src/execution.ts'
import { capitalWeight } from '../../solver/src/rewards.ts'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
async function fixture(spacing = 60, price = Q96, l = 1000n, cap = 8n, storedTick = tickAtSqrtPrice(price), limitSpan = 1200) {
  const source = { chainId: 31337n, manager: addr(1), runtimeHash: keccak256('0x6001'),
    key: { currency0: zeroAddress, currency1: addr(2), hooks: addr(3), fee: 0, tickSpacing: spacing } }
  const lower = Math.trunc(MIN_TICK / spacing) * spacing, upper = Math.trunc(MAX_TICK / spacing) * spacing
  const positions = [l, 1n].map((liquidity, i) => ({ id: BigInt(i + 1), owner: addr(10 + i), tickLower: lower, tickUpper: upper, liquidity }))
  const total = l + 1n, poolId = executionPoolId(source.key), slots = executionSlots(poolId)
  const first = bitmapPosition(Math.floor(storedTick / spacing)).word
  const bitmap = new Map<number, bigint>()
  for (let i = -16; i <= 16; i++) bitmap.set(first + i, 0n)
  const storage = new Map<Hash, bigint>()
  for (const t of [lower, upper]) {
    const { word, bit } = bitmapPosition(t / spacing)
    bitmap.set(word, (bitmap.get(word) ?? 0n) | 1n << BigInt(bit))
    storage.set(slots.tick(t), total | ((t === lower ? total : -total) & ((1n << 128n) - 1n)) << 128n)
  }
  bitmap.forEach((bits, word) => storage.set(slots.bitmap(word), bits))
  storage.set(slots.slot0, price | (BigInt(storedTick) & ((1n << 24n) - 1n)) << 160n); storage.set(slots.liquidity, total)
  const blockNumber = 9007199254740993n, blockHash = hash(21)
  const rpc: SnapshotRpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x7a69'
    if (method === 'eth_getBlockByNumber') return { number: `0x${blockNumber.toString(16)}`, hash: blockHash }
    assert.deepEqual(params[1], { blockHash, requireCanonical: true })
    if (method === 'eth_getCode') return '0x6001'
    const call = params[0] as { data: Hash }, slot = decodeFunctionData({ abi: EXTSLOAD_ABI, data: call.data }).args[0]
    if (!storage.has(slot)) throw new Error('Missing synthetic opening storage')
    return `0x${storage.get(slot)!.toString(16).padStart(64, '0')}`
  }
  const frame = await captureExecutionCurves(rpc, source, { blockNumber, domains: [
    { down: true, maxInput: cap, limit: sqrtPriceAtTick(Math.max(lower + 1, storedTick - limitSpan)) },
    { down: false, maxInput: cap, limit: sqrtPriceAtTick(Math.min(upper - 1, storedTick + limitSpan)) },
  ] })
  const weights = positions.map(p => capitalWeight(price, lower, upper, p.liquidity).weight)
  const record: OpeningRecord = { chainId: source.chainId, book: addr(4), guard: addr(5), poolId, epoch: 0n, configVersion: 1n,
    closesAt: 1060n, executeUntil: 1960n, openingBlock: blockNumber - 1n, rewardPolicyHash: hash(20), totalWeight: weights.reduce((a, b) => a + b),
    positions, weights, pool: { key: source.key, manager: source.manager, sqrtPriceX96: price, tick: storedTick, protocolFee: 0, lpFee: 0,
      activeLiquidity: total, totalLiquidity: total, ownershipVersion: 2n, positionsHash: hash(1) } }
  record.pool.positionsHash = openingCommitment(record).positionsHash
  const anchor: OpeningAnchor = { chainId: record.chainId, book: record.book, guard: record.guard, poolId, epoch: record.epoch,
    configVersion: record.configVersion, rewardPolicyHash: record.rewardPolicyHash, snapshotHash: openingCommitment(record).snapshotHash, blockNumber, blockHash }
  return { record, anchor, frame }
}
function reanchor(f: Awaited<ReturnType<typeof fixture>>) {
  f.record.pool.positionsHash = openingCommitment(f.record).positionsHash
  f.anchor.snapshotHash = openingCommitment(f.record).snapshotHash
}
function requote(f: Awaited<ReturnType<typeof fixture>>) {
  for (const c of f.frame.curves) (c as { points: unknown }).points = Array.from({ length: Number(c.domain.maxInput) + 1 }, (_, i) => quoteExactInput(f.frame.snapshot, c.domain.down, BigInt(i), c.domain.limit))
  f.frame.stateReads = 2 + f.frame.snapshot.bitmap.size + f.frame.snapshot.ticks.size
}

test('opening binding checks the v2 commitment, exact capital weights and every full-range quote', async () => {
  const f = await fixture(), before = structuredClone(f)
  const result = bindOpeningExecution(f.anchor, f.record, f.frame)
  assert.equal(result.snapshotHash, f.anchor.snapshotHash); assert.equal(result.positionsHash, f.record.pool.positionsHash)
  assert.equal(result.pointCount, 18); assert.equal(f.record.weights[1], 0n)
  assert.deepEqual(f, before); assert.ok(Object.isFrozen(result))
  const extra = { ...f.anchor, extra: { mutable: [] } }
  assert.deepEqual(bindOpeningExecution(extra, f.record, f.frame), result)
  assert.ok(!Object.hasOwn(bindOpeningExecution(extra, f.record, f.frame), 'extra'))
})
test('every anchor domain, identity, configuration and read-block field is checked', async () => {
  const f = await fixture()
  const changed = { chainId: 1n, book: addr(99), guard: addr(99), poolId: hash(99), epoch: 1n, configVersion: 2n,
    rewardPolicyHash: hash(99), snapshotHash: hash(99), blockNumber: f.anchor.blockNumber - 1n, blockHash: hash(99) }
  for (const [name, value] of Object.entries(changed)) assert.throws(() => bindOpeningExecution({ ...f.anchor, [name]: value }, f.record, f.frame), /mismatch/)
  f.record.openingBlock = f.anchor.blockNumber + 1n; reanchor(f)
  assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame), /read-block/)
})
test('reordering or changing stored roster and weights cannot inherit the old commitment', async () => {
  for (const kind of ['owner', 'order', 'weights', 'total'] as const) {
    const f = await fixture()
    if (kind === 'owner') f.record.positions[0].owner = addr(99)
    if (kind === 'order') (f.record.positions as unknown[]).reverse()
    if (kind === 'weights') (f.record.weights as bigint[])[0]++
    if (kind === 'total') f.record.totalWeight++
    assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame), /commitment|roster/)
  }
})
test('even a matching supplied commitment cannot bypass nonzero owners, unique IDs and positive full-range liquidity', async () => {
  for (const kind of ['duplicate', 'zeroId', 'range', 'zeroLiquidity', 'zeroOwner'] as const) {
    const f = await fixture()
    if (kind === 'duplicate') f.record.positions[1].id = 1n
    if (kind === 'zeroId') f.record.positions[0].id = 0n
    if (kind === 'range') f.record.positions[0].tickLower += 60
    if (kind === 'zeroLiquidity') f.record.positions[0].liquidity = 0n
    if (kind === 'zeroOwner') f.record.positions[0].owner = zeroAddress
    assert.throws(() => { reanchor(f); bindOpeningExecution(f.anchor, f.record, f.frame) }, /full-range|Zero address/)
  }
})
test('reward weights and totals are independently recomputed from rounded principal', async () => {
  for (const kind of ['weights', 'weightTotal', 'liquidityTotal'] as const) {
    const f = await fixture()
    if (kind === 'weights') { (f.record.weights as bigint[])[0]++; f.record.totalWeight++ }
    if (kind === 'weightTotal') f.record.totalWeight++
    if (kind === 'liquidityTotal') { f.record.pool.totalLiquidity++; f.record.pool.activeLiquidity++ }
    reanchor(f)
    assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame), /weight|total/)
  }
  const zero = await fixture(60, Q96, 1n); reanchor(zero)
  assert.throws(() => bindOpeningExecution(zero.anchor, zero.record, zero.frame), /weight total/)
})
test('malformed clocks, widths, roster/weight lengths and missing identities fail explicitly', async () => {
  const f = await fixture()
  for (const changes of [{ closesAt: 0n }, { closesAt: 1n << 64n }, { executeUntil: f.record.closesAt }, { configVersion: 0n },
    { epoch: -1n }, { epoch: 1n << 256n }, { positions: [] }, { positions: Array(33).fill(f.record.positions[0]) }, { weights: [] },
    { book: zeroAddress }, { guard: zeroAddress }]) assert.throws(() => openingCommitment({ ...f.record, ...changes }))
})
test('source, layout, pool key, manager and header changes cannot reuse an opening record', async () => {
  for (const kind of ['layout', 'poolId', 'sourceChain', 'manager', 'hook', 'runtime', 'price', 'tick', 'liquidity', 'fees'] as const) {
    const f = await fixture()
    if (kind === 'layout') f.frame.layout = 'other' as typeof f.frame.layout
    if (kind === 'poolId') f.frame.poolId = hash(99)
    if (kind === 'sourceChain') f.frame.source.chainId++
    if (kind === 'manager') f.frame.source.manager = addr(99)
    if (kind === 'hook') f.frame.source.key.hooks = addr(99)
    if (kind === 'runtime') f.frame.source.runtimeHash = '0x' as Hash
    if (kind === 'price') f.frame.snapshot.sqrtPriceX96++
    if (kind === 'tick') f.frame.snapshot.tick++
    if (kind === 'liquidity') f.frame.snapshot.liquidity++
    if (kind === 'fees') f.frame.snapshot.protocolFee = 1
    assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame))
  }
})
test('fee, liquidity, price and boundary inconsistencies reject even under a newly supplied hash', async () => {
  for (const change of [{ protocolFee: 1 }, { lpFee: 1 }, { totalLiquidity: 0n, activeLiquidity: 0n },
    { totalLiquidity: MAX_LIQUIDITY + 1n, activeLiquidity: MAX_LIQUIDITY + 1n }, { activeLiquidity: 1n },
    { sqrtPriceX96: 0n }, { tick: 1 }]) {
    const f = await fixture(); Object.assign(f.record.pool, change); reanchor(f)
    assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame), /domain|price\/tick/)
  }
  const boundary = await fixture(60, Q96, 1000n, 8n, -1)
  assert.equal(bindOpeningExecution(boundary.anchor, boundary.record, boundary.frame).pointCount, 18)
})
test('full-range roster rejects forged bitmap/tick schedules even if all quotes match the forged maps', async () => {
  const f = await fixture()
  ;(f.frame.snapshot.bitmap as Map<number, bigint>).set(0, 2n)
  ;(f.frame.snapshot.ticks as Map<number, { gross: bigint; net: bigint }>).set(60, { gross: 1n, net: 0n })
  requote(f)
  assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame), /bitmap contradicts/)
  const tick = await fixture(), lower = tick.record.positions[0].tickLower
  ;(tick.frame.snapshot.ticks as Map<number, { gross: bigint; net: bigint }>).set(lower, { gross: 1n, net: 1n })
  requote(tick)
  assert.throws(() => bindOpeningExecution(tick.anchor, tick.record, tick.frame), /tick contradicts/)
})
test('missing visited words, cache counts, truncated curves and duplicate directions cannot produce bindings', async () => {
  for (const kind of ['missing', 'count', 'length', 'cap', 'duplicate'] as const) {
    const f = await fixture()
    if (kind === 'missing') { (f.frame.snapshot.bitmap as Map<number, bigint>).delete(-1); f.frame.stateReads-- }
    if (kind === 'count') f.frame.stateReads++
    if (kind === 'length') (f.frame.curves[0].points as unknown[]).pop()
    if (kind === 'cap') f.frame.curves[0].domain.maxInput = 65n
    if (kind === 'duplicate') f.frame.curves[1].domain.down = true
    assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame))
  }
})
test('every quoted amount, status, output and final-state field is rechecked', async () => {
  const fields = ['status', 'requestedInput', 'consumedInput', 'output', 'sqrtPriceX96', 'tick', 'liquidity', 'bitmapWords', 'initializedTicksCrossed', 'steps'] as const
  for (const field of fields) {
    const f = await fixture(), q = f.frame.curves[0].points[1]
    if (typeof q[field] === 'bigint') (q as Record<string, unknown>)[field] = (q[field] as bigint) + 1n
    else (q as Record<string, unknown>)[field] = (q[field] as number) + 1
    assert.throws(() => bindOpeningExecution(f.anchor, f.record, f.frame), /quote mismatch/)
  }
})
test('partial and unsupported prefix rows remain distinct after binding; hashes do not mutate with caller data', async () => {
  const partial = await fixture(60, Q96, 10n)
  assert.ok(partial.frame.curves[0].points.some(q => q.status === Status.PriceLimit))
  const result = bindOpeningExecution(partial.anchor, partial.record, partial.frame), saved = structuredClone(result)
  partial.frame.curves[0].points[1].output++; partial.record.positions[0].owner = addr(99)
  assert.deepEqual(result, saved); assert.throws(() => bindOpeningExecution(partial.anchor, partial.record, partial.frame))
  const unsupported = await fixture(1, Q96, 10n, 64n, 0, 10000)
  assert.ok(unsupported.frame.curves[0].points.some(q => q.status === Status.WordLimit && q.consumedInput > 0n))
  assert.equal(bindOpeningExecution(unsupported.anchor, unsupported.record, unsupported.frame).pointCount, 130)
})
test('64 seeded full-range frames bind exact weights and all raw curve points', async () => {
  let seed = 0x4d617261
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let i = 0; i < 64; i++) {
    const f = await fixture([1, 60, 32767][random() % 3], sqrtPriceAtTick(random() % 40001 - 20000), BigInt(random() % 1000000 + 1000))
    const result = bindOpeningExecution(f.anchor, f.record, f.frame)
    assert.equal(result.snapshotHash, f.anchor.snapshotHash); assert.equal(result.pointCount, 18)
  }
})
