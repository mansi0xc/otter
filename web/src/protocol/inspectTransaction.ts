import { decodeEventLog, decodeFunctionData, encodeFunctionData, keccak256, TransactionReceiptNotFoundError, zeroAddress, type Abi, type Hash, type Hex, type PublicClient } from 'viem'
import { ERC20_ABI, ORDER_BOOK_ABI, REWARD_LEDGER_ABI, LIQUIDITY_VAULT_ABI } from './abi.ts'
import { deploymentScope, parseIntent, type TransactionIntent } from './transactionJournal.ts'
import { type Deployment } from './deployment.ts'
import { orderHash, type Order } from './orders.ts'

export type InspectionClient = Pick<PublicClient, 'getChainId' | 'getTransactionReceipt' | 'getTransaction' | 'getBlock'>
export interface TransactionInspection {
  state: 'unmined' | 'different' | 'reverted' | 'mined'
  hash: Hash; block?: bigint
  admission?: { epoch: bigint; index: number; orderHash: Hash }
}
const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase()
function intentAbi(d: Deployment, r: TransactionIntent): Abi {
  if (same(r.to, d.contracts.orderBook.address) && ['submit', 'expire', 'expireUnsupportedFees', 'refundOrder', 'claim', 'invalidateNonces'].includes(r.functionName)) return ORDER_BOOK_ABI
  if (same(r.to, d.contracts.rewardLedger.address) && r.functionName === 'claim') return REWARD_LEDGER_ABI
  if (same(r.to, d.contracts.liquidityGuard.address) && ['claim', 'requestExit', 'processExit'].includes(r.functionName)) return LIQUIDITY_VAULT_ABI
  if (r.functionName === 'approve' && d.assets.some(a => a.address !== zeroAddress && same(r.to, a.address))) return ERC20_ABI
  throw new Error('Local record is not a supported action at this deployment.')
}

// Deliberately accepts only read methods. Stored history never becomes a wallet request.
export async function inspectTransaction(client: InspectionClient, d: Deployment, input: TransactionIntent): Promise<TransactionInspection> {
  const r = parseIntent(input), hash = r.observedHash ?? r.hash
  if (r.scope !== deploymentScope(d)) throw new Error('This local record belongs to a different deployment manifest.')
  const abi = intentAbi(d, r)
  if (await client.getChainId() !== d.chainId) throw new Error('Receipt RPC is on the wrong chain.')
  let receipt
  try { receipt = await client.getTransactionReceipt({ hash }) }
  catch (e) {
    if (!(e instanceof TransactionReceiptNotFoundError)) throw e
    if (await client.getChainId() !== d.chainId) throw new Error('Receipt RPC changed chains.')
    return { state: 'unmined', hash }
  }
  if (receipt.transactionHash !== hash || receipt.blockNumber === null || !receipt.blockHash) throw new Error('Malformed receipt; no mined action verified.')
  const actual = await client.getTransaction({ hash })
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber })
  if (canonical.hash !== receipt.blockHash || actual.blockHash !== receipt.blockHash || actual.blockNumber !== receipt.blockNumber || actual.hash !== hash) {
    throw new Error('Receipt or transaction no longer matches the current block. Refresh; no finality is established.')
  }
  // A second read catches receipt movement/disappearance during this inspection.
  const again = await client.getTransactionReceipt({ hash })
  if (again.blockHash !== receipt.blockHash || again.blockNumber !== receipt.blockNumber || again.transactionHash !== hash || again.status !== receipt.status
    || await client.getChainId() !== d.chainId) throw new Error('Receipt or chain changed during inspection. Refresh again.')
  if (!same(actual.to, r.to) || !same(actual.from, r.account) || keccak256(actual.input) !== r.inputHash || actual.value !== BigInt(r.value)) {
    return { state: 'different', hash, block: receipt.blockNumber }
  }
  if (receipt.status === 'reverted') return { state: 'reverted', hash, block: receipt.blockNumber }
  if (receipt.status !== 'success') throw new Error('Unknown receipt status.')
  const decoded = decodeFunctionData({ abi, data: actual.input })
  if (decoded.functionName !== r.functionName || encodeFunctionData({ abi, ...decoded }).toLowerCase() !== actual.input.toLowerCase()) {
    throw new Error('Mined calldata does not encode the recorded action exactly.')
  }
  if (r.functionName === 'approve' && !same(decoded.args?.[0] as string, d.contracts.orderBook.address)) {
    throw new Error('Recorded approval is not for the configured order book.')
  }
  const result: TransactionInspection = { state: 'mined', hash, block: receipt.blockNumber }
  if (r.functionName === 'submit') {
    const [orders, signatures] = decoded.args as readonly [readonly Order[], readonly Hex[]]
    if (orders.length !== 1 || signatures.length !== 1) throw new Error('Local wallet history supports single-order admissions only.')
    const order = orders[0], digest = orderHash(order)
    if (!same(order.trader, r.account) || !same(order.poolId, d.poolId) || order.configVersion !== d.configVersion) throw new Error('Recorded submission does not match the owner, pool or configuration.')
    const admissions = receipt.logs.flatMap(log => {
      if (!same(log.address, d.contracts.orderBook.address)) return []
      try {
        const event = decodeEventLog({ abi: ORDER_BOOK_ABI, data: log.data, topics: log.topics as [Hex, ...Hex[]] })
        if (event.eventName !== 'OrderSubmitted' || !same(event.args.poolId, d.poolId) || !same(event.args.trader, r.account)
          || event.args.batchId !== order.epoch || !same(event.args.orderHash, digest) || event.args.index >= 32) return []
        return [event.args.index]
      } catch { return [] }
    })
    if (admissions.length !== 1) throw new Error('Mined submission lacks exactly one matching admission event. Inspect before retrying.')
    result.admission = { epoch: order.epoch, index: admissions[0], orderHash: digest }
  }
  return result
}
