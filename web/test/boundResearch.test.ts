import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, zeroAddress, type Address } from 'viem'
import { researchBoundOneSidedBatch, RESEARCH_TYPEHASH, RESEARCH_RESULT_COMPONENTS } from '../src/protocol/boundResearch.ts'
import { coverageFixture as fixture } from './epoch-batch-fixture.ts'
import { orderHash } from '../src/protocol/orders.ts'
import { optimize, exhaustive, pivots, WAD, type Domain } from '../../solver/src/discrete-research.ts'
import { Status, quoteExactInput, sqrtPriceAtTick } from '../../solver/src/execution.ts'
import { bindOpeningExecution } from '../src/protocol/openingExecution.ts'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address

test('a bound same-address split exposes a record funding deficit and a different address pivot without clamping', async () => {
  const f = await fixture({ overrides: [{}, {}] }), before = structuredClone(f.args()), r = researchBoundOneSidedBatch(...f.args())
  assert.deepEqual(f.args(), before); assert.equal(r.scope, 'one-sided-linear-raw-unit-pivots')
  assert.equal(r.originalInput, 2n); assert.equal(r.vectorBound, 4n); assert.deepEqual(r.cases[0].fill, [1n, 1n]); assert.equal(r.cases[0].output, 1n)
  assert.deepEqual(r.records.map(t => t.paymentNumerator), [WAD, WAD])
  assert.equal(r.recordRawDeficitNumerator, WAD); assert.equal(r.recordCeilResidual, -1n); assert.equal(r.recordCeilDeficit, 1n)
  assert.equal(r.addresses.length, 1); assert.equal(r.addresses[0].paymentNumerator, WAD)
  assert.equal(r.addresses[0].recordVsGroupPaymentNumerator, WAD); assert.equal(r.addressRawDeficitNumerator, 0n)
  assert.equal(r.addressCeilDeficit, 0n); assert.equal(r.soldCurrency, zeroAddress); assert.equal(r.paymentCurrency, f.record.pool.key.currency1)
})
test('merging same-cost records changes record pivots but grouping addresses does not solve distinct-trader funding', async () => {
  const merged = await fixture({ overrides: [{ budget: 2n }] }), split = await fixture({ overrides: [{}, { trader: addr(101) }] })
  const one = researchBoundOneSidedBatch(...merged.args()), two = researchBoundOneSidedBatch(...split.args())
  assert.equal(one.cases[0].totalInput, two.cases[0].totalInput); assert.equal(one.cases[0].output, two.cases[0].output)
  assert.equal(one.records[0].paymentNumerator, WAD); assert.equal(one.recordCeilDeficit, 0n)
  assert.equal(two.records.length, 2); assert.equal(two.addresses.length, 2)
  assert.equal(two.recordRawDeficitNumerator, WAD); assert.equal(two.addressRawDeficitNumerator, WAD)
  assert.equal(two.addressCeilDeficit, 1n)
})
test('aggregate address IR cannot be promoted to original per-record whole-unit minima', async () => {
  const f = await fixture({ overrides: [{ ask: WAD / 4n }, { ask: WAD / 4n }] }), r = researchBoundOneSidedBatch(...f.args())
  assert.deepEqual(r.cases[0].fill, [1n, 1n]); assert.equal(r.cases[0].welfareNumerator, WAD / 2n)
  assert.deepEqual(r.records.map(t => [t.paymentNumerator, t.minimumPayment, t.floorIR]), [[3n * WAD / 4n, 1n, false], [3n * WAD / 4n, 1n, false]])
  assert.equal(r.recordRawDeficitNumerator, WAD / 2n); assert.equal(r.recordCeilDeficit, 1n)
  const group = r.addresses[0]
  assert.equal(group.paymentNumerator, WAD); assert.equal(group.aggregateMinimumPayment, 1n)
  assert.equal(group.sumRecordMinimumPayment, 2n); assert.equal(group.groupedCeilMeetsRecordMinimums, false)
  assert.equal(r.addressCeilDeficit, 0n) // A funded aggregate is still insufficient for the signed per-record minima.
})
test('every original/removal allocation agrees with independent Cartesian optimization and preserves retained identities', async () => {
  const f = await fixture({ overrides: [{ budget: 2n, ask: WAD / 3n }, { budget: 3n, ask: WAD / 2n, trader: addr(101) }, { ask: WAD / 4n }] })
  const r = researchBoundOneSidedBatch(...f.args()), d: Domain = { lotSize: 1n, output: f.frame.curves[0].points.slice(0, 7).map(q => q.output) }
  const bids = f.orders.map(o => ({ id: orderHash(o), ask: o.ask, budget: o.budget })), candidate = pivots(d, bids, 'exhaustive')
  for (const c of r.cases) {
    const retained = c.indices.map(i => bids[i]), x = exhaustive(d, retained)
    assert.deepEqual(c.indices, bids.map((_, i) => i).filter(i => !c.omittedIndices.includes(i)))
    assert.deepEqual(c.fill, x.fill); assert.equal(c.costNumerator, x.costNumerator); assert.equal(c.welfareNumerator, x.welfareNumerator)
    assert.equal(c.totalInput, x.totalInput); assert.equal(c.output, x.output); assert.equal(c.exhaustiveEvaluated, BigInt(x.evaluated))
    assert.equal(c.scanEvaluated, BigInt(optimize(d, retained).evaluated))
  }
  assert.deepEqual(r.records.map(t => t.paymentNumerator), candidate.paymentNumerator)
  assert.deepEqual(r.records.map(t => t.unspent), candidate.unspent)
})
test('opposite-direction one-sided research uses the correct raw currency units and signed fields', async () => {
  const f = await fixture({ overrides: [{ sellingCurrency0: false, budget: 2n, ask: WAD / 4n, nonce: (1n << 256n) - 1n }] }), r = researchBoundOneSidedBatch(...f.args())
  assert.equal(r.down, false); assert.equal(r.soldCurrency, f.record.pool.key.currency1); assert.equal(r.paymentCurrency, zeroAddress)
  assert.equal(r.records[0].id, orderHash(f.orders[0])); assert.equal(r.records[0].spent + r.records[0].unspent, 2n)
  assert.equal(f.orders[0].ask, WAD / 4n); assert.equal(f.orders[0].nonce, (1n << 256n) - 1n)
})
test('zero allocation, maximum signed asks and empty removal cases remain explicit', async () => {
  const f = await fixture({ overrides: [{ ask: (1n << 128n) - 1n, budget: 4n }] }), r = researchBoundOneSidedBatch(...f.args())
  assert.equal(r.cases[0].totalInput, 0n); assert.deepEqual(r.records.map(t => [t.spent, t.unspent, t.paymentNumerator]), [[0n, 4n, 0n]])
  assert.ok(r.cases.slice(1).every(c => c.fill.length === 0 && c.output === 0n && c.welfareNumerator === 0n))
  assert.equal(r.addresses[0].paymentNumerator, 0n); assert.equal(r.recordCeilDeficit, 0n)
})
test('incomplete, partial and unsupported original domains reject before candidate computation', async () => {
  for (const options of [{ overrides: [{ budget: 9n }] }, { overrides: [{ budget: (1n << 96n) - 1n }] },
    { overrides: [{ budget: 4n }], downLimit: sqrtPriceAtTick(-1) }, { overrides: [{}], downLimit: 0n },
    { overrides: [{}], oneDirection: true }]) {
    const f = await fixture(options)
    assert.throws(() => researchBoundOneSidedBatch(...f.args()), /Original opening prefixes/)
  }
})
test('mixed batches, excess original records and exhaustive work overflow cannot be sampled or narrowed to fit', async () => {
  const mixed = await fixture()
  assert.throws(() => researchBoundOneSidedBatch(...mixed.args()), /opposing orders/)
  const nine = await fixture({ cap: 16n, overrides: Array.from({ length: 9 }, () => ({})) })
  assert.throws(() => researchBoundOneSidedBatch(...nine.args()), /1..8 original/)
  const eight = await fixture({ cap: 64n, overrides: Array.from({ length: 8 }, () => ({ budget: 6n })) })
  assert.throws(() => researchBoundOneSidedBatch(...eight.args()), /exhaustive vector work/)
  const valid = await fixture({ overrides: Array.from({ length: 8 }, () => ({})) })
  const r = researchBoundOneSidedBatch(...valid.args()); assert.equal(r.records.length, 8); assert.equal(r.vectorBound, 256n)
})
test('a fully consumed price-limit endpoint is usable input data; no partial point is substituted', async () => {
  const f = await fixture({ overrides: [{ budget: 2n }] }), curve = f.frame.curves[0]
  curve.domain.limit = curve.points[2].sqrtPriceX96
  ;(curve as { points: unknown }).points = Array.from({ length: 9 }, (_, i) => quoteExactInput(f.frame.snapshot, true, BigInt(i), curve.domain.limit))
  const opening = bindOpeningExecution(f.anchor, f.record, f.frame)
  f.anchor.curvesHash = opening.curvesHash
  assert.equal(curve.points[2].status, Status.Complete); assert.equal(curve.points[2].consumedInput, 2n)
  assert.ok(curve.points.slice(3).some(q => q.status === Status.PriceLimit && q.consumedInput < q.requestedInput))
  assert.equal(researchBoundOneSidedBatch(...f.args()).cases[0].output, curve.points[2].output)
})
test('bound content is revalidated and research hash/arrays are immutable without granting settlement authority', async () => {
  const f = await fixture({ overrides: [{}, {}] }), r = researchBoundOneSidedBatch(...f.args()), saved = structuredClone(r)
  assert.equal(r.researchHash, keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' },
    { type: 'tuple', components: RESEARCH_RESULT_COMPONENTS }], [RESEARCH_TYPEHASH, r.coverageHash, r])))
  for (const values of [r, r.cases, r.records, r.addresses, ...r.cases, ...r.records, ...r.addresses,
    ...r.cases.flatMap(c => [c.fill, c.indices, c.omittedIndices]), ...r.addresses.map(a => a.indices)]) assert.ok(Object.isFrozen(values))
  f.orders[0].ask++; f.frame.curves[0].points[1].output++
  assert.deepEqual(r, saved); assert.throws(() => researchBoundOneSidedBatch(...f.args()), /mismatch|changed/)
})
test('64 seeded bound cases independently match allocation, removal welfare, exact pivots and signed deficits', async () => {
  let seed = 0x514f7474
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let run = 0; run < 64; ++run) {
    const down = !!(random() & 1), n = 1 + random() % 4
    const overrides = Array.from({ length: n }, () => ({ sellingCurrency0: down, trader: addr(100 + random() % 3), budget: BigInt(1 + random() % 3), ask: BigInt(random() % 9) * WAD / 8n }))
    const f = await fixture({ cap: 16n, overrides }), r = researchBoundOneSidedBatch(...f.args())
    const originalInput = f.orders.reduce((v, o) => v + o.budget, 0n)
    const d: Domain = { lotSize: 1n, output: f.frame.curves.find(c => c.domain.down === down)!.points.slice(0, Number(originalInput) + 1).map(q => q.output) }
    const bids = f.orders.map(o => ({ id: orderHash(o), ask: o.ask, budget: o.budget })), x = pivots(d, bids, 'exhaustive')
    assert.deepEqual(r.cases[0].fill, x.fill); assert.deepEqual(r.records.map(t => t.paymentNumerator), x.paymentNumerator)
    assert.equal(r.recordRawDeficitNumerator, x.rawDeficitNumerator); assert.equal(r.recordCeilResidual, x.ceilResidual)
    for (const a of r.addresses) {
      const other = exhaustive(d, bids.filter((_, i) => !a.indices.includes(i)))
      const cost = a.indices.reduce((v, i) => v + bids[i].ask * x.fill[i], 0n)
      assert.equal(a.withoutWelfareNumerator, other.welfareNumerator)
      assert.equal(a.paymentNumerator, cost + x.welfareNumerator - other.welfareNumerator)
      assert.equal(a.sumRecordMinimumPayment, a.indices.reduce((v, i) => v + x.minimumPayment[i], 0n))
    }
    assert.equal(r.addressRawDeficitNumerator, r.addresses.reduce((v, a) => v + a.paymentNumerator, 0n) - x.output * WAD)
  }
})
