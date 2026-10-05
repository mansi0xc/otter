import { decodeEventLog, hashDomain, keccak256, stringToHex, zeroAddress, type Abi, type Address, type Hash, type Hex } from 'viem'
import { ORDER_BOOK_ABI, SETTLEMENT_ABI, REWARD_LEDGER_ABI, ERC20_ABI } from './abi.ts'
import { address, uint, type Deployment } from './deployment.ts'
import { freeNonce, nonceMask, orderHash, typedOrder, type Order } from './orders.ts'

export interface Block { number: bigint; timestamp: bigint }
export interface Call { address: Address; abi: Abi; functionName: string; args?: readonly unknown[]; value?: bigint }
export interface Receipt {
  status: 'success' | 'reverted'; transactionHash: Hash
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[]
}
export interface Transport {
  chainId(): Promise<number>
  block(): Promise<Block>
  code(address: Address, block: bigint): Promise<Hex | undefined>
  read(call: Call, block?: bigint): Promise<unknown>
  session(): Promise<{ address: Address; chainId: number }>
  sign(data: ReturnType<typeof typedOrder>): Promise<Hex>
  simulate(call: Call, account: Address): Promise<unknown>
  send(request: unknown, account: Address): Promise<Hash>
  wait(hash: Hash): Promise<Receipt>
}
export type Progress = (stage: string, hash?: Hash, order?: Order) => void
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const need = (ok: boolean, message: string) => { if (!ok) throw new Error(message) }
const readBook = (d: Deployment, functionName: string, args: readonly unknown[] = []): Call =>
  ({ address: d.contracts.orderBook.address, abi: ORDER_BOOK_ABI, functionName, args })

export async function assertSession(io: Transport, d: Deployment, account: Address) {
  const current = await io.session()
  need(current.chainId === d.chainId && same(current.address, account), 'Wallet account or network changed. Start again with the intended Sepolia account.')
}

// Reads share one block. Fingerprints are local deployment trust anchors, not an audit.
export async function checkDeployment(io: Transport, d: Deployment): Promise<Block> {
  need(await io.chainId() === d.chainId, 'RPC network does not match the configured deployment.')
  const block = await io.block()
  const results = await Promise.all(Object.values(d.contracts).map(async c => {
    const code = await io.code(c.address, block.number)
    return !!code && code !== '0x' && same(keccak256(code), c.runtimeHash)
  }))
  need(results.every(Boolean), 'Contract code does not match the reviewed deployment fingerprints. Wallet actions are disabled.')
  const book = d.contracts.orderBook.address, settlement = d.contracts.settlement.address
  const ledger = d.contracts.rewardLedger.address
  const domain = hashDomain({ domain: { ...typedOrder(d, {} as Order).domain, chainId: BigInt(d.chainId) },
    types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } })
  const reads = [
    readBook(d, 'DOMAIN_SEPARATOR'), readBook(d, 'ORDER_TYPEHASH'), readBook(d, 'SNAPSHOT_TYPEHASH'),
    readBook(d, 'settlement'), readBook(d, 'registered', [d.poolId]),
    readBook(d, 'currency0Of', [d.poolId]), readBook(d, 'currency1Of', [d.poolId]),
    readBook(d, 'configVersionOf', [d.poolId]), readBook(d, 'liquidityGuardOf', [d.poolId]),
    readBook(d, 'rewardPolicyHashOf', [d.poolId]),
    { address: settlement, abi: SETTLEMENT_ABI, functionName: 'orderBook' },
    { address: settlement, abi: SETTLEMENT_ABI, functionName: 'rewardLedger' },
    { address: ledger, abi: REWARD_LEDGER_ABI, functionName: 'orderBook' },
    { address: ledger, abi: REWARD_LEDGER_ABI, functionName: 'settlement' },
    { address: ledger, abi: REWARD_LEDGER_ABI, functionName: 'policyHashOf', args: [d.poolId] },
  ]
  const values = await Promise.all(reads.map(call => io.read(call, block.number)))
  const expected = [domain, keccak256(stringToHex('Order(address trader,bytes32 poolId,bool sellingCurrency0,uint256 ask,uint256 budget,uint256 deadline,uint256 nonce,uint256 configVersion,uint256 epoch,uint256 maxExecutionTime)')),
    keccak256(stringToHex('OtterOpeningSnapshot/v2')), settlement, true, d.assets[0].address, d.assets[1].address,
    d.configVersion, d.contracts.liquidityGuard.address, d.rewardPolicyHash, book, ledger, book, settlement, d.rewardPolicyHash]
  need(values.every((v, i) => typeof v === 'string' && typeof expected[i] === 'string'
    ? same(v, expected[i] as string) : v === expected[i]), 'Order domain, pool configuration or contract wiring does not match the manifest.')
  await Promise.all(d.assets.filter(a => a.address !== zeroAddress).map(async a => {
    const decimals = await io.read({ address: a.address, abi: ERC20_ABI, functionName: 'decimals' }, block.number)
    need(decimals === a.decimals, `Decimals do not match for ${a.symbol}.`)
  }))
  return block
}

async function transact(io: Transport, d: Deployment, account: Address, call: Call, progress: Progress, stage: string): Promise<Receipt> {
  await assertSession(io, d, account)
  const request = await io.simulate(call, account)
  await assertSession(io, d, account)
  progress(stage)
  const hash = await io.send(request, account)
  progress('Waiting for confirmation', hash)
  const receipt = await io.wait(hash)
  progress('Checking confirmed transaction', receipt.transactionHash)
  need(receipt.status === 'success', 'Transaction reverted. No successful action has been confirmed.')
  // Do not apply a previous account's result to the newly connected account.
  await assertSession(io, d, account)
  return receipt
}

export async function approveBudget(io: Transport, d: Deployment, account: Address, side: boolean, budget: bigint, progress: Progress) {
  need(budget > 0n && budget < 1n << 96n, 'Invalid budget.')
  await assertSession(io, d, account)
  await checkDeployment(io, d)
  const asset = d.assets[side ? 0 : 1]
  if (asset.address === zeroAddress) return // Exact native value is attached to submit; never approve address(0).
  const allowanceCall: Call = { address: asset.address, abi: ERC20_ABI, functionName: 'allowance', args: [account, d.contracts.orderBook.address] }
  const allowance = await io.read(allowanceCall) as bigint
  await assertSession(io, d, account)
  if (allowance >= budget) return
  // Supports tokens requiring a confirmed zero reset, and never grants unlimited approval.
  for (const amount of allowance > 0n ? [0n, budget] : [budget]) {
    await transact(io, d, account, { address: asset.address, abi: ERC20_ABI, functionName: 'approve', args: [d.contracts.orderBook.address, amount] }, progress, 'Confirm token approval in your wallet')
    const actual = await io.read(allowanceCall) as bigint
    need(actual === amount, 'Confirmed approval did not set the expected allowance.')
  }
}

export async function submitOrder(io: Transport, d: Deployment, account: Address, side: boolean, budget: bigint, ask: bigint, startingWord: bigint, progress: Progress) {
  need(budget > 0n && budget < 1n << 96n && ask >= 0n && ask < 1n << 128n, 'Invalid order amounts.')
  uint(startingWord.toString(), 248)
  await assertSession(io, d, account)
  const block = await checkDeployment(io, d)
  const [paused, preview] = await Promise.all([
    io.read(readBook(d, 'admissionPaused'), block.number),
    io.read(readBook(d, 'previewEpoch', [d.poolId]), block.number),
  ])
  need(paused === false, 'New order admission is paused. Recovery and claims remain available.')
  const [epoch, closesAt, executeUntil, configVersion] = preview as readonly [bigint, bigint, bigint, bigint]
  need(configVersion === d.configVersion && closesAt > block.timestamp, 'No compatible collection window is open.')
  let nonce: bigint | null = null
  // Bounded scan of real words; a full scan fails explicitly instead of guessing word 1.
  for (let offset = 0n; offset < 8n && startingWord + offset < 1n << 248n; offset++) {
    const word = startingWord + offset
    const bits = await io.read(readBook(d, 'nonceBitmap', [account, word]), block.number) as bigint
    nonce = freeNonce(word, bits)
    if (nonce !== null) break
  }
  need(nonce !== null, 'No free nonce in the bounded scan (at most eight words). Choose a different starting word.')
  const deadline = closesAt < block.timestamp + 60n ? closesAt : block.timestamp + 60n
  const maxExecutionTime = executeUntil + 60n // Explicit, displayed tolerance for first-order opening delay.
  uint(deadline.toString(), 64); uint(maxExecutionTime.toString(), 64)
  const order: Order = Object.freeze({ trader: account, poolId: d.poolId, sellingCurrency0: side, ask, budget, deadline,
    nonce: nonce!, configVersion, epoch, maxExecutionTime })
  await assertSession(io, d, account)
  progress('Sign the epoch-bound order in your wallet', undefined, order)
  const signature = await io.sign(typedOrder(d, order))
  await assertSession(io, d, account)
  need(/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) && signature.length <= 1026, 'Invalid or oversized wallet signature.')
  const latest = await checkDeployment(io, d)
  const [fresh, used] = await Promise.all([
    io.read(readBook(d, 'previewEpoch', [d.poolId]), latest.number),
    io.read(readBook(d, 'nonceBitmap', [account, order.nonce >> 8n]), latest.number),
  ])
  const [freshEpoch, freshClose, freshExecution, freshConfig] = fresh as readonly [bigint, bigint, bigint, bigint]
  need(freshEpoch === order.epoch && freshConfig === order.configVersion && latest.timestamp <= order.deadline
    && latest.timestamp < freshClose && freshExecution <= order.maxExecutionTime,
    'The epoch or timing changed while signing. Prepare a new signature; the old limits will not be extended.')
  need(((used as bigint) & nonceMask(order.nonce).mask) === 0n, 'This nonce was used or invalidated while signing. Start again.')
  const value = d.assets[side ? 0 : 1].address === zeroAddress ? budget : 0n
  const receipt = await transact(io, d, account, { ...readBook(d, 'submit', [[order], [signature]]), value }, progress, 'Confirm order submission in your wallet')
  const matches = receipt.logs.flatMap(log => {
    if (!same(log.address, d.contracts.orderBook.address)) return []
    try {
      const event = decodeEventLog({ abi: ORDER_BOOK_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
      if (event.eventName !== 'OrderSubmitted') return []
      const a = event.args
      if (!same(a.poolId, d.poolId) || a.batchId !== order.epoch || !same(a.trader, account) || !same(a.orderHash, orderHash(order))) return []
      need(a.index < 32, 'Invalid admitted order index.')
      return [a.index]
    } catch { return [] }
  })
  need(matches.length === 1, 'Successful receipt did not contain exactly one matching order admission. Inspect the transaction before retrying.')
  return { hash: receipt.transactionHash, epoch: order.epoch, index: matches[0], order }
}

export interface EpochStatus { epoch: bigint; state: number; closesAt: bigint; executeUntil: bigint; count: number; timestamp: bigint }
export async function readEpoch(io: Transport, d: Deployment, epoch?: bigint): Promise<EpochStatus> {
  if (epoch !== undefined) uint(epoch.toString())
  const block = await checkDeployment(io, d)
  const id = epoch ?? await io.read(readBook(d, 'currentBatchId', [d.poolId]), block.number) as bigint
  const [batch, state, executeUntil] = await Promise.all([
    io.read(readBook(d, 'batches', [d.poolId, id]), block.number),
    io.read(readBook(d, 'batchState', [d.poolId, id]), block.number),
    io.read(readBook(d, 'executionDeadline', [d.poolId, id]), block.number),
  ])
  const [closesAt, count] = batch as readonly [bigint, number, boolean]
  return { epoch: id, state: state as number, closesAt, executeUntil: executeUntil as bigint, count, timestamp: block.timestamp }
}

export async function expireEpoch(io: Transport, d: Deployment, account: Address, epoch: bigint, progress: Progress, unsupportedFees = false) {
  const status = await readEpoch(io, d, epoch)
  need(status.state === 1 || status.state === 2, 'Only a collecting or closed epoch can expire.')
  if (!unsupportedFees) need(status.timestamp >= status.executeUntil, 'The execution deadline has not passed on-chain.')
  return transact(io, d, account, readBook(d, unsupportedFees ? 'expireUnsupportedFees' : 'expire', [d.poolId, epoch]), progress, 'Confirm epoch expiry in your wallet')
}
export async function recoverOrder(io: Transport, d: Deployment, account: Address, epoch: bigint, index: bigint, progress: Progress) {
  uint(index.toString()); need(index < 32n, 'Order index must be below 32.')
  const status = await readEpoch(io, d, epoch)
  need(status.state === 5 || ((status.state === 1 || status.state === 2) && status.timestamp >= status.executeUntil), 'Order is not yet recoverable.')
  need(index < BigInt(status.count), 'No stored order exists at this index.')
  const [orders, recovered] = await Promise.all([
    io.read(readBook(d, 'getOrders', [d.poolId, epoch])), io.read(readBook(d, 'orderRecovered', [d.poolId, epoch, index])),
  ])
  need(same((orders as readonly Order[])[Number(index)].trader, account), 'This record belongs to another trader. Recovery always credits the signed owner.')
  need(recovered === false, 'This stored order has already been recovered.')
  return transact(io, d, account, readBook(d, 'refundOrder', [d.poolId, epoch, index]), progress, 'Confirm individual order recovery in your wallet')
}
export async function readClaims(io: Transport, d: Deployment, account: Address) {
  const block = await checkDeployment(io, d)
  return Promise.all((['orderBook', 'rewardLedger'] as const).flatMap(target => d.assets.map(asset =>
    io.read({ address: d.contracts[target].address, abi: target === 'orderBook' ? ORDER_BOOK_ABI : REWARD_LEDGER_ABI,
      functionName: 'claimable', args: [account, asset.address] }, block.number) as Promise<bigint>)))
}
export async function claim(io: Transport, d: Deployment, account: Address, target: 'orderBook' | 'rewardLedger', assetIndex: 0 | 1, amount: bigint, recipientText: string, progress: Progress) {
  const recipient = address(recipientText)
  const excluded = target === 'orderBook' ? [d.contracts.orderBook.address]
    : [d.contracts.rewardLedger.address, d.contracts.orderBook.address, d.contracts.settlement.address]
  need(!excluded.some(a => same(a, recipient)), 'This recipient is not permitted by the claim contract.')
  uint(amount.toString()); need(amount > 0n, 'Claim amount must be positive.')
  const claims = await readClaims(io, d, account)
  need(amount <= claims[(target === 'orderBook' ? 0 : 2) + assetIndex], 'Amount exceeds your currently funded claim.')
  return transact(io, d, account, { address: d.contracts[target].address, abi: target === 'orderBook' ? ORDER_BOOK_ABI : REWARD_LEDGER_ABI,
    functionName: 'claim', args: [d.assets[assetIndex].address, amount, recipient] }, progress, 'Confirm claim withdrawal in your wallet')
}
export async function invalidateNonce(io: Transport, d: Deployment, account: Address, nonce: bigint, progress: Progress) {
  await checkDeployment(io, d)
  const { word, mask } = nonceMask(nonce)
  return transact(io, d, account, readBook(d, 'invalidateNonces', [word, mask]), progress, 'Confirm unused signature invalidation in your wallet')
}
