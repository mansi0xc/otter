import { useCallback, useState } from 'react'
import { useAccount } from 'wagmi'
import { getAccount, getPublicClient, getWalletClient } from 'wagmi/actions'
import { type Hash } from 'viem'
import { wagmiConfig } from '@/config/wagmi'
import { deployment, deploymentError } from '@/config/deployment'
import { viemTransport } from '@/protocol/viemTransport'
import { type Progress, type Transport } from '@/protocol/client'
import { type Order } from '@/protocol/orders'
import { type Deployment } from '@/protocol/deployment'

// Serializes wallet writes across submission, liquidity and recovery in this tab.
let actionInFlight = false
export function getTransport(): Transport {
  const publicClient = getPublicClient(wagmiConfig)
  if (!publicClient) throw new Error('Sepolia RPC client unavailable.')
  return viemTransport(publicClient, () => getWalletClient(wagmiConfig), async () => {
    const current = getAccount(wagmiConfig)
    if (!current.address || !current.isConnected || current.chainId === undefined) throw new Error('Connect the intended Sepolia wallet.')
    return { address: current.address, chainId: current.chainId }
  })
}
export function useWalletActions() {
  const currentWallet = useAccount()
  const currentKey = `${currentWallet.address?.toLowerCase() ?? ''}:${currentWallet.chainId ?? ''}`
  const [actionKey, setActionKey] = useState('')
  const [busy, setBusy] = useState(false), [stage, setStage] = useState('')
  const [hash, setHash] = useState<Hash | null>(null), [error, setError] = useState<string | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const run = useCallback(async <T,>(action: (io: Transport, d: Deployment, account: `0x${string}`, progress: Progress) => Promise<T>): Promise<T | undefined> => {
    if (actionInFlight) { setError('Another wallet action is pending in this tab. Wait for its result.'); return }
    if (!deployment) { setError(deploymentError); return }
    const current = getAccount(wagmiConfig)
    if (!current.address || current.chainId !== deployment.chainId) { setError('Connect the intended wallet on Ethereum Sepolia.'); return }
    actionInFlight = true
    setActionKey(`${current.address.toLowerCase()}:${current.chainId}`)
    setBusy(true); setError(null); setHash(null); setOrder(null); setStage('Checking deployment and wallet')
    try {
      const result = await action(getTransport(), deployment, current.address, (next, tx, signed) => {
        setStage(next); if (tx) setHash(tx); if (signed) setOrder(signed)
      })
      const after = getAccount(wagmiConfig)
      if (after.address?.toLowerCase() !== current.address.toLowerCase() || after.chainId !== current.chainId) throw new Error('Wallet changed before applying the result. Inspect the transaction.')
      setStage('Confirmed on Sepolia')
      return result
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet action failed.')
      setStage('Action not confirmed; inspect any transaction link before retrying')
    } finally { actionInFlight = false; setBusy(false) }
  }, [])
  const sameWallet = !actionKey || currentKey === actionKey
  return { run, busy, stage: sameWallet ? stage : 'This action belongs to the previous wallet. Inspect its transaction before retrying.', hash,
    error: sameWallet ? error : null, order: sameWallet ? order : null }
}
