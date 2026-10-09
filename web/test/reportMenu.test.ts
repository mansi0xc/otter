import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeAbiParameters, keccak256, type Address } from 'viem'
import { inspectBoundAskResponses, MENU_TYPEHASH, MENU_RESULT_COMPONENTS, type ReportProfile, type MenuAnalysis } from '../src/protocol/reportMenu.ts'
import { coverageFixture } from './epoch-batch-fixture.ts'
import { bindOpeningExecution, openingCommitment } from '../src/protocol/openingExecution.ts'
import { quoteExactInput, sqrtPriceAtTick, MAX_OUTPUT } from '../../solver/src/execution.ts'
import { capitalWeight } from '../../solver/src/rewards.ts'
import { WAD } from '../../solver/src/discrete-research.ts'
import type { Order } from '../src/protocol/orders.ts'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const asks = [WAD / 16n, WAD / 8n, 3n * WAD / 16n]
async function profile(ask: bigint, overrides: Partial<Order>[] = [{ budget: 2n }, { budget: 2n, ask: WAD / 8n }], scarce = false) {
  const f = await coverageFixture({ cap: 8n, overrides: overrides.map((o, i) => ({ trader: addr(200 + i), ...o, ...(i === 0 ? { ask } : {}) })) })
  if (scarce) {
    f.record.positions = [{ ...f.record.positions[0], liquidity: 2n }]
    f.record.pool.activeLiquidity = 2n; f.record.pool.totalLiquidity = 2n
    f.frame.snapshot.liquidity = 2n; f.frame.snapshot.bitmap = new Map(Array.from({ length: 32 }, (_, i) => [i - 16, 0n]))
    f.frame.snapshot.ticks = new Map(); f.frame.stateReads = 34
    f.record.weights = f.record.positions.map(p => capitalWeight(f.record.pool.sqrtPriceX96, p.tickLower, p.tickUpper, p.liquidity).weight)
    f.record.totalWeight = f.record.weights.reduce((a, b) => a + b, 0n)
    f.frame.curves[0].domain.limit = sqrtPriceAtTick(-60000); f.frame.curves[1].domain.limit = sqrtPriceAtTick(60000)
    rebind(f)
  }
  return f
}
function rebind(f: Awaited<ReturnType<typeof coverageFixture>>) {
  f.record.pool.positionsHash = openingCommitment(f.record).positionsHash
  f.anchor.snapshotHash = openingCommitment(f.record).snapshotHash
  for (const c of f.frame.curves) (c as { points: unknown }).points = Array.from({ length: Number(c.domain.maxInput) + 1 }, (_, i) =>
    quoteExactInput(f.frame.snapshot, c.domain.down, BigInt(i), c.domain.limit))
  Object.assign(f.anchor, bindOpeningExecution(f.anchor, f.record, f.frame))
}
const inputs = (fs: Awaited<ReturnType<typeof profile>>[]): ReportProfile[] => fs.map(f => ({ anchor: f.anchor, record: f.record, frame: f.frame, orders: f.orders }))
function checkCertificate(r: ReturnType<typeof inspectBoundAskResponses>, a: Readonly<MenuAnalysis>, funded: boolean) {
  if (a.kind === 0) { assert.ok(funded && r.reports.some(p => p.otherMinimumDeficit > 0n)); assert.equal(a.payments.length, 0); return }
  const lower = r.reports.map(p => funded ? p.minimumPayment : 0n), upper = r.reports.map(p => funded ? p.availablePayment : MAX_OUTPUT)
  if (a.kind === 1) {
    assert.equal(a.payments.length, r.reports.length)
    for (let i = 0; i < r.reports.length; ++i) {
      assert.ok(a.payments[i] >= lower[i] && a.payments[i] <= upper[i])
      for (let j = 0; j < r.reports.length; ++j) assert.ok(WAD * (a.payments[i] - a.payments[j]) >= r.reports[i].ask * (r.reports[i].input - r.reports[j].input))
    }
  } else {
    let weight = 0n; const seen = new Set<number>(), n = r.reports.length
    for (const [i, e] of a.cycle.entries()) {
      assert.ok(!seen.has(e.from)); seen.add(e.from); assert.equal(e.to, a.cycle[(i + 1) % a.cycle.length].from)
      if (e.kind === 0) {
        assert.ok(e.from < n && e.to < n && e.from !== e.to)
        assert.ok(e.limit * WAD <= r.reports[e.from].ask * (r.reports[e.to].input - r.reports[e.from].input))
        assert.ok((e.limit + 1n) * WAD > r.reports[e.from].ask * (r.reports[e.to].input - r.reports[e.from].input))
      } else if (e.kind === 1) { assert.equal(e.to, n); assert.equal(e.limit, -lower[e.from]) }
      else { assert.equal(e.kind, 2); assert.equal(e.from, n); assert.equal(e.limit, upper[e.to]) }
      weight += e.limit
    }
    assert.equal(weight, a.cycleWeight); assert.ok(weight < 0n)
  }
}
test('complete scarce opening profiles expose incentive-only integer impossibility despite funded signed minima', async () => {
  const fs = await Promise.all(asks.map(a => profile(a, undefined, true))), r = inspectBoundAskResponses(inputs(fs), 0)
  assert.equal(r.reports[0].input, 2n); assert.equal(r.reports[2].input, 0n)
  assert.ok(r.reports.every(p => p.minimumPayment + p.otherMinimumPayment <= p.output && p.pivotCeilDeficit === 0n))
  assert.equal(r.loose.kind, 2); assert.equal(r.loose.cycleWeight, -1n); assert.ok(r.loose.cycle.every(e => e.kind === 0))
  assert.equal(r.funded.kind, 2); checkCertificate(r, r.loose, false); checkCertificate(r, r.funded, true)
  assert.equal(WAD * r.reports[0].ceilPivotPayment - asks[2] * r.reports[0].input, 5n * WAD / 8n)
  assert.equal(WAD * r.reports[2].ceilPivotPayment - asks[2] * r.reports[2].input, 0n)
})
test('a constant-input response can satisfy the finite necessary constraints without proving a complete mechanism', async () => {
  const fs = await Promise.all(asks.map(a => profile(a))), r = inspectBoundAskResponses(inputs(fs), 0)
  assert.ok(r.reports.every(p => p.input === 2n)); assert.equal(r.loose.kind, 1); assert.equal(r.funded.kind, 1)
  checkCertificate(r, r.loose, false); checkCertificate(r, r.funded, true)
})
test('delivery bounds can fail even when loose integer truthfulness is feasible', async () => {
  const fs = await Promise.all([WAD / 8n, WAD / 4n, WAD / 2n].map(a => profile(a, [{ budget: 1n }, { budget: 1n, ask: WAD / 4n }]))), r = inspectBoundAskResponses(inputs(fs), 0)
  assert.equal(r.loose.kind, 1); assert.equal(r.funded.kind, 2); assert.ok(r.reports.every(p => p.minimumPayment > p.availablePayment))
  checkCertificate(r, r.funded, true)
})
test('negative room for other original minima remains a deficit and never becomes a funded zero-budget analysis', async () => {
  const fs = await Promise.all([(1n << 128n) - 3n, (1n << 128n) - 2n].map(a => profile(a, [{ budget: 1n }, { budget: 1n, ask: WAD / 4n }, { budget: 1n, ask: WAD / 4n }]))), r = inspectBoundAskResponses(inputs(fs), 0)
  assert.ok(r.reports.every(p => p.otherMinimumDeficit === 1n && p.availablePayment === 0n)); assert.equal(r.funded.kind, 0)
  checkCertificate(r, r.funded, true); assert.equal(r.loose.kind, 1)
})
test('every original field except selected ask, including true budget and order sequence, must remain fixed', async () => {
  for (const edit of [{ budget: 3n }, { nonce: 2n }, { deadline: 999n }, { maxExecutionTime: 2000n }, { trader: addr(250) }]) {
    const a = await profile(asks[0]), b = await profile(asks[2], [{ budget: 2n, ...edit }, { budget: 2n, ask: WAD / 8n }])
    assert.throws(() => inspectBoundAskResponses(inputs([a, b]), 0), /same opening context and every original field/)
  }
  const a = await profile(asks[0]), b = await profile(asks[2], [{ budget: 2n }, { budget: 2n, ask: WAD / 7n }])
  assert.throws(() => inspectBoundAskResponses(inputs([a, b]), 0), /same opening context/)
})
test('different fresh opening, curve, block and manager runtime contexts cannot form one report menu', async () => {
  for (const edit of ['owner', 'curve', 'block', 'runtime']) {
    const a = await profile(asks[0]), b = await profile(asks[2])
    if (edit === 'owner') { (b.record.positions as any)[1].owner = addr(299); rebind(b) }
    if (edit === 'curve') { b.frame.curves[0].domain.limit = sqrtPriceAtTick(-1300); rebind(b) }
    if (edit === 'block') { b.anchor.blockNumber++; b.frame.blockNumber++; rebind(b) }
    if (edit === 'runtime') b.frame.source.runtimeHash = `0x${'23'.repeat(32)}`
    assert.throws(() => inspectBoundAskResponses(inputs([a, b]), 0), /same opening context/)
  }
})
test('multiple target records and known opening LP ownership refuse the single-role participant hypothesis', async () => {
  const repeated = await profile(asks[0], [{ budget: 2n }, { budget: 2n, trader: addr(200) }])
  assert.throws(() => inspectBoundAskResponses(inputs([repeated]), 0), /exactly one original record/)
  const owner = await profile(asks[0]); (owner.record.positions as any)[0].owner = addr(200); rebind(owner)
  assert.throws(() => inspectBoundAskResponses(inputs([owner]), 0), /opening LP position/)
})
test('report count, duplicate asks, absent targets and incomplete original domains are refused', async () => {
  const f = await profile(asks[0])
  for (const [ps, index] of [[[], 0], [inputs([f]), -1], [inputs([f]), 8], [inputs([f]), 2], [Array(17).fill(inputs([f])[0]), 0], [inputs([f, f]), 0]] as const)
    assert.throws(() => inspectBoundAskResponses(ps as ReportProfile[], index), /requires|absent|distinct/)
  const incomplete = await profile(asks[0], [{ budget: 9n }])
  assert.throws(() => inspectBoundAskResponses(inputs([incomplete]), 0), /Original opening prefixes/)
})
test('sixteen reports, maximum nonce and opposite currencies preserve the bounded finite menu', async () => {
  const fs = await Promise.all(Array.from({ length: 16 }, (_, i) => profile(BigInt(i) * WAD / 32n, [{ budget: 2n, sellingCurrency0: false, nonce: (1n << 256n) - 1n }, { budget: 2n, sellingCurrency0: false, ask: WAD / 8n }])))
  const r = inspectBoundAskResponses(inputs(fs), 0); assert.equal(r.reports.length, 16); assert.equal(r.down, false); assert.equal(r.soldCurrency, fs[0].record.pool.key.currency1)
  checkCertificate(r, r.loose, false); checkCertificate(r, r.funded, true)
})
test('menu ABI hash and deep freeze detach certificates while all inputs are revalidated', async () => {
  const fs = await Promise.all(asks.map(a => profile(a, undefined, true))), before = structuredClone(inputs(fs)), r = inspectBoundAskResponses(inputs(fs), 0), saved = structuredClone(r)
  assert.deepEqual(inputs(fs), before)
  assert.equal(r.menuHash, keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'tuple', components: MENU_RESULT_COMPONENTS }], [MENU_TYPEHASH, r])))
  for (const obj of [r, r.reports, ...r.reports, r.loose, r.funded, r.loose.payments, r.funded.payments, r.loose.cycle, r.funded.cycle, ...r.loose.cycle, ...r.funded.cycle]) assert.ok(Object.isFrozen(obj))
  fs[0].orders[0].ask++; assert.deepEqual(r, saved); assert.throws(() => inspectBoundAskResponses(inputs(fs), 0), /mismatch|changed/)
})
test('64 seeded report menus independently verify direct utilities or closed exact floor cycles', async () => {
  let seed = 0x536d656e; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
  for (let run = 0; run < 64; ++run) {
    const budget = BigInt(1 + random() % 3), otherBudget = BigInt(1 + random() % 3), otherAsk = BigInt(random() % 17) * WAD / 8n, down = !!(random() & 1)
    const fs = await Promise.all([0n, WAD / 8n, 5n * WAD / 8n].map(a => profile(a, [{ budget, sellingCurrency0: down }, { budget: otherBudget, sellingCurrency0: down, ask: otherAsk }])))
    const r = inspectBoundAskResponses(inputs(fs), 0); checkCertificate(r, r.loose, false); checkCertificate(r, r.funded, true)
    assert.ok(r.reports.every(p => p.input <= r.trueBudget))
  }
})
