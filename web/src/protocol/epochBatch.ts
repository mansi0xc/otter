/** Complete stored-batch content/recovery/nonce and current liability checks.
 * Relies on configured book code and RPC, not historical signature proof or
 * canonical economic verification. No signing, sending or policy change. */
import { decodeFunctionResult, encodeFunctionData, encodeFunctionResult, encodeAbiParameters,
  hashDomain, keccak256, stringToHex, zeroHash, type Abi, type Address, type Hash, type Hex } from 'viem'
import { address, bytes32 } from './deployment.ts'
import { ORDER_TYPES, orderHash, type Order } from './orders.ts'
import { captureEpochExecution, epochReads, EPOCH_TARGETS, type CapturedEpoch, type EpochRequest, type EpochSource } from './epochSnapshot.ts'
import { executionPoolId, type SnapshotRpc } from './executionSnapshot.ts'
import type { OpeningBinding } from './openingExecution.ts'

export const ORDER_COMPONENTS = ORDER_TYPES.Order
export const STORED_ORDER_TYPEHASH = keccak256(stringToHex(`Order(${ORDER_COMPONENTS.map(f => `${f.type} ${f.name}`).join(',')})`))
const pair = [{ name: 'poolId', type: 'bytes32' }, { name: 'epoch', type: 'uint256' }] as const
export const BATCH_ABI = [
  ...['DOMAIN_SEPARATOR', 'ORDER_TYPEHASH'].map(name => ({ type: 'function', name, stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] } as const)),
  { type: 'function', name: 'getOrders', stateMutability: 'view', inputs: pair, outputs: [{ type: 'tuple[]', components: ORDER_COMPONENTS }] },
  { type: 'function', name: 'replay', stateMutability: 'view', inputs: [...pair, { name: 'orders', type: 'tuple[]', components: ORDER_COMPONENTS }], outputs: [] },
  { type: 'function', name: 'orderRecovered', stateMutability: 'view', inputs: [...pair, { name: 'index', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'nonceBitmap', stateMutability: 'view', inputs: [{ name: 'trader', type: 'address' }, { name: 'word', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  ...['totalEscrow', 'totalClaimable'].map(name => ({ type: 'function', name, stateMutability: 'view', inputs: [{ name: 'currency', type: 'address' }], outputs: [{ type: 'uint256' }] } as const)),
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const
export type BatchRpc = (method: Parameters<SnapshotRpc>[0] | 'eth_getBalance', params: readonly unknown[]) => Promise<unknown>
export interface BatchContext { chainId: bigint; book: Address; poolId: Hash; epoch: bigint; configVersion: bigint;
  executeUntil: bigint; count: number; batchDigest: Hash }
export interface BatchCommitment { orders: readonly Readonly<Order>[]; ordersHash: Hash; batchDigest: Hash;
  domainSeparator: Hash; budget0: bigint; budget1: bigint }
export interface BatchLiability { currency: Address; requiredForBatch: bigint; escrow: bigint; claimable: bigint; balance: bigint }
export interface CapturedEpochBatch extends CapturedEpoch {
  orders: readonly Readonly<Order>[]; liabilities: readonly Readonly<BatchLiability>[]
  batchBinding: Readonly<OpeningBinding & Omit<BatchCommitment, 'orders'> & { count: number }>
}
const U256 = 1n << 256n
function uint(n: bigint, bits = 256) {
  if (typeof n !== 'bigint' || n < 0n || n >= 1n << BigInt(bits)) throw new Error(`Stored batch quantity must fit uint${bits}.`)
}
function quantity(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 66 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(raw)) throw new Error('Malformed batch RPC quantity.')
  return BigInt(raw)
}
export function storedBatchCommitment(input: BatchContext, orders: readonly Order[]): Readonly<BatchCommitment> {
  for (const n of [input.chainId, input.epoch, input.configVersion]) uint(n)
  uint(input.executeUntil, 64)
  const book = address(input.book), poolId = bytes32(input.poolId), expectedDigest = bytes32(input.batchDigest)
  if (input.chainId === 0n || input.configVersion === 0n || input.executeUntil === 0n || !Number.isSafeInteger(input.count)
    || input.count < 1 || input.count > 32 || !Array.isArray(orders) || orders.length !== input.count) throw new Error('Stored batch count/context mismatch.')
  const nonces = new Set<string>(); let budget0 = 0n, budget1 = 0n; let batchDigest: Hash = zeroHash
  const normalized = orders.map(o => {
    uint(o.ask, 128); uint(o.budget, 96); uint(o.deadline, 64); uint(o.nonce); uint(o.configVersion); uint(o.epoch); uint(o.maxExecutionTime, 64)
    const trader = address(o.trader), key = `${trader}/${o.nonce}`
    if (bytes32(o.poolId) !== poolId || o.configVersion !== input.configVersion || o.epoch !== input.epoch) throw new Error('Stored order epoch/configuration/pool mismatch.')
    if (typeof o.sellingCurrency0 !== 'boolean' || o.budget === 0n || o.maxExecutionTime < input.executeUntil || nonces.has(key)) throw new Error('Stored order admission/nonce constraints mismatch.')
    nonces.add(key)
    if (o.sellingCurrency0) budget0 += o.budget; else budget1 += o.budget
    const result = Object.freeze({ trader, poolId, sellingCurrency0: o.sellingCurrency0, ask: o.ask, budget: o.budget,
      deadline: o.deadline, nonce: o.nonce, configVersion: o.configVersion, epoch: o.epoch, maxExecutionTime: o.maxExecutionTime })
    batchDigest = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [batchDigest, orderHash(result)]))
    return result
  })
  if (budget0 >= 1n << 96n || budget1 >= 1n << 96n) throw new Error('Stored batch aggregate budget exceeds uint96.')
  if (batchDigest !== expectedDigest) throw new Error('Stored batch rolling digest mismatch.')
  const domainSeparator = hashDomain({ domain: { name: 'OtterOrderBook', version: '2', chainId: input.chainId, verifyingContract: book },
    types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] } })
  const ordersHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: ORDER_COMPONENTS }], [normalized]))
  return Object.freeze({ orders: Object.freeze(normalized), ordersHash, batchDigest, domainSeparator, budget0, budget1 })
}
function decode(name: string, raw: unknown, count?: number): unknown {
  if (typeof raw !== 'string' || raw.length > 20610 || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw)) throw new Error('Malformed/bounded stored batch call result.')
  if (name === 'getOrders') {
    if (raw.length < 130 || BigInt(`0x${raw.slice(2, 66)}`) !== 32n || BigInt(`0x${raw.slice(66, 130)}`) !== BigInt(count!)
      || raw.length !== 2 + (2 + 10 * count!) * 64) throw new Error('Stored order array shape/count mismatch.')
  }
  const result = decodeFunctionResult({ abi: BATCH_ABI, functionName: name, data: raw as Hex })
  if (encodeFunctionResult({ abi: BATCH_ABI, functionName: name, result }).toLowerCase() !== raw.toLowerCase()) throw new Error('Noncanonical stored batch call result.')
  return result
}

/** Bounded additional staticcall plan for local real-contract comparisons.
 * Native balance is supplied separately through hash-pinned eth_getBalance. */
export function storedBatchReads(input: EpochSource, epoch: bigint, orders: readonly Order[]) {
  epochReads(input, epoch) // Apply the same source/epoch representation checks.
  if (!Array.isArray(orders) || orders.length < 1 || orders.length > 32) throw new Error('Bounded stored order read plan required.')
  const book = address(input.contracts.book.address), poolId = executionPoolId(input.key)
  if (orders.some(o => bytes32(o.poolId) !== poolId || o.epoch !== epoch)) throw new Error('Stored order read plan identity mismatch.')
  const reads: { id: string; target: Address; data: Hex }[] = []
  const add = (id: string, name: string, args: readonly unknown[] = [], target = book) => reads.push({ id, target,
    data: encodeFunctionData({ abi: BATCH_ABI as Abi, functionName: name, args }) })
  add('batch.getOrders', 'getOrders', [poolId, epoch]); add('batch.DOMAIN_SEPARATOR', 'DOMAIN_SEPARATOR'); add('batch.ORDER_TYPEHASH', 'ORDER_TYPEHASH')
  const words = new Set<string>()
  orders.forEach((o, i) => {
    uint(o.nonce); const trader = address(o.trader), word = o.nonce >> 8n, key = `${trader}/${word}`
    add(`batch.orderRecovered/${i}`, 'orderRecovered', [poolId, epoch, BigInt(i)])
    if (!words.has(key)) { words.add(key); add(`batch.nonceBitmap/${key}`, 'nonceBitmap', [trader, word]) }
  })
  for (const [i, raw] of [input.key.currency0, input.key.currency1].entries()) {
    const currency = address(raw, true)
    add(`batch.totalEscrow/${i}`, 'totalEscrow', [currency]); add(`batch.totalClaimable/${i}`, 'totalClaimable', [currency])
    if (currency !== '0x0000000000000000000000000000000000000000') add(`batch.balanceOf/${i}`, 'balanceOf', [book], currency)
  }
  add('batch.replay', 'replay', [poolId, epoch, orders])
  return reads
}

export async function captureEpochBatch(rpc: BatchRpc, input: EpochSource, request: EpochRequest): Promise<CapturedEpochBatch> {
  // Detach controls before invoking the asynchronous epoch collector.
  const s: EpochSource = { chainId: input.chainId, configVersion: input.configVersion, rewardPolicyHash: input.rewardPolicyHash,
    key: { ...input.key }, contracts: Object.fromEntries(EPOCH_TARGETS.map(t => [t, { ...input.contracts[t] }])) as EpochSource['contracts'] }
  if (!Array.isArray(request.domains)) throw new Error('Expected stored batch curve domains.')
  const r = { epoch: request.epoch, caller: request.caller, blockNumber: request.blockNumber, domains: request.domains.map(d => ({ ...d })) }
  const captured = await captureEpochExecution(rpc, s, r), b = captured.binding, e = captured.eligibility
  const selector = Object.freeze({ blockHash: b.blockHash, requireCanonical: true })
  const read = async (name: string, args: readonly unknown[] = [], target = b.book) => decode(name,
    await rpc('eth_call', [{ to: target, data: encodeFunctionData({ abi: BATCH_ABI as Abi, functionName: name, args }) }, selector]), e.count)
  const [orders, domain, typehash] = await Promise.all([read('getOrders', [b.poolId, b.epoch]), read('DOMAIN_SEPARATOR'), read('ORDER_TYPEHASH')])
  const committed = storedBatchCommitment({ chainId: b.chainId, book: b.book, poolId: b.poolId, epoch: b.epoch,
    configVersion: b.configVersion, executeUntil: captured.record.executeUntil, count: e.count, batchDigest: e.batchDigest }, orders as Order[])
  if (domain !== committed.domainSeparator || typehash !== STORED_ORDER_TYPEHASH) throw new Error('Stored batch signing domain/type mismatch.')
  const nonceReads = new Map<string, Promise<bigint>>()
  const nonce = (o: Order) => {
    const word = o.nonce >> 8n, key = `${o.trader}/${word}`
    if (!nonceReads.has(key)) nonceReads.set(key, read('nonceBitmap', [o.trader, word]) as Promise<bigint>)
    return nonceReads.get(key)!
  }
  await Promise.all(committed.orders.map(async (o, i) => {
    const [recovered, bits] = await Promise.all([read('orderRecovered', [b.poolId, b.epoch, BigInt(i)]), nonce(o)])
    if (recovered !== false || (bits & 1n << (o.nonce & 255n)) === 0n) throw new Error('Stored order recovered or admitted nonce bit is absent.')
  }))
  // Global ledgers include other pools/epochs sharing these currencies. They
  // must cover this batch; equality would wrongly reject valid shared custody.
  const liabilities = await Promise.all([s.key.currency0, s.key.currency1].map(async (raw, i) => {
    const currency = address(raw, true), requiredForBatch = i === 0 ? committed.budget0 : committed.budget1
    const [escrow, claimable, balance] = await Promise.all([
      read('totalEscrow', [currency]) as Promise<bigint>, read('totalClaimable', [currency]) as Promise<bigint>,
      currency === '0x0000000000000000000000000000000000000000'
        ? rpc('eth_getBalance', [b.book, selector]).then(quantity) : read('balanceOf', [b.book], currency) as Promise<bigint>,
    ])
    if (escrow < requiredForBatch || escrow + claimable >= U256 || balance < escrow + claimable) throw new Error('Stored batch escrow/liability coverage mismatch.')
    return Object.freeze({ currency, requiredForBatch, escrow, claimable, balance })
  }))
  await read('replay', [b.poolId, b.epoch, committed.orders])
  const last = await rpc('eth_getBlockByNumber', [`0x${b.blockNumber.toString(16)}`, false]) as Record<string, unknown> | null
  if (!last || quantity(last.number) !== b.blockNumber || bytes32(last.hash) !== b.blockHash || quantity(last.timestamp) !== e.blockTimestamp
    || quantity(await rpc('eth_chainId', [])) !== b.chainId) throw new Error('Stored batch block or chain changed. No result retained.')
  const { orders: normalized, ...hashes } = committed
  return { ...captured, orders: normalized, liabilities: Object.freeze(liabilities), batchBinding: Object.freeze({ ...b, ...hashes, count: e.count }) }
}
