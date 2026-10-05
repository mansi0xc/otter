import { keccak256, stringToHex, type Address, type Hash } from 'viem'
import { address, bytes32, CHAIN_ID, uint, type Deployment } from './deployment.ts'

export const JOURNAL_PREFIX = 'otter:transaction:v1:'
export const JOURNAL_LIMIT = 100
export const WALLET_METHODS = ['approve', 'submit', 'expire', 'expireUnsupportedFees', 'refundOrder', 'claim', 'invalidateNonces', 'requestExit', 'processExit'] as const
export type WalletMethod = typeof WALLET_METHODS[number]
export interface TransactionIntent {
  hash: Hash; scope: Hash; chainId: typeof CHAIN_ID; account: Address; to: Address
  inputHash: Hash; value: string; functionName: WalletMethod; recordedAt: number
  observedHash: Hash | null
}
export type JournalStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>

// Includes all deployment trust anchors. Changing a manifest does not relabel old history.
export function deploymentScope(d: Deployment): Hash {
  return keccak256(stringToHex(JSON.stringify({ chainId: d.chainId, poolId: d.poolId,
    configVersion: d.configVersion.toString(), rewardPolicyHash: d.rewardPolicyHash,
    contracts: Object.entries(d.contracts).map(([key, c]) => [key, c.address.toLowerCase(), c.runtimeHash]),
    assets: d.assets.map(a => [a.address.toLowerCase(), a.decimals, a.symbol]) })))
}
export function parseIntent(input: unknown): TransactionIntent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid transaction history record.')
  const r = input as Record<string, unknown>
  const keys = ['hash', 'scope', 'chainId', 'account', 'to', 'inputHash', 'value', 'functionName', 'recordedAt', 'observedHash']
  if (Object.keys(r).length !== keys.length || Object.keys(r).some(k => !keys.includes(k))
    || r.chainId !== CHAIN_ID || !WALLET_METHODS.includes(r.functionName as WalletMethod)
    || typeof r.value !== 'string' || !Number.isSafeInteger(r.recordedAt) || (r.recordedAt as number) < 0 || (r.recordedAt as number) > 8640000000000000) {
    throw new Error('Invalid transaction history fields. No action was resumed.')
  }
  uint(r.value)
  return { hash: bytes32(r.hash), scope: bytes32(r.scope), chainId: CHAIN_ID, account: address(r.account), to: address(r.to),
    inputHash: bytes32(r.inputHash), value: r.value, functionName: r.functionName as WalletMethod,
    recordedAt: r.recordedAt as number, observedHash: r.observedHash === null ? null : bytes32(r.observedHash) }
}

export function createTransactionJournal(storage: () => JournalStorage) {
  // Retain a broadcast hash in this tab even if persistence fails after the wallet sends it.
  const unsaved = new Map<Hash, TransactionIntent>()
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(fn => fn())
  const keys = (s: JournalStorage) => {
    const result: string[] = []
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key?.startsWith(JOURNAL_PREFIX)) result.push(key)
      if (result.length > JOURNAL_LIMIT) throw new Error('Transaction history exceeds its 100-record limit. Inspect browser storage.')
    }
    return result
  }
  const read = () => {
    const s = storage(), result = new Map<Hash, TransactionIntent>()
    for (const key of keys(s)) {
      const raw = s.getItem(key)
      if (!raw || raw.length > 1024) throw new Error('Transaction history is corrupt or changed during reading. Inspect browser storage.')
      const r = parseIntent(JSON.parse(raw))
      if (key !== JOURNAL_PREFIX + r.hash) throw new Error('Transaction history key does not match its hash.')
      result.set(r.hash, r)
    }
    unsaved.forEach((r, h) => result.set(h, r))
    return [...result.values()].sort((a, b) => b.recordedAt - a.recordedAt || a.hash.localeCompare(b.hash))
  }
  const snapshot = () => {
    try { return { records: read(), warning: unsaved.size ? 'A broadcast record is saved only in this tab. Save its transaction hash before closing.' : null } }
    catch (e) { return { records: [...unsaved.values()], warning: `Transaction history unavailable: ${e instanceof Error ? e.message : 'storage error'}. New broadcasts are blocked.` } }
  }
  const save = (record: TransactionIntent) => {
    const r = parseIntent(record)
    unsaved.set(r.hash, r)
    try {
      const s = storage(), raw = JSON.stringify(r), key = JOURNAL_PREFIX + r.hash
      if (s.getItem(key) === null && keys(s).length >= JOURNAL_LIMIT) throw new Error('History filled while the wallet was open. Save the new broadcast hash separately.')
      s.setItem(key, raw)
      if (s.getItem(key) !== raw) throw new Error('Browser did not retain the transaction record.')
      unsaved.delete(r.hash)
    } finally { notify() }
  }
  return {
    snapshot,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    notify,
    prepare: () => {
      if (read().length >= JOURNAL_LIMIT) throw new Error('Transaction history is full. Inspect and forget an old local record before sending.')
      const s = storage(), key = 'otter:transaction-storage-probe:v1'
      const probe = 'x'.repeat(1024)
      s.setItem(key, probe)
      if (s.getItem(key) !== probe) throw new Error('Browser transaction storage is unavailable.')
      s.removeItem(key)
    },
    record: (record: TransactionIntent) => {
      const r = parseIntent(record)
      let existing: TransactionIntent | undefined
      try { existing = read().find(e => e.hash === r.hash) }
      catch (e) { unsaved.set(r.hash, r); notify(); throw e }
      if (existing && (existing.scope !== r.scope || existing.account.toLowerCase() !== r.account.toLowerCase()
        || existing.to.toLowerCase() !== r.to.toLowerCase() || existing.inputHash !== r.inputHash || existing.value !== r.value
        || existing.functionName !== r.functionName)) throw new Error('This hash is already recorded for a different local intent.')
      save(existing ?? r)
    },
    observe: (hash: Hash, observedHash: Hash) => {
      const r = read().find(r => r.hash === hash)
      if (!r) throw new Error('Broadcast record is missing. Save the receipt hash before closing.')
      save({ ...r, observedHash })
    },
    forget: (hash: Hash) => {
      const key = JOURNAL_PREFIX + bytes32(hash), s = storage()
      s.removeItem(key)
      if (s.getItem(key) !== null) throw new Error('Browser did not remove the local transaction record.')
      unsaved.delete(hash); notify()
    },
  }
}
export type TransactionJournal = ReturnType<typeof createTransactionJournal>
export class BroadcastJournalError extends Error {
  hash: Hash
  constructor(hash: Hash, cause: unknown) {
    super(`Transaction broadcast, but its history could not be saved. Inspect ${hash} before retrying. ${cause instanceof Error ? cause.message : ''}`)
    this.hash = hash
  }
}
