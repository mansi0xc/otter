import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, zeroAddress } from 'viem'
import { inspectSignedMinimumFeasibility, MINIMUM_TYPEHASH, MINIMUM_RESULT_COMPONENTS } from '../src/protocol/minimumFeasibility.ts'
import { researchBoundOneSidedBatch } from '../src/protocol/boundResearch.ts'
import { coverageFixture } from './epoch-batch-fixture.ts'
import { bindOpeningExecution, openingCommitment } from '../src/protocol/openingExecution.ts'
import { orderHash } from '../src/protocol/orders.ts'
import { capitalWeight } from '../../solver/src/rewards.ts'
import { quoteExactInput, sqrtPriceAtTick } from '../../solver/src/execution.ts'
const WAD = 10n ** 18n, ceil = (n: bigint) => (n + WAD - 1n) / WAD
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as const

// New synthetic caller-authenticated content, not actual RPC/book authentication.
async function lowerPriceFixture() {
  const f = await coverageFixture({ overrides: [{ ask: WAD / 10n }, { budget: 2n, ask: 2n * WAD / 5n }] })
  f.record.pool.tick = -6000; f.record.pool.sqrtPriceX96 = sqrtPriceAtTick(-6000)
  f.record.weights = f.record.positions.map(p => capitalWeight(f.record.pool.sqrtPriceX96, p.tickLower, p.tickUpper, p.liquidity).weight)
  f.record.totalWeight = f.record.weights.reduce((a, b) => a + b, 0n)
  Object.assign(f.frame.snapshot, { tick: -6000, sqrtPriceX96: f.record.pool.sqrtPriceX96 })
  for (const c of f.frame.curves) {
    c.domain.limit = sqrtPriceAtTick(-6000 + (c.domain.down ? -1200 : 1200))
    ;(c as { points: unknown }).points = Array.from({ length: Number(c.domain.maxInput) + 1 }, (_, i) => quoteExactInput(f.frame.snapshot, c.domain.down, BigInt(i), c.domain.limit))
  }
  f.anchor.snapshotHash = openingCommitment(f.record).snapshotHash
  Object.assign(f.anchor, bindOpeningExecution(f.anchor, f.record, f.frame))
  return f
}
test('positive signed minima can leave no positive-output integer allocation on the complete original domain', async () => {
  const f = await coverageFixture({ overrides: [{ ask: WAD / 4n }, { ask: WAD / 4n }] }), r = inspectSignedMinimumFeasibility(...f.args()), c = r.cases[0]
  assert.equal(r.scope, 'one-sided-signed-minimum-frontier'); assert.equal(c.vectorCount, 4n)
  assert.deepEqual(c.points.map(p => [p.totalInput, p.output, p.minimumPayment, p.feasible]), [[0n, 0n, 0n, true], [1n, 0n, 1n, false], [2n, 1n, 2n, false]])
  assert.equal(c.researchMinimumDeficit, 1n); assert.equal(c.sameInputFeasible, false); assert.equal(c.positiveOutputAllocationExists, false)
  assert.equal(c.points[2].aggregateMinimumPayment, 1n)
})
test('a merged record changes delivery feasibility while keeping aggregate ask, budget and output', async () => {
  const split = await coverageFixture({ overrides: [{ ask: WAD / 4n }, { ask: WAD / 4n }] }), merged = await coverageFixture({ overrides: [{ budget: 2n, ask: WAD / 4n }] })
  const a = inspectSignedMinimumFeasibility(...split.args()), b = inspectSignedMinimumFeasibility(...merged.args())
  assert.equal(a.originalInput, b.originalInput); assert.equal(a.cases[0].points[2].costNumerator, b.cases[0].points[2].costNumerator)
  assert.equal(b.cases[0].points[2].minimumPayment, 1n); assert.equal(b.cases[0].positiveOutputAllocationExists, true); assert.equal(a.cases[0].positiveOutputAllocationExists, false)
})
test('feasible original signed delivery does not establish pivot funding or incentives', async () => {
  const f = await coverageFixture({ overrides: [{}, {}] }), pivots = researchBoundOneSidedBatch(...f.args()), r = inspectSignedMinimumFeasibility(...f.args())
  assert.equal(r.cases[0].researchMinimumDeficit, 0n); assert.equal(r.cases[0].positiveOutputAllocationExists, true)
  assert.equal(pivots.recordCeilDeficit, 1n); assert.equal(r.researchHash, pivots.researchHash)
})
test('least whole-unit payout at the same input can require higher exact report cost than the welfare allocation', async () => {
  const f = await lowerPriceFixture(), before = structuredClone(f.args()), p = researchBoundOneSidedBatch(...f.args()), r = inspectSignedMinimumFeasibility(...f.args())
  assert.deepEqual(p.cases[0].fill, [1n, 1n]); assert.equal(p.cases[0].totalInput, 2n); assert.equal(p.cases[0].welfareNumerator, WAD / 2n)
  const c = r.cases[0], point = c.points[2]
  assert.equal(c.researchMinimumPayment, 2n); assert.equal(c.researchMinimumDeficit, 1n); assert.equal(c.sameInputMinimumPayment, 1n)
  assert.equal(c.sameInputFeasible, true); assert.deepEqual(point.fill, [0n, 2n]); assert.equal(point.costNumerator, 4n * WAD / 5n)
  assert.equal(point.welfareNumerator, WAD / 5n); assert.deepEqual(f.args(), before)
})
test('original and every record/address removal retain full budgets, hashes, zero rows and separate inventories', async () => {
  const f = await coverageFixture({ overrides: [{ budget: 2n, ask: WAD / 3n }, { ask: WAD / 4n }, { trader: addr(101), ask: WAD / 2n }] }), r = inspectSignedMinimumFeasibility(...f.args()), p = researchBoundOneSidedBatch(...f.args())
  for (const [i, c] of r.cases.entries()) {
    assert.deepEqual(c.indices, p.cases[i].indices); assert.deepEqual(c.omittedIndices, p.cases[i].omittedIndices); assert.equal(c.ordersHash, p.cases[i].ordersHash)
    assert.equal(c.points.length, 1 + c.indices.reduce((q, j) => q + Number(f.orders[j].budget), 0))
    assert.equal(c.vectorCount, c.indices.reduce((q, j) => q * (f.orders[j].budget + 1n), 1n)); assert.equal(c.points[0].minimumPayment, 0n); assert.equal(c.points[0].feasible, true)
    assert.equal(c.researchMinimumPayment, c.indices.reduce((q, j, k) => q + ceil(f.orders[j].ask * p.cases[i].fill[k]), 0n))
  }
  const single = await coverageFixture({ overrides: [{}] }), empty = inspectSignedMinimumFeasibility(...single.args()).cases[1]
  assert.equal(empty.vectorCount, 1n); assert.equal(empty.dpTransitions, 0n); assert.deepEqual(empty.points[0].fill, [])
})
test('reverse currency orientation and maximum asks retain exact signed welfare even for infeasible points', async () => {
  const f = await coverageFixture({ overrides: [{ sellingCurrency0: false, budget: 2n, ask: (1n << 128n) - 1n, nonce: (1n << 256n) - 1n }] }), r = inspectSignedMinimumFeasibility(...f.args())
  assert.equal(r.down, false); assert.equal(r.paymentCurrency, zeroAddress); assert.equal(r.soldCurrency, f.record.pool.key.currency1)
  assert.equal(r.cases[0].points[2].costNumerator, 2n * ((1n << 128n) - 1n)); assert.ok(r.cases[0].points[2].welfareNumerator < 0n)
  assert.equal(r.cases[0].researchInput, 0n); assert.equal(r.cases[0].positiveOutputAllocationExists, false)
})
test('equal whole-unit and exact costs use deterministic ask/order-hash fill priority', async () => {
  const f = await coverageFixture({ overrides: [{ ask: WAD / 4n }, { ask: WAD / 4n }] }), r = inspectSignedMinimumFeasibility(...f.args()), first = orderHash(f.orders[0]) < orderHash(f.orders[1]) ? 0 : 1
  assert.deepEqual(r.cases[0].points[1].fill, first === 0 ? [1n, 0n] : [0n, 1n]); assert.equal(r.cases[0].points[1].costNumerator, WAD / 4n)
})
test('incomplete, missing-zero, partial, unsupported, mixed and excessive work domains refuse calculation', async () => {
  for (const options of [{ overrides: [{ budget: (1n << 96n) - 1n }] }, { overrides: [{}], oneDirection: true }, { overrides: [{ budget: 4n }], downLimit: sqrtPriceAtTick(-1) },
    { overrides: [{}], downLimit: 0n }, {}, { cap: 16n, overrides: Array.from({ length: 9 }, () => ({})) }, { cap: 64n, overrides: Array.from({ length: 8 }, () => ({ budget: 6n })) }]) {
    const f = await coverageFixture(options); assert.throws(() => inspectSignedMinimumFeasibility(...f.args()), /Original opening prefixes|one-sided research/)
  }
})
test('eight original records enumerate every budget vector without turning the research limit into admission policy', async () => {
  const f = await coverageFixture({ overrides: Array.from({ length: 8 }, () => ({ ask: WAD / 4n })) }), r = inspectSignedMinimumFeasibility(...f.args())
  assert.equal(r.cases[0].vectorCount, 256n); assert.equal(r.cases[0].points.length, 9); assert.equal(r.cases[0].positiveOutputAllocationExists, false); assert.equal(f.orders.length, 8)
})
test('minimum calculation hash, deep freeze and content revalidation do not confer settlement authority', async () => {
  const f = await coverageFixture({ overrides: [{}, {}] }), r = inspectSignedMinimumFeasibility(...f.args()), saved = structuredClone(r)
  assert.equal(r.minimumHash, keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'tuple', components: MINIMUM_RESULT_COMPONENTS }], [MINIMUM_TYPEHASH, r.researchHash, r])))
  for (const obj of [r, r.cases, ...r.cases, ...r.cases.flatMap(c => [c.indices, c.omittedIndices, c.points]), ...r.cases.flatMap(c => c.points.flatMap(p => [p, p.fill]))]) assert.ok(Object.isFrozen(obj))
  f.orders[0].budget++; f.frame.curves[0].points[1].output++; assert.deepEqual(r, saved); assert.throws(() => inspectSignedMinimumFeasibility(...f.args()), /mismatch|changed/)
})
test('64 seeded complete domains match an independent per-quantity Cartesian minimum oracle in all cases', async () => {
  let seed = 0x526d696e; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let run = 0; run < 64; ++run) {
    const down = !!(random() & 1), n = 1 + random() % 4
    const overrides = Array.from({ length: n }, () => ({ sellingCurrency0: down, trader: addr(100 + random() % 3), budget: BigInt(1 + random() % 4), ask: BigInt(random() % 17) * WAD / 8n }))
    const f = await coverageFixture({ cap: 16n, overrides }), r = inspectSignedMinimumFeasibility(...f.args())
    for (const c of r.cases) {
      const kept = c.indices.map(i => f.orders[i]), rank = kept.map((_, i) => i).sort((a, b) => kept[a].ask === kept[b].ask ? orderHash(kept[a]).localeCompare(orderHash(kept[b])) : kept[a].ask < kept[b].ask ? -1 : 1)
      const best = new Map<number, { min: bigint; cost: bigint; fill: bigint[] }>(), fill = kept.map(() => 0n); let count = 0n
      const visit = (i: number) => {
        if (i < kept.length) { for (fill[i] = 0n; fill[i] <= kept[i].budget; fill[i]++) visit(i + 1); return }
        ++count; const q = Number(fill.reduce((a, b) => a + b, 0n)), cost = fill.reduce((a, v, j) => a + kept[j].ask * v, 0n), min = fill.reduce((a, v, j) => a + ceil(kept[j].ask * v), 0n), old = best.get(q)
        let wins = !old || min < old.min || (min === old.min && cost < old.cost)
        if (old && min === old.min && cost === old.cost) for (const j of rank) { if (fill[j] === old.fill[j]) continue; wins = fill[j] > old.fill[j]; break }
        if (wins) best.set(q, { min, cost, fill: [...fill] })
      }
      visit(0); assert.equal(count, c.vectorCount); assert.equal(best.size, c.points.length)
      for (const point of c.points) {
        const x = best.get(Number(point.totalInput))!
        assert.equal(point.minimumPayment, x.min); assert.equal(point.costNumerator, x.cost); assert.deepEqual(point.fill, x.fill)
        assert.equal(point.aggregateMinimumPayment, ceil(x.cost)); assert.equal(point.welfareNumerator, point.output * WAD - x.cost)
        assert.equal(point.feasible, x.min <= point.output); assert.equal(point.deficit, x.min > point.output ? x.min - point.output : 0n)
        assert.ok(x.min >= ceil(x.cost)); assert.ok(x.min - ceil(x.cost) <= BigInt(Math.max(0, x.fill.filter(v => v > 0n).length - 1)))
      }
      assert.equal(c.positiveOutputAllocationExists, c.points.some(p => p.output > 0n && p.totalInput > 0n && p.minimumPayment <= p.output))
    }
  }
})
