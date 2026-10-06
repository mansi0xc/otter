import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, zeroHash, type Address } from 'viem'
import { inspectOpeningPrefixCoverage, requireWholeInputOpeningPrefixes, COVERAGE_ABI, COVERAGE_TYPEHASH } from '../src/protocol/batchCoverage.ts'
import { ORDER_COMPONENTS } from '../src/protocol/epochBatch.ts'
import { bindOpeningExecution } from '../src/protocol/openingExecution.ts'
import { Status, sqrtPriceAtTick } from '../../solver/src/execution.ts'
import { coverageFixture as fixture } from './epoch-batch-fixture.ts'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
test('original coverage reaches aggregate budgets and binds deterministic, deeply frozen inventory without input mutation', async () => {
  const f = await fixture(), before = structuredClone(f.args()), r = inspectOpeningPrefixCoverage(...f.args())
  assert.equal(r.scope, 'opening-alternative-prefixes'); assert.equal(r.wholeInputPrefixesAvailable, true)
  assert.deepEqual(r.cases[0].directions.map(d => [d.requiredInput, d.representedInputs, d.missingInputs]), [[5n, 6n, 0n], [2n, 3n, 0n]])
  assert.equal(r.cases.length, 6); assert.equal(r.cases[0].ordersHash, f.anchor.ordersHash)
  assert.deepEqual(f.args(), before)
  assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.cases))
  for (const c of r.cases) { assert.ok(Object.isFrozen(c)); assert.ok(Object.isFrozen(c.omittedIndices)); assert.ok(Object.isFrozen(c.directions))
    for (const d of c.directions) { assert.ok(Object.isFrozen(d)); assert.ok(Object.isFrozen(d.unsupportedAt)); assert.ok(Object.isFrozen(d.partialAt)) } }
  assert.equal(requireWholeInputOpeningPrefixes(...f.args()).coverageHash, r.coverageHash)
  assert.equal(inspectOpeningPrefixCoverage(...f.args()).coverageHash, r.coverageHash)
})
test('individually covered orders cannot hide an uncovered aggregate; removal coverage does not promote the original', async () => {
  const f = await fixture({ overrides: [{ budget: 5n }, { budget: 5n, trader: addr(101) }] }), r = inspectOpeningPrefixCoverage(...f.args())
  const original = r.cases[0].directions[0]
  assert.equal(original.requiredInput, 10n); assert.equal(original.firstMissing, 9n); assert.equal(original.missingInputs, 2n)
  assert.equal(r.wholeInputPrefixesAvailable, false)
  assert.ok(r.cases.slice(1).every(c => c.directions.every(d => d.wholeInputPrefixAvailable)))
  assert.throws(() => requireWholeInputOpeningPrefixes(...f.args()), /Original opening prefixes/)
})
test('uint96 original budgets remain exact and yield bounded missing-range counts without enumerating them', async () => {
  const budget = (1n << 96n) - 1n, f = await fixture({ cap: 64n, overrides: [{ budget }] })
  const r = inspectOpeningPrefixCoverage(...f.args()), d = r.cases[0].directions[0]
  assert.equal(d.requiredInput, budget); assert.equal(d.representedInputs, 65n)
  assert.equal(d.firstMissing, 65n); assert.equal(d.missingInputs, budget - 64n)
  assert.equal(f.orders[0].budget, budget); assert.equal(r.wholeInputPrefixesAvailable, false)
  assert.equal(r.cases.length, 3); assert.ok(d.unsupportedAt.length <= 65 && d.partialAt.length <= 65)
})
test('record omission and complete address omission preserve original order identities and different remaining budgets', async () => {
  const f = await fixture(), r = inspectOpeningPrefixCoverage(...f.args())
  assert.deepEqual(r.cases.map(c => [c.kind, [...c.omittedIndices], ...c.directions.map(d => d.requiredInput)]), [
    [0, [], 5n, 2n], [1, [0], 2n, 2n], [1, [1], 5n, 0n], [1, [2], 3n, 2n], [2, [0, 1], 2n, 0n], [2, [2], 3n, 2n],
  ])
  for (const c of r.cases) {
    const retained = f.orders.filter((_, i) => !c.omittedIndices.includes(i))
    assert.equal(c.ordersHash, keccak256(encodeAbiParameters([{ type: 'tuple[]', components: ORDER_COMPONENTS }], [retained])))
  }
  const single = await fixture({ overrides: [{}] }), empty = inspectOpeningPrefixCoverage(...single.args()).cases[1]
  assert.deepEqual(empty.directions.map(d => d.requiredInput), [0n, 0n])
  assert.equal(empty.ordersHash, keccak256(encodeAbiParameters([{ type: 'tuple[]', components: ORDER_COMPONENTS }], [[]])))
})
test('unrequested directions and even their missing zero point stay explicit rather than invented', async () => {
  for (const overrides of [undefined, [{ budget: 5n }]]) {
    const f = await fixture({ overrides, oneDirection: true }), r = inspectOpeningPrefixCoverage(...f.args()), d = r.cases[0].directions[1]
    assert.equal(d.domainPresent, false); assert.equal(d.representedInputs, 0n); assert.equal(d.firstMissing, 0n)
    assert.equal(d.missingInputs, d.requiredInput + 1n); assert.equal(r.wholeInputPrefixesAvailable, false)
    assert.throws(() => requireWholeInputOpeningPrefixes(...f.args()), /Original opening prefixes/)
  }
})
test('supported partial consumption is represented but cannot become a full requested-input model', async () => {
  const f = await fixture({ downLimit: sqrtPriceAtTick(-1) }), r = inspectOpeningPrefixCoverage(...f.args()), d = r.cases[0].directions[0]
  assert.equal(d.missingInputs, 0n); assert.equal(d.unsupportedAt.length, 0); assert.equal(d.supportedPrefixRepresented, true)
  assert.ok(d.partialAt.length > 0); assert.equal(d.wholeInputPrefixAvailable, false)
  assert.equal(r.wholeInputPrefixesAvailable, false); assert.throws(() => requireWholeInputOpeningPrefixes(...f.args()), /partially consumed/)
  assert.ok(f.frame.curves[0].points.some(q => q.status === Status.PriceLimit && q.consumedInput < q.requestedInput))
})
test('unsupported diagnostics are separate from missing/partial capacity; the model zero no-op stays supported', async () => {
  const f = await fixture({ downLimit: 0n }), d = inspectOpeningPrefixCoverage(...f.args()).cases[0].directions[0]
  assert.equal(d.missingInputs, 0n); assert.deepEqual(d.unsupportedAt, [1n, 2n, 3n, 4n, 5n]); assert.deepEqual(d.partialAt, [])
  assert.equal(d.supportedPrefixRepresented, false); assert.equal(d.wholeInputPrefixAvailable, false)
})
test('a supported required prefix is not vetoed by partial diagnostic rows beyond the original budget', async () => {
  const f = await fixture({ cap: 8n, downLimit: sqrtPriceAtTick(-1), overrides: [{ budget: 1n }] })
  assert.ok(f.frame.curves[0].points.slice(2).some(q => q.consumedInput < q.requestedInput))
  const r = requireWholeInputOpeningPrefixes(...f.args())
  assert.equal(r.cases[0].directions[0].representedInputs, 2n); assert.deepEqual(r.cases[0].directions[0].partialAt, [])
})
test('mutated records, quotes and original orders are revalidated rather than trusting old successful report flags', async () => {
  for (const kind of ['owner', 'weight', 'header', 'quote', 'ask', 'budget', 'trader', 'sequence'] as const) {
    const f = await fixture(); requireWholeInputOpeningPrefixes(...f.args())
    if (kind === 'owner') f.record.positions[0].owner = addr(99)
    if (kind === 'weight') (f.record.weights as bigint[])[0]++
    if (kind === 'header') f.frame.snapshot.liquidity++
    if (kind === 'quote') f.frame.curves[0].points[1].output++
    if (kind === 'ask') f.orders[0].ask++
    if (kind === 'budget') f.orders[0].budget++
    if (kind === 'trader') f.orders[0].trader = addr(99)
    if (kind === 'sequence') f.orders.reverse()
    assert.throws(() => requireWholeInputOpeningPrefixes(...f.args()), /mismatch|changed/)
  }
})
test('valid but different curve content cannot inherit an older anchor, even with internally consistent rows', async () => {
  const f = await fixture(); f.frame.curves[0].domain.maxInput = 4n
  ;(f.frame.curves[0] as { points: unknown }).points = f.frame.curves[0].points.slice(0, 5)
  assert.notEqual(bindOpeningExecution(f.anchor, f.record, f.frame).curvesHash, f.anchor.curvesHash)
  assert.throws(() => inspectOpeningPrefixCoverage(...f.args()), /Coverage opening content changed/)
  for (const field of ['ordersHash', 'domainSeparator', 'budget0', 'budget1'] as const) {
    const f = await fixture()
    if (typeof f.anchor[field] === 'bigint') (f.anchor as any)[field]++
    else (f.anchor as any)[field] = zeroHash
    assert.throws(() => inspectOpeningPrefixCoverage(...f.args()), /Coverage batch content changed/)
  }
})
test('coverage hash is the declared normalized ABI inventory and frozen results outlive later input mutation', async () => {
  const f = await fixture(), r = inspectOpeningPrefixCoverage(...f.args()), a = f.anchor, saved = structuredClone(r)
  assert.equal(r.coverageHash, keccak256(encodeAbiParameters(COVERAGE_ABI, [COVERAGE_TYPEHASH, a.chainId, a.book, a.poolId,
    a.epoch, a.configVersion, a.blockNumber, a.blockHash, a.snapshotHash, a.curvesHash, a.ordersHash, a.batchDigest, r.cases])))
  f.orders[0].budget++; f.frame.curves[0].points[1].output++; assert.deepEqual(r, saved)
})
test('64 seeded inventories independently cover every record/address removal up to the 32-record bound', async () => {
  let seed = 0x4f747465
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let run = 0; run < 64; ++run) {
    const n = run === 0 ? 32 : 1 + random() % 32
    const overrides = Array.from({ length: n }, (_, i) => ({ trader: addr(100 + (run === 0 ? i : random() % 5)),
      sellingCurrency0: !!(random() & 1), budget: BigInt(1 + random() % 3), ask: BigInt(random()) }))
    const f = await fixture({ cap: 64n, overrides }), r = inspectOpeningPrefixCoverage(...f.args())
    assert.equal(r.cases.length, 1 + n + new Set(f.orders.map(o => o.trader)).size); assert.ok(r.cases.length <= 65)
    for (const c of r.cases) {
      const retained = f.orders.filter((_, i) => !c.omittedIndices.includes(i))
      for (const d of c.directions) {
        assert.equal(d.requiredInput, retained.filter(o => o.sellingCurrency0 === d.down).reduce((b, o) => b + o.budget, 0n))
        const quotes = f.frame.curves.find(x => x.domain.down === d.down)!.points.filter(q => q.requestedInput <= d.requiredInput)
        const supported = quotes.filter(q => q.status === Status.Complete || q.status === Status.PriceLimit)
        assert.equal(d.representedInputs, BigInt(quotes.length)); assert.equal(d.missingInputs, d.requiredInput + 1n - BigInt(quotes.length))
        assert.equal(d.unsupportedAt.length, quotes.length - supported.length)
        assert.equal(d.partialAt.length, supported.filter(q => q.consumedInput !== q.requestedInput).length)
        assert.equal(d.wholeInputPrefixAvailable, d.missingInputs === 0n && supported.length === quotes.length && supported.every(q => q.consumedInput === q.requestedInput))
      }
    }
  }
})
