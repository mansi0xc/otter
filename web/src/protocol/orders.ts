import { type Address, type Hash, hashTypedData, hashStruct } from 'viem'
import { uint, type Deployment } from './deployment.ts'

export const ORDER_TYPES = { Order: [
  { name: 'trader', type: 'address' }, { name: 'poolId', type: 'bytes32' },
  { name: 'sellingCurrency0', type: 'bool' }, { name: 'ask', type: 'uint256' },
  { name: 'budget', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  { name: 'nonce', type: 'uint256' }, { name: 'configVersion', type: 'uint256' },
  { name: 'epoch', type: 'uint256' }, { name: 'maxExecutionTime', type: 'uint256' },
] } as const
export interface Order {
  trader: Address; poolId: Hash; sellingCurrency0: boolean; ask: bigint; budget: bigint
  deadline: bigint; nonce: bigint; configVersion: bigint; epoch: bigint; maxExecutionTime: bigint
}
export function typedOrder(d: Deployment, order: Order) {
  return { domain: { name: 'OtterOrderBook', version: '2', chainId: d.chainId, verifyingContract: d.contracts.orderBook.address },
    types: ORDER_TYPES, primaryType: 'Order' as const, message: order }
}
export const orderHash = (order: Order) => hashStruct({ data: order, primaryType: 'Order', types: ORDER_TYPES })
export const orderDigest = (d: Deployment, order: Order) => hashTypedData(typedOrder(d, order))

// Exact decimal parsing: viem's user-facing parseUnits may round excessive precision.
export function exactUnits(text: string, exponent: number): bigint {
  if (text.length > 160 || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new Error('Enter an unsigned decimal; scientific notation is not supported.')
  const [whole, fraction = ''] = text.split('.')
  const n = BigInt(whole + fraction)
  const shift = exponent - fraction.length
  if (shift >= 0) return n * 10n ** BigInt(shift)
  const divisor = 10n ** BigInt(-shift)
  if (n % divisor !== 0n) throw new Error('This amount or price cannot be represented exactly. Reduce its precision.')
  return n / divisor
}
export function orderAmounts(d: Deployment, side: boolean, budgetText: string, priceText: string) {
  const sold = d.assets[side ? 0 : 1], received = d.assets[side ? 1 : 0]
  const budget = exactUnits(budgetText, sold.decimals)
  const ask = exactUnits(priceText, 18 + received.decimals - sold.decimals)
  if (budget <= 0n || budget >= 1n << 96n) throw new Error('Budget must be positive and fit uint96.')
  if (ask >= 1n << 128n) throw new Error('Price exceeds the uint128 ask limit.')
  return { budget, ask }
}
export function freeNonce(word: bigint, bits: bigint): bigint | null {
  uint(word.toString(), 248); uint(bits.toString())
  for (let bit = 0n; bit < 256n; bit++) if ((bits & (1n << bit)) === 0n) return (word << 8n) | bit
  return null
}
export function nonceMask(nonce: bigint) {
  uint(nonce.toString()); return { word: nonce >> 8n, mask: 1n << (nonce & 255n) }
}
