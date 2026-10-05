import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, hashDomain, keccak256, stringToHex, zeroAddress, type Address, type Hash, type Hex, type PublicClient, type WalletClient } from 'viem'
import { ORDER_BOOK_ABI, SETTLEMENT_ABI, REWARD_LEDGER_ABI, LIQUIDITY_VAULT_ABI } from '../src/protocol/abi.ts'
import { parseDeployment, uint, type Deployment } from '../src/protocol/deployment.ts'
import { exactUnits, freeNonce, nonceMask, orderAmounts, orderDigest, orderHash, typedOrder, type Order } from '../src/protocol/orders.ts'
import { approveBudget, checkDeployment, claim, expireEpoch, invalidateNonce, readClaims, readEpoch, recoverOrder, submitOrder, readVaultPosition, requestVaultExit, processVaultExit, type Call, type Receipt, type Transport } from '../src/protocol/client.ts'
import { viemTransport } from '../src/protocol/viemTransport.ts'

const addr = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hash
const account = addr(100), other = addr(101), txHash = hash(999)
const targets = ['orderBook', 'settlement', 'rewardLedger', 'liquidityGuard'] as const
const codes = new Map(targets.map((_, i) => [addr(i + 1), `0x60${(i + 1).toString(16).padStart(2, '0')}` as Hex]))
function rawManifest(native = false) {
  return { chainId: 11155111, poolId: hash(50), configVersion: '1', rewardPolicyHash: hash(51),
    contracts: Object.fromEntries(targets.map((name, i) => [name, { address: addr(i + 1), runtimeHash: keccak256(codes.get(addr(i + 1))!) }])),
    assets: [{ address: native ? zeroAddress : addr(10), symbol: native ? 'ETH' : 'A', decimals: 18 }, { address: addr(11), symbol: 'B', decimals: 18 }] }
}
const deployment = (native = false) => parseDeployment(rawManifest(native))!
const quiet = () => {}
function fake(d = deployment()) {
  const s = { now: 1000n, chain: 11155111, walletChain: 11155111, wallet: account, state: 1, epoch: 7n, closesAt: 1060n,
    executeUntil: 1360n, config: 1n, count: 1, paused: false, allowance: 0n, nonceWords: new Map<bigint, bigint>(),
    badCode: false, badDomain: false, badWiring: false, badDecimals: false, recovered: false, receiptStatus: 'success' as Receipt['status'],
    noEvent: false, wrongEvent: false, duplicateEvent: false, readFailure: '', simulateFailure: '',
    badVaultBook: false, positionOwner: account, positionPool: d.poolId, liquidity: 100n, queued: 0n, active: true,
    vaultClaims: [9n, 8n], exitFailure: '', readBlocks: [] as { name: string; block: bigint | undefined }[], onRead: () => {},
    signCount: 0, signed: null as Order | null, simulations: [] as Call[], sent: [] as Call[], reads: [] as Call[],
    onSign: () => {}, onSimulate: () => {}, onWait: () => {} }
  const io: Transport = {
    chainId: async () => s.chain, block: async () => ({ number: 10n, timestamp: s.now }),
    code: async a => s.badCode ? '0x' : codes.get(a),
    session: async () => ({ address: s.wallet, chainId: s.walletChain }),
    read: async (c, block) => {
      s.reads.push(c)
      s.readBlocks.push({ name: c.functionName, block }); s.onRead()
      if (c.functionName === s.readFailure) throw new Error('read unavailable')
      const b = d.contracts.orderBook.address, settle = d.contracts.settlement.address, ledger = d.contracts.rewardLedger.address
      switch (c.functionName) {
        case 'DOMAIN_SEPARATOR': return hashDomain({ domain: { ...typedOrder(d, {} as Order).domain, chainId: BigInt(d.chainId), version: s.badDomain ? '1' : '2' }, types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } })
        case 'ORDER_TYPEHASH': return keccak256(stringToHex('Order(address trader,bytes32 poolId,bool sellingCurrency0,uint256 ask,uint256 budget,uint256 deadline,uint256 nonce,uint256 configVersion,uint256 epoch,uint256 maxExecutionTime)'))
        case 'SNAPSHOT_TYPEHASH': return keccak256(stringToHex('OtterOpeningSnapshot/v2'))
        case 'settlement': return s.badWiring ? other : settle
        case 'orderBook': return c.address === d.contracts.liquidityGuard.address && s.badVaultBook ? other : b
        case 'rewardLedger': return ledger
        case 'registered': return true
        case 'currency0Of': return d.assets[0].address
        case 'currency1Of': return d.assets[1].address
        case 'configVersionOf': return s.config
        case 'liquidityGuardOf': return d.contracts.liquidityGuard.address
        case 'rewardPolicyHashOf': case 'policyHashOf': return d.rewardPolicyHash
        case 'decimals': return s.badDecimals ? 6 : d.assets.find(a => a.address === c.address)!.decimals
        case 'allowance': return s.allowance
        case 'admissionPaused': return s.paused
        case 'previewEpoch': return [s.epoch, s.closesAt, s.executeUntil, s.config]
        case 'nonceBitmap': return s.nonceWords.get(c.args![1] as bigint) ?? 0n
        case 'currentBatchId': return s.epoch
        case 'batches': return [s.closesAt, s.count, s.state === 4 || s.state === 5]
        case 'batchState': return s.state
        case 'executionDeadline': return s.executeUntil
        case 'orderRecovered': return s.recovered
        case 'getOrders': return [s.signed ?? { trader: account }]
        case 'claimable': return c.address === b ? 12n : 5n
        case 'claims': return s.vaultClaims[c.args![1] === d.assets[0].address ? 0 : 1]
        case 'positions': return [s.positionOwner, s.positionPool, -120, 120, s.liquidity]
        case 'queuedLiquidity': return s.queued
        case 'isBatchActive': return s.active
        default: throw new Error(`Unexpected read ${c.functionName}`)
      }
    },
    sign: async data => { s.signCount++; s.signed = data.message; s.onSign(); return `0x${'11'.repeat(65)}` },
    simulate: async c => { s.simulations.push(c); s.onSimulate(); if (c.functionName === s.simulateFailure) throw new Error('simulation reverted'); return c },
    send: async request => { s.sent.push(request as Call); return txHash },
    wait: async () => {
      s.onWait()
      const c = s.sent.at(-1)!
      if (c.functionName === 'approve' && s.receiptStatus === 'success') s.allowance = c.args![1] as bigint
      const logs: Receipt['logs'][number][] = []
      if (c.functionName === 'submit' && !s.noEvent) {
        const o = s.signed!, event = ORDER_BOOK_ABI.find(a => a.type === 'event' && a.name === 'OrderSubmitted')!
        const eventInputs = event.type === 'event' ? event.inputs.filter(a => !a.indexed) : []
        const log = { address: d.contracts.orderBook.address, topics: encodeEventTopics({ abi: ORDER_BOOK_ABI, eventName: 'OrderSubmitted', args: { poolId: d.poolId, batchId: o.epoch, trader: account } }),
          data: encodeAbiParameters(eventInputs, [0, s.wrongEvent ? hash(444) : orderHash(o), o]) }
        logs.push(log); if (s.duplicateEvent) logs.push(log)
      }
      if (['requestExit', 'processExit'].includes(c.functionName) && s.exitFailure !== 'missing') {
        const processing = c.functionName === 'processExit'
        const eventName = (processing !== (s.exitFailure === 'kind')) ? 'ExitProcessed' : 'ExitRequested'
        const owner = s.exitFailure === 'owner' ? other : account, poolId = s.exitFailure === 'pool' ? hash(888) : d.poolId
        const positionId = s.exitFailure === 'id' ? 2n : c.args![0] as bigint
        const liquidity = (processing ? s.queued : c.args![1] as bigint) + (s.exitFailure === 'amount' ? 1n : 0n)
        const event = LIQUIDITY_VAULT_ABI.find(a => a.type === 'event' && a.name === eventName)!
        const inputs = event.type === 'event' ? event.inputs.filter(a => !a.indexed) : []
        const log = { address: s.exitFailure === 'address' ? other : d.contracts.liquidityGuard.address,
          topics: encodeEventTopics({ abi: LIQUIDITY_VAULT_ABI, eventName, args: { positionId, poolId, owner } }),
          data: encodeAbiParameters(inputs, eventName === 'ExitProcessed' ? [liquidity, 3n, 4n] : [liquidity]) }
        logs.push(log); if (s.exitFailure === 'duplicate') logs.push(log)
      }
      return { status: s.receiptStatus, transactionHash: txHash, logs }
    },
  }
  return { d, s, io }
}
const submit = (f: ReturnType<typeof fake>, progress = quiet) => submitOrder(f.io, f.d, account, true, 4n, 10n ** 18n, 0n, progress)

test('manifest is absent by default; invalid network, fingerprints, currencies and decimals fail closed', () => {
  assert.equal(parseDeployment(null), null)
  assert.equal(JSON.parse(readFileSync(new URL('../src/config/deployment.json', import.meta.url), 'utf8')).deployment, null)
  for (const change of [ { chainId: 1 }, { configVersion: '0' }, { configVersion: 1 }, { rewardPolicyHash: hash(0) }, { contracts: {} }, { assets: rawManifest().assets.reverse() } ]) {
    assert.throws(() => parseDeployment({ ...rawManifest(), ...change }))
  }
  assert.throws(() => parseDeployment({ ...rawManifest(), assets: [{ ...rawManifest().assets[0], decimals: 37 }, rawManifest().assets[1]] }))
  assert.throws(() => parseDeployment({ ...rawManifest(true), assets: [{ address: zeroAddress, symbol: 'ETH', decimals: 6 }, rawManifest().assets[1]] }))
})
test('ABI subset matches current compiled contracts including payable submit and event fields', () => {
  for (const [name, selected] of [['OtterOrderBook', ORDER_BOOK_ABI], ['OtterSettlement', SETTLEMENT_ABI], ['OtterRewardLedger', REWARD_LEDGER_ABI], ['OtterLiquidityVault', LIQUIDITY_VAULT_ABI]] as const) {
    const full = JSON.parse(readFileSync(new URL(`../../contracts/out/${name}.sol/${name}.json`, import.meta.url), 'utf8')).abi
    for (const entry of selected) assert.ok(full.some((a: unknown) => JSON.stringify(a) === JSON.stringify(entry)), `${name}: ${entry.name}`)
  }
  assert.equal(ORDER_BOOK_ABI.find(a => a.type === 'function' && a.name === 'submit')?.stateMutability, 'payable')
})
test('amount parsing rejects silent rounding and handles unequal decimals in both directions', () => {
  assert.equal(exactUnits('1.000000', 6), 1000000n)
  assert.throws(() => exactUnits('0.0000001', 6)); assert.throws(() => exactUnits('1e18', 18))
  assert.throws(() => exactUnits('-1', 18)); assert.equal(exactUnits('0', -18), 0n)
  const d = deployment(); d.assets[0].decimals = 6
  assert.deepEqual(orderAmounts(d, true, '4.5', '2'), { budget: 4500000n, ask: 2n * 10n ** 30n })
  assert.deepEqual(orderAmounts(d, false, '4.5', '2'), { budget: 45n * 10n ** 17n, ask: 2000000n })
  assert.throws(() => orderAmounts(d, true, '0', '2'))
  assert.throws(() => orderAmounts(d, true, (1n << 96n).toString(), '2'))
  assert.throws(() => orderAmounts(d, true, '1', (1n << 128n).toString()))
})
test('nonces cover every bit, arbitrary words and maximum uint256 without invented free bits', () => {
  const full = (1n << 256n) - 1n
  assert.equal(freeNonce(0n, full), null)
  for (const word of [0n, 1n, 999n, (1n << 248n) - 1n]) for (let bit = 0n; bit < 256n; bit++) {
    const n = freeNonce(word, full ^ (1n << bit))!
    assert.equal(n, word * 256n + bit); assert.deepEqual(nonceMask(n), { word, mask: 1n << bit })
  }
  assert.throws(() => freeNonce(1n << 248n, 0n)); assert.throws(() => uint('1.1'))
})
test('deployment gate checks code, domain, wiring, configuration, token decimals and RPC chain before signing', async () => {
  for (const key of ['badCode', 'badDomain', 'badWiring', 'badDecimals'] as const) {
    const f = fake(); f.s[key] = true; await assert.rejects(submit(f)); assert.equal(f.s.signCount, 0); assert.equal(f.s.sent.length, 0)
  }
  for (const [key, value] of [['chain', 1], ['config', 2n], ['readFailure', 'registered']] as const) {
    const f = fake(); Object.assign(f.s, { [key]: value }); await assert.rejects(submit(f)); assert.equal(f.s.signCount, 0)
  }
  await checkDeployment(fake().io, deployment())
})
test('approval waits for confirmation, resets nonzero allowances and checks exact allowance', async () => {
  const f = fake(); f.s.allowance = 2n
  let duringWait = 0
  f.s.onWait = () => { duringWait++; assert.equal(f.s.signCount, 0) }
  await approveBudget(f.io, f.d, account, true, 4n, quiet)
  assert.equal(duringWait, 2); assert.deepEqual(f.s.sent.map(c => c.args![1]), [0n, 4n])
  await approveBudget(f.io, f.d, account, true, 4n, quiet); assert.equal(f.s.sent.length, 2)
  const bad = fake(); bad.s.receiptStatus = 'reverted'
  await assert.rejects(approveBudget(bad.io, bad.d, account, true, 4n, quiet), /reverted/)
})
test('confirmed admission verifies its event, v2 digest, signed execution limits and real word 1 nonce', async () => {
  const f = fake(); f.s.nonceWords.set(0n, (1n << 256n) - 1n); f.s.nonceWords.set(1n, 1n)
  const result = await submit(f)
  assert.equal(result.epoch, 7n); assert.equal(result.index, 0); assert.equal(result.order.nonce, 257n)
  assert.equal(result.order.deadline, 1060n); assert.equal(result.order.maxExecutionTime, 1420n)
  assert.equal(typedOrder(f.d, result.order).domain.version, '2')
  assert.notEqual(orderDigest(f.d, result.order), orderDigest(f.d, { ...result.order, epoch: 8n }))
  assert.notEqual(orderDigest(f.d, result.order), orderDigest(f.d, { ...result.order, configVersion: 2n }))
  assert.equal(f.s.sent[0].value, 0n)
})
test('native submission attaches exact budget without an ERC20 approval or decimal read on address zero', async () => {
  const f = fake(deployment(true))
  await approveBudget(f.io, f.d, account, true, 4n, quiet); assert.equal(f.s.sent.length, 0)
  await submit(f); assert.equal(f.s.sent[0].value, 4n)
  assert.ok(!f.s.reads.some(c => c.address === zeroAddress))
})
test('reverse-side order into native ETH still approves only its ERC20 input and attaches no ETH', async () => {
  const f = fake(deployment(true))
  await approveBudget(f.io, f.d, account, false, 9n, quiet)
  const result = await submitOrder(f.io, f.d, account, false, 9n, 0n, 0n, quiet)
  assert.equal(f.s.sent[0].address, f.d.assets[1].address)
  assert.equal(f.s.sent[1].value, 0n)
  assert.equal(result.order.sellingCurrency0, false)
  assert.equal(result.order.ask, 0n)
})
test('nonce read failures and eight full words never fall back to a guessed nonce', async () => {
  const f = fake(); for (let w = 0n; w < 8n; w++) f.s.nonceWords.set(w, (1n << 256n) - 1n)
  await assert.rejects(submit(f), /No free nonce/); assert.equal(f.s.signCount, 0)
  const bad = fake(); bad.s.readFailure = 'nonceBitmap'; await assert.rejects(submit(bad), /unavailable/); assert.equal(bad.s.signCount, 0)
})
test('account/network switches before signing, while signing and during simulation prevent sending', async () => {
  const before = fake(); before.s.walletChain = 1; await assert.rejects(submit(before), /network changed/)
  for (const change of ['account', 'chain'] as const) {
    const f = fake(); f.s.onSign = () => { if (change === 'account') f.s.wallet = other; else f.s.walletChain = 1 }
    await assert.rejects(submit(f), /changed/); assert.equal(f.s.sent.length, 0)
  }
  const sim = fake(); sim.s.onSimulate = () => { sim.s.wallet = other }
  await assert.rejects(submit(sim), /changed/); assert.equal(sim.s.sent.length, 0)
})
test('stale epoch, deadline, execution cap and nonce are rejected without extending the signed order', async () => {
  for (const change of ['epoch', 'deadline', 'execution', 'nonce'] as const) {
    const f = fake(); f.s.onSign = () => {
      if (change === 'epoch') f.s.epoch++
      if (change === 'deadline') f.s.now = 1061n
      if (change === 'execution') f.s.executeUntil = 1421n
      if (change === 'nonce') f.s.nonceWords.set(0n, 1n)
    }
    await assert.rejects(submit(f)); assert.equal(f.s.sent.length, 0); assert.equal(f.s.signed!.maxExecutionTime, 1420n)
  }
  const delayed = fake(); delayed.s.onSign = () => { delayed.s.now += 20n; delayed.s.closesAt += 20n; delayed.s.executeUntil += 20n }
  await submit(delayed); assert.equal(delayed.s.signed!.maxExecutionTime, 1420n)
})
test('paused admission, failed simulation, reverted or unmatched receipts do not report admission', async () => {
  const paused = fake(); paused.s.paused = true; await assert.rejects(submit(paused), /paused/); assert.equal(paused.s.signCount, 0)
  for (const key of ['noEvent', 'wrongEvent', 'duplicateEvent'] as const) {
    const f = fake(); f.s[key] = true; await assert.rejects(submit(f), /matching order admission/)
  }
  const failed = fake(); failed.s.simulateFailure = 'submit'; await assert.rejects(submit(failed), /simulation/); assert.equal(failed.s.sent.length, 0)
  const reverted = fake(); reverted.s.receiptStatus = 'reverted'; await assert.rejects(submit(reverted), /reverted/)
})
test('refundable compatibility bool never becomes a settled state; historical status reads stay explicit', async () => {
  const f = fake(); f.s.state = 5
  const status = await readEpoch(f.io, f.d, 3n)
  assert.equal(status.state, 5); assert.equal(status.epoch, 3n)
})
test('timeout and individual recovery use stored ownership and remain available while admission is paused', async () => {
  const f = fake(); f.s.state = 2; f.s.paused = true
  await assert.rejects(expireEpoch(f.io, f.d, account, 7n, quiet), /not passed/)
  await assert.rejects(recoverOrder(f.io, f.d, account, 7n, 0n, quiet), /not yet recoverable/)
  f.s.now = 1360n
  await expireEpoch(f.io, f.d, account, 7n, quiet)
  await recoverOrder(f.io, f.d, account, 7n, 0n, quiet)
  assert.deepEqual(f.s.sent.map(c => c.functionName), ['expire', 'refundOrder'])
  f.s.recovered = true; await assert.rejects(recoverOrder(f.io, f.d, account, 7n, 0n, quiet), /already/)
  f.s.recovered = false; f.s.signed = { trader: other } as Order
  await assert.rejects(recoverOrder(f.io, f.d, account, 7n, 0n, quiet), /another trader/)
  await assert.rejects(recoverOrder(f.io, f.d, account, 7n, 32n, quiet), /below 32/)
})
test('fee invalidation is simulated; settled/executing epochs cannot recover', async () => {
  const f = fake(); f.s.simulateFailure = 'expireUnsupportedFees'
  await assert.rejects(expireEpoch(f.io, f.d, account, 7n, quiet, true), /simulation/); assert.equal(f.s.sent.length, 0)
  for (const state of [0, 3, 4]) { f.s.state = state; await assert.rejects(recoverOrder(f.io, f.d, account, 7n, 0n, quiet)) }
})
test('trader/reward claims use independent owners and currencies, partial amounts and alternate recipients', async () => {
  const f = fake(deployment(true)); f.s.paused = true
  assert.deepEqual(await readClaims(f.io, f.d, account), [12n, 12n, 5n, 5n, 9n, 8n])
  await claim(f.io, f.d, account, 'orderBook', 0, 3n, other, quiet)
  await claim(f.io, f.d, account, 'rewardLedger', 1, 2n, other, quiet)
  assert.deepEqual(f.s.sent.map(c => [c.address, c.args]), [ [f.d.contracts.orderBook.address, [zeroAddress, 3n, other]], [f.d.contracts.rewardLedger.address, [addr(11), 2n, other]] ])
  await assert.rejects(claim(f.io, f.d, account, 'orderBook', 0, 13n, other, quiet), /exceeds/)
  await assert.rejects(claim(f.io, f.d, account, 'rewardLedger', 1, 6n, other, quiet), /exceeds/)
  await assert.rejects(claim(f.io, f.d, account, 'orderBook', 0, 1n, zeroAddress, quiet))
  for (const target of ['orderBook', 'rewardLedger'] as const) await assert.rejects(claim(f.io, f.d, account, target, 0, 1n, f.d.contracts[target].address, quiet))
})
test('failed claim delivery or wallet switch cannot report a confirmed withdrawal', async () => {
  const f = fake(); f.s.receiptStatus = 'reverted'
  await assert.rejects(claim(f.io, f.d, account, 'orderBook', 0, 3n, other, quiet), /reverted/)
  const switched = fake(); switched.s.onWait = () => { switched.s.wallet = other }
  await assert.rejects(claim(switched.io, switched.d, account, 'orderBook', 0, 3n, other, quiet), /changed/)
})
test('signature invalidation targets any word and makes no escrow/refund claim', async () => {
  const f = fake(); await invalidateNonce(f.io, f.d, account, 768n + 19n, quiet)
  assert.equal(f.s.sent[0].functionName, 'invalidateNonces'); assert.deepEqual(f.s.sent[0].args, [3n, 1n << 19n])
})

test('vault position reads pin ownership, pool, reservation and activity to the checked block', async () => {
  const f = fake(); f.s.queued = 50n
  const p = await readVaultPosition(f.io, f.d, account, 1n)
  assert.deepEqual(p, { id: 1n, owner: account, poolId: f.d.poolId, lower: -120, upper: 120, liquidity: 100n, queued: 50n, active: true, blockNumber: 10n })
  assert.ok(f.s.readBlocks.filter(r => ['positions', 'queuedLiquidity', 'isBatchActive'].includes(r.name)).every(r => r.block === 10n))
  for (const [field, value] of [['positionOwner', other], ['positionOwner', zeroAddress], ['positionPool', hash(888)], ['badVaultBook', true], ['queued', 101n], ['readFailure', 'positions']] as const) {
    const bad = fake(); Object.assign(bad.s, { [field]: value }); await assert.rejects(readVaultPosition(bad.io, bad.d, account, 1n)); assert.equal(bad.s.sent.length, 0)
  }
  await assert.rejects(readVaultPosition(f.io, f.d, account, 0n), /positive/)
})
test('exit reservation works during an active or paused batch without approvals or asset delivery', async () => {
  for (const native of [false, true]) {
    const f = fake(deployment(native)); f.s.paused = true
    f.s.liquidity = (1n << 88n) - 1n
    const id = (1n << 200n) + 1n, liquidity = (1n << 87n) + 1n
    const r = await requestVaultExit(f.io, f.d, account, id, liquidity, quiet)
    assert.deepEqual(r, { hash: txHash, positionId: id, liquidity })
    assert.deepEqual(f.s.sent.map(c => [c.address, c.functionName, c.args, c.value ?? 0n]), [[f.d.contracts.liquidityGuard.address, 'requestExit', [id, liquidity], 0n]])
    assert.equal(f.s.signCount, 0)
  }
})
test('exit reservation rejects invalid amounts and a stale or already reserved position before sending', async () => {
  for (const amount of [0n, -1n, 101n, 1n << 128n]) {
    const f = fake(); await assert.rejects(requestVaultExit(f.io, f.d, account, 1n, amount, quiet)); assert.equal(f.s.sent.length, 0)
  }
  const queued = fake(); queued.s.queued = 1n
  await assert.rejects(requestVaultExit(queued.io, queued.d, account, 1n, 1n, quiet), /already/)
  const stale = fake(); await readVaultPosition(stale.io, stale.d, account, 1n); stale.s.positionOwner = other
  await assert.rejects(requestVaultExit(stale.io, stale.d, account, 1n, 1n, quiet), /another wallet/)
  assert.equal(stale.s.sent.length, 0)
})
test('exit processing uses actual pool activity rather than a passed wall-clock deadline', async () => {
  const f = fake(); f.s.queued = 50n; f.s.now = 2000n
  await assert.rejects(processVaultExit(f.io, f.d, account, 1n, quiet), /still active/)
  assert.equal(f.s.simulations.length, 0)
  f.s.active = false; f.s.paused = true
  const r = await processVaultExit(f.io, f.d, account, 1n, quiet)
  assert.deepEqual(r, { hash: txHash, positionId: 1n, liquidity: 50n, credited0: 3n, credited1: 4n })
  assert.deepEqual(f.s.sent.map(c => [c.functionName, c.args]), [['processExit', [1n]]])
  const missing = fake(); missing.s.active = false
  await assert.rejects(processVaultExit(missing.io, missing.d, account, 1n, quiet), /no queued exit/)
})
test('exit confirmation requires one matching event from the vault for the owner, pool, ID and amount', async () => {
  for (const process of [false, true]) for (const failure of ['missing', 'kind', 'owner', 'pool', 'id', 'amount', 'address', 'duplicate']) {
    const f = fake(); f.s.exitFailure = failure; f.s.active = false; f.s.queued = process ? 50n : 0n
    const action = process ? processVaultExit(f.io, f.d, account, 1n, quiet) : requestVaultExit(f.io, f.d, account, 1n, 50n, quiet)
    await assert.rejects(action, /exactly one matching/)
  }
})
test('a broadcast exit stays pending until its successful matching receipt arrives', async () => {
  const f = fake(), original = f.io.wait
  let release!: () => void, done = false
  const pending = new Promise<void>(r => { release = r })
  f.io.wait = async h => { await pending; return original(h) }
  const action = requestVaultExit(f.io, f.d, account, 1n, 50n, quiet).then(r => { done = true; return r })
  await new Promise<void>(r => setImmediate(r))
  assert.equal(f.s.sent.length, 1); assert.equal(done, false)
  release(); await action; assert.equal(done, true)
})
test('exit failures and account/network switches never become a confirmed request or credit', async () => {
  for (const processing of [false, true]) {
    const invoke = (f: ReturnType<typeof fake>) => processing ? processVaultExit(f.io, f.d, account, 1n, quiet) : requestVaultExit(f.io, f.d, account, 1n, 50n, quiet)
    const make = () => { const f = fake(); f.s.queued = processing ? 50n : 0n; f.s.active = false; return f }
    const reverted = make(); reverted.s.receiptStatus = 'reverted'; await assert.rejects(invoke(reverted), /reverted/)
    const failed = make(); failed.s.simulateFailure = processing ? 'processExit' : 'requestExit'; await assert.rejects(invoke(failed), /simulation/); assert.equal(failed.s.sent.length, 0)
    const readSwitch = make(); readSwitch.s.onRead = () => { readSwitch.s.wallet = other }; await assert.rejects(invoke(readSwitch), /changed/); assert.equal(readSwitch.s.sent.length, 0)
    const simSwitch = make(); simSwitch.s.onSimulate = () => { simSwitch.s.walletChain = 1 }; await assert.rejects(invoke(simSwitch), /changed/); assert.equal(simSwitch.s.sent.length, 0)
    const waitSwitch = make(); waitSwitch.s.onWait = () => { waitSwitch.s.wallet = other }; await assert.rejects(invoke(waitSwitch), /changed/)
  }
})
test('vault principal/fee claims are separate from rewards and deliver either asset in exact chunks', async () => {
  for (const native of [false, true]) {
    const f = fake(deployment(native)); f.s.paused = true; f.s.queued = 50n
    const cap = (1n << 120n) - 1n; f.s.vaultClaims = [cap + 10n, 8n]
    await claim(f.io, f.d, account, 'liquidityGuard', 0, cap, other, quiet)
    await claim(f.io, f.d, account, 'liquidityGuard', 1, 3n, other, quiet)
    assert.deepEqual(f.s.sent.map(c => [c.address, c.args, c.value ?? 0n]), [[f.d.contracts.liquidityGuard.address, [f.d.assets[0].address, cap, other], 0n], [f.d.contracts.liquidityGuard.address, [f.d.assets[1].address, 3n, other], 0n]])
    await assert.rejects(claim(f.io, f.d, account, 'liquidityGuard', 0, cap + 1n, other, quiet), /uint120/)
    await assert.rejects(claim(f.io, f.d, account, 'liquidityGuard', 1, 9n, other, quiet), /exceeds/)
    for (const c of Object.values(f.d.contracts)) await assert.rejects(claim(f.io, f.d, account, 'liquidityGuard', 0, 1n, c.address, quiet), /custody contracts/)
  }
})
test('failed vault-credit delivery does not report success or use a different claim ledger', async () => {
  const f = fake(deployment(true)); f.s.receiptStatus = 'reverted'
  await assert.rejects(claim(f.io, f.d, account, 'liquidityGuard', 0, 3n, other, quiet), /reverted/)
  assert.equal(f.s.sent[0].address, f.d.contracts.liquidityGuard.address)
  assert.deepEqual(f.s.sent[0].args, [zeroAddress, 3n, other])
  const readFailure = fake(); readFailure.s.readFailure = 'claims'
  await assert.rejects(claim(readFailure.io, readFailure.d, account, 'liquidityGuard', 0, 3n, other, quiet), /unavailable/)
  assert.equal(readFailure.s.sent.length, 0)
})

function adapterFixture(reason?: 'repriced' | 'cancelled' | 'replaced', altered = false) {
  const call: Call = { address: addr(1), abi: ORDER_BOOK_ABI, functionName: 'expire', args: [hash(50), 7n] }
  let walletAddress = account, walletChain = 11155111
  const confirmedHash = reason ? hash(1000) : txHash
  const pub = { chain: { id: 11155111 }, simulateContract: async () => ({ request: call }),
    waitForTransactionReceipt: async (args: { onReplaced: (r: unknown) => void }) => {
      if (reason) args.onReplaced({ reason }); return { status: 'success', transactionHash: confirmedHash, logs: [] }
    }, getTransaction: async () => ({ to: call.address, from: account, input: altered ? '0x' : encodeFunctionData(call), value: 0n }) } as unknown as PublicClient
  const wallet = { account: { address: account }, chain: { id: 11155111 }, getChainId: async () => walletChain, writeContract: async () => txHash,
    signTypedData: async () => '0x11' } as unknown as WalletClient
  const io = viemTransport(pub, async () => wallet, async () => ({ address: walletAddress, chainId: walletChain }))
  return { io, call, switchAccount: () => { walletAddress = other }, switchChain: () => { walletChain = 1 } }
}
test('viem adapter accepts repricing, rejects cancellation/replacement and verifies actual calldata', async () => {
  for (const reason of [undefined, 'repriced'] as const) { const f = adapterFixture(reason); const request = await f.io.simulate(f.call, account); const hash = await f.io.send(request, account); assert.equal((await f.io.wait(hash)).status, 'success') }
  for (const reason of ['cancelled', 'replaced'] as const) { const f = adapterFixture(reason); const hash = await f.io.send(f.call, account); await assert.rejects(f.io.wait(hash), /cancelled or replaced/) }
  const altered = adapterFixture(undefined, true); const hash = await altered.io.send(altered.call, account); await assert.rejects(altered.io.wait(hash), /differs/)
})
test('viem adapter rechecks account and chain inside the signing and broadcasting boundary', async () => {
  for (const key of ['switchAccount', 'switchChain'] as const) {
    const f = adapterFixture(); f[key]()
    await assert.rejects(f.io.send(f.call, account), /changed/)
    const d = deployment(), order = { trader: account } as Order
    await assert.rejects(f.io.sign(typedOrder(d, order)), /changed/)
  }
})
