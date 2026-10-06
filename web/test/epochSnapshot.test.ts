import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeFunctionData, encodeFunctionResult, keccak256, zeroAddress, type Address, type Hash, type Hex } from 'viem'
import { captureEpochExecution, epochReads, EPOCH_ABI, EPOCH_TARGETS, MAX_EPOCH_VIEW_READS, type EpochSource, type EpochRequest } from '../src/protocol/epochSnapshot.ts'
import { openingCommitment, OPENING_TYPEHASH, type OpeningRecord } from '../src/protocol/openingExecution.ts'
import { executionPoolId, executionSlots, EXTSLOAD_ABI, type SnapshotRpc } from '../src/protocol/executionSnapshot.ts'
import { Q96, sqrtPriceAtTick, bitmapPosition, Status } from '../../solver/src/execution.ts'
import { capitalWeight } from '../../solver/src/rewards.ts'
import { fixture } from './epoch-batch-fixture.ts'
const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
const word = (n: bigint) => `0x${n.toString(16).padStart(64, '0')}` as Hex
test('epoch collector binds every read and quote to one block and checked contract context', async () => {
  const f = fixture(), result = await captureEpochExecution(f.rpc, f.source, { ...f.request, blockNumber: f.state.number })
  assert.equal(result.binding.snapshotHash, openingCommitment(f.record).snapshotHash); assert.equal(result.binding.pointCount, 18)
  assert.equal(result.eligibility.blockTimestamp, 1060n); assert.equal(result.eligibility.exclusiveUntil, 1360n)
  assert.equal(result.eligibility.count, 1); assert.equal(result.record.weights[1], 0n)
  assert.ok(Object.isFrozen(result.binding)); assert.ok(Object.isFrozen(result.eligibility))
  assert.equal(f.reads.length, MAX_EPOCH_VIEW_READS)
  assert.equal(f.state.calls.filter(c => c.method === 'eth_call').length, 36 + result.frame.stateReads)
  assert.equal(f.state.calls.filter(c => c.method === 'eth_getCode').length, 6)
  assert.equal(f.state.blockReads, 4); assert.equal(f.state.chainReads, 4)
  for (const c of f.state.calls.filter(c => c.method === 'eth_getCode' || c.method === 'eth_call')) assert.deepEqual(c.params[1], { blockHash: f.state.hash, requireCanonical: true })
})
test('read-only getter ABI types and tuple layout agree with actual Foundry artifacts', () => {
  const artifacts = ['OtterOrderBook', 'OtterHook', 'OtterLiquidityVault', 'OtterSettlement'].flatMap(n => JSON.parse(readFileSync(new URL(`../../contracts/out/${n}.sol/${n}.json`, import.meta.url), 'utf8')).abi)
  const shape = (p: any): any => ({ type: p.type, ...(p.components ? { components: p.components.map(shape) } : {}) })
  for (const fn of EPOCH_ABI) assert.ok(artifacts.some(a => a.type === 'function' && a.name === fn.name
    && a.stateMutability === 'view' && JSON.stringify(a.inputs.map(shape)) === JSON.stringify(fn.inputs.map(shape))
    && JSON.stringify(a.outputs.map(shape)) === JSON.stringify(fn.outputs.map(shape))), fn.name)
})
test('all five runtime fingerprints fail closed without a provider fallback', async () => {
  for (const t of EPOCH_TARGETS) {
    const f = fixture(); f.codes.set(f.source.contracts[t].address, '0x6000')
    await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /runtime fingerprint/)
    assert.equal(f.state.calls.filter(c => c.method === 'eth_call').length, 0)
  }
})
test('every registration, immutable wiring, policy and configuration field is checked', async () => {
  for (const [id, changed] of [
    ['book.SNAPSHOT_TYPEHASH', hash(99)], ['book.registered', false], ['book.currency0Of', addr(99)], ['book.currency1Of', addr(99)],
    ['book.configVersionOf', 2n], ['book.liquidityGuardOf', addr(99)], ['book.rewardPolicyHashOf', hash(99)], ['book.settlement', addr(99)],
    ['settlement.orderBook', addr(99)], ['settlement.poolManager', addr(99)], ['settlement.approvedHook', addr(99)],
    ['hook.poolManager', addr(99)], ['hook.settlement', addr(99)], ['hook.orderBook', addr(99)], ['hook.liquidityVault', addr(99)],
    ['guard.poolManager', addr(99)], ['guard.orderBook', addr(99)], ['guard.hook', addr(99)],
  ] as const) { const f = fixture(); f.values.set(id, changed); await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /mismatch/) }
})
test('only the current nonterminal unconsumed closed epoch is eligible', async () => {
  for (const [id, changed] of [['book.currentBatchId', 1n], ['book.executionInProgress', true], ['book.escrowReleased', true],
    ['book.payoutsCredited', true], ['book.batches', [1060n, 0, false]], ['book.batches', [1060n, 33, false]],
    ['book.batches', [1060n, 1, true]], ['book.executionDeadline', 1060n], ...[0, 1, 3, 4, 5].map(n => ['book.batchState', n])] as [string, unknown][]) {
    const f = fixture(); f.values.set(id, changed); await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /mismatch|window/)
  }
})
test('clock boundaries and existing solver exclusivity match the current contract rule', async () => {
  for (const now of [1059n, 1960n, 1961n]) { const f = fixture(); f.state.timestamp = now; await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /closed execution window/) }
  for (const now of [1060n, 1359n]) { const f = fixture(); f.state.timestamp = now; f.request.caller = addr(101); await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /solver-only/) }
  for (const now of [1360n, 1959n]) { const f = fixture(); f.state.timestamp = now; f.request.caller = addr(101); assert.equal((await captureEpochExecution(f.rpc, f.source, f.request)).eligibility.caller, addr(101)) }
  const impossible = fixture(); impossible.values.set('settlement.exclusivityWindow', 900n)
  await assert.rejects(captureEpochExecution(impossible.rpc, impossible.source, impossible.request), /exclusivity conflicts/)
})
test('actual view reverts and missing core state abort the entire collection', async () => {
  for (const name of ['book.assertSnapshot', 'guard.assertBatchSupported', 'book.openingPositions']) {
    const f = fixture(), original = f.rpc
    const failing: SnapshotRpc = async (m, p) => {
      const r = f.reads.find(r => (p[0] as any)?.data === r.data && (p[0] as any)?.to === r.target)
      if (m === 'eth_call' && r?.id === name) throw new Error('epoch view reverted')
      return original(m, p)
    }
    await assert.rejects(captureEpochExecution(failing, f.source, f.request), /view reverted/)
  }
  const f = fixture(); f.storage.delete(f.slots.bitmap(-1)); await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /Missing epoch core word/)
})
test('malformed, oversized, noncanonical and hostile dynamic ABI results are rejected', async () => {
  const f = fixture(), positions = f.reads.find(r => r.name === 'openingPositions')!
  const valid = encodeFunctionResult({ abi: EPOCH_ABI, functionName: positions.name, result: f.record.positions })
  for (const [id, raw] of [['book.registered', '0x'], ['book.currentBatchId', word(0n) + '00'], ['book.registered', word(2n)],
    ['book.openingPositions', '0x' + '00'.repeat(6001)], ['book.openingPositions', word(64n) + valid.slice(66)],
    ['book.openingPositions', word(32n) + word((1n << 256n) - 1n).slice(2)], ['book.openingRewardWeights', word(32n) + word(0n).slice(2)]] as const) {
    const x = fixture(); x.responses.set(id, raw); await assert.rejects(captureEpochExecution(x.rpc, x.source, x.request))
  }
})
test('changed hashes or timestamps at inner and final rechecks never return mixed-block results', async () => {
  for (const stage of [1, 2, 3]) for (const kind of ['hash', 'timestamp'] as const) {
    const f = fixture(), original = f.rpc
    const changed: SnapshotRpc = async (m, p) => {
      const r = await original(m, p)
      return m === 'eth_getBlockByNumber' && f.state.blockReads > stage ? { ...(r as any), [kind]: kind === 'hash' ? hash(99) : '0x425' } : r
    }
    await assert.rejects(captureEpochExecution(changed, f.source, f.request), /changed/)
  }
})
test('chain drift at each recheck and wrong numbered/missing blocks fail closed', async () => {
  for (const stage of [0, 1, 2, 3]) {
    const f = fixture(), original = f.rpc
    const changed: SnapshotRpc = async (m, p) => { const r = await original(m, p); return m === 'eth_chainId' && f.state.chainReads > stage ? '0x1' : r }
    await assert.rejects(captureEpochExecution(changed, f.source, f.request), /chain/)
  }
  for (const raw of [null, { number: '0x00', hash: hash(1), timestamp: '0x1' }, { number: '0x1', hash: hash(1) },
    { number: '0x1', hash: hash(1), timestamp: '0x1' }]) {
    const f = fixture(), original = f.rpc
    await assert.rejects(captureEpochExecution(async (m, p) => m === 'eth_getBlockByNumber' ? raw : original(m, p), f.source, { ...f.request, blockNumber: f.state.number }))
  }
})
test('caller controls are copied before awaits and malformed controls cause no RPC', async () => {
  const f = fixture(), source = structuredClone(f.source), request = structuredClone(f.request)
  f.state.onRpc = () => { source.chainId = 1n; source.contracts.book.address = addr(99); source.key.hooks = addr(99); request.caller = addr(99); request.epoch = 1n; request.domains[0].maxInput = 64n }
  const captured = await captureEpochExecution(f.rpc, source, request)
  assert.equal(captured.binding.chainId, 31337n); assert.equal(captured.eligibility.caller, addr(100)); assert.equal(captured.binding.pointCount, 18)
  for (const mutate of [
    (s: EpochSource, r: EpochRequest) => { s.configVersion = 0n }, (s: EpochSource, r: EpochRequest) => { s.contracts.guard.address = s.contracts.book.address },
    (s: EpochSource, r: EpochRequest) => { s.key.hooks = zeroAddress }, (s: EpochSource, r: EpochRequest) => { s.key.fee = 1 },
    (s: EpochSource, r: EpochRequest) => { r.epoch = -1n }, (s: EpochSource, r: EpochRequest) => { r.caller = zeroAddress },
    (s: EpochSource, r: EpochRequest) => { r.domains[0].maxInput = 65n }, (s: EpochSource, r: EpochRequest) => { r.domains[1].down = true },
  ]) { const x = fixture(); mutate(x.source, x.request); await assert.rejects(captureEpochExecution(x.rpc, x.source, x.request)); assert.equal(x.state.calls.length, 0) }
})
test('stored roster/weight/root corruption cannot become an accepted epoch', async () => {
  for (const kind of ['root', 'weight', 'owner', 'futureOpening', 'header'] as const) {
    const f = fixture()
    if (kind === 'root') f.values.set('book.snapshotHash', hash(99))
    if (kind === 'weight') (f.values.get('book.openingRewardWeights') as bigint[])[0]++
    if (kind === 'owner') f.record.positions[0].owner = addr(99)
    if (kind === 'futureOpening') f.values.set('book.openingBlock', f.state.number + 1n)
    if (kind === 'header') f.storage.set(f.slots.liquidity, word(999n))
    await assert.rejects(captureEpochExecution(f.rpc, f.source, f.request), /mismatch/)
  }
})
test('partial and unsupported curves retain statuses; zero prefixes and zero configured solver remain read-only', async () => {
  const f = fixture(); f.request.domains[0].limit = sqrtPriceAtTick(-1)
  const partial = await captureEpochExecution(f.rpc, f.source, f.request)
  assert.ok(partial.frame.curves[0].points.some(q => q.status === Status.PriceLimit))
  const unsupported = fixture(); unsupported.request.domains[0].limit = 0n
  assert.ok((await captureEpochExecution(unsupported.rpc, unsupported.source, unsupported.request)).frame.curves[0].points.some(q => q.status === Status.UnsupportedPrice))
  const zero = fixture(); zero.values.set('settlement.solver', zeroAddress); zero.state.timestamp = 1360n
  zero.request.domains.forEach(d => { d.maxInput = 0n })
  assert.equal((await captureEpochExecution(zero.rpc, zero.source, zero.request)).binding.pointCount, 2)
})
