import { getAddress, isAddress, zeroAddress, type Address, type Hash } from 'viem'

export const CHAIN_ID = 11155111
export type Target = 'orderBook' | 'settlement' | 'rewardLedger' | 'liquidityGuard'
export interface Asset { address: Address; symbol: string; decimals: number }
export interface Deployment {
  chainId: typeof CHAIN_ID
  poolId: Hash
  configVersion: bigint
  rewardPolicyHash: Hash
  contracts: Record<Target, { address: Address; runtimeHash: Hash }>
  assets: readonly [Asset, Asset]
}

const fail = (message: string): never => { throw new Error(message) }
export function address(value: unknown, allowNative = false): Address {
  if (typeof value !== 'string' || !isAddress(value)) return fail('Invalid address.')
  const result = getAddress(value)
  if (!allowNative && result === zeroAddress) return fail('Zero address is not allowed here.')
  return result
}
export function bytes32(value: unknown): Hash {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    return fail('Expected a nonzero bytes32 value.')
  }
  return value.toLowerCase() as Hash
}
export function uint(value: string, bits = 256): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78) return fail('Expected a whole unsigned number.')
  const n = BigInt(value)
  if (n >= 1n << BigInt(bits)) return fail(`Number exceeds uint${bits}.`)
  return n
}
// Invalid, absent or historical configuration fails closed; no environment-variable fallback.
export function parseDeployment(input: unknown): Deployment | null {
  if (input == null) return null
  if (typeof input !== 'object') return fail('Invalid deployment manifest.')
  const d = input as Record<string, unknown>
  if (d.chainId !== CHAIN_ID) return fail('Only Ethereum Sepolia is supported by this wallet build.')
  const rawContracts = d.contracts as Record<string, Record<string, unknown>> | undefined
  if (!rawContracts) return fail('Missing contract fingerprints.')
  const contracts = {} as Deployment['contracts']
  for (const target of ['orderBook', 'settlement', 'rewardLedger', 'liquidityGuard'] as const) {
    const c = rawContracts[target]
    if (!c) return fail(`Missing ${target} fingerprint.`)
    contracts[target] = { address: address(c.address), runtimeHash: bytes32(c.runtimeHash) }
  }
  if (new Set(Object.values(contracts).map(c => c.address.toLowerCase())).size !== 4) {
    return fail('Contract addresses must be distinct.')
  }
  if (!Array.isArray(d.assets) || d.assets.length !== 2) return fail('Expected two pool assets.')
  const assets = d.assets.map((a: Record<string, unknown>): Asset => {
    if (typeof a.symbol !== 'string' || !/^[A-Za-z0-9 ._-]{1,16}$/.test(a.symbol)) return fail('Invalid asset symbol.')
    if (!Number.isInteger(a.decimals) || (a.decimals as number) < 0 || (a.decimals as number) > 36) {
      return fail('Asset decimals must be between 0 and 36.')
    }
    const result = { address: address(a.address, true), symbol: a.symbol, decimals: a.decimals as number }
    if (result.address === zeroAddress && result.decimals !== 18) return fail('Native ETH uses 18 decimals.')
    return result
  }) as [Asset, Asset]
  if (BigInt(assets[0].address) >= BigInt(assets[1].address)) return fail('Pool assets must be in currency0/currency1 order.')
  if (typeof d.configVersion !== 'string') return fail('Configuration version must be a decimal string.')
  const configVersion = uint(d.configVersion)
  if (configVersion === 0n) return fail('Configuration version must be positive.')
  return { chainId: CHAIN_ID, poolId: bytes32(d.poolId), rewardPolicyHash: bytes32(d.rewardPolicyHash), configVersion, contracts, assets }
}
