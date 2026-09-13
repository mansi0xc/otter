import { useState, useCallback } from 'react'
import { useWriteContract, useAccount, useReadContract, useSignTypedData } from 'wagmi'
import { parseUnits, type Address } from 'viem'

import { otter, ORDER_BOOK_ABI, ERC20_ABI, ORDER_BOOK_DOMAIN, ORDER_TYPES } from '@/config/contracts'

export type OrderSide = 'OTA' | 'OTB'

export interface OrderParams {
  side: OrderSide
  budgetEther: string   // human-readable ether units
  askEther: string      // minimum price per unit received
}

export type SubmitStep =
  | 'IDLE'
  | 'APPROVING'
  | 'APPROVED'
  | 'SIGNING'
  | 'SUBMITTING'
  | 'DONE'
  | 'ERROR'

export interface SubmitState {
  step: SubmitStep
  txHash: `0x${string}` | null
  batchId: bigint | null
  error: string | null
  approve: (params: OrderParams) => Promise<void>
  submit: () => Promise<void>
  reset: () => void
}

export function useSubmitOrder(): SubmitState {
  const { address } = useAccount()
  const [step, setStep] = useState<SubmitStep>('IDLE')
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null)
  const [batchId, setBatchId] = useState<bigint | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Cached order params for the sign→submit flow
  const [cachedParams, setCachedParams] = useState<OrderParams | null>(null)
  // sig is only needed locally in submit, no need to persist in state

  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()

  // Read nonce bitmap word 0 to find an unused nonce
  const { data: nonceBits } = useReadContract({
    address: otter.orderBook,
    abi: ORDER_BOOK_ABI,
    functionName: 'nonceBitmap',
    args: address ? [address, 0n] : undefined,
    query: { enabled: !!address },
  })

  function findFreeNonce(bits: bigint): bigint {
    for (let i = 0; i < 256; i++) {
      if ((bits & (1n << BigInt(i))) === 0n) return BigInt(i)
    }
    return 256n // word 1
  }

  const approve = useCallback(async (params: OrderParams) => {
    if (!address) { setError('Connect a Sepolia wallet first.'); return }
    setError(null)
    setStep('APPROVING')
    setCachedParams(params)

    try {
      const tokenAddr: Address = params.side === 'OTA' ? otter.token0 : otter.token1
      const budget = parseUnits(params.budgetEther, 18)

      const hash = await writeContractAsync({
        address: tokenAddr,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [otter.orderBook, budget],
      })
      setTxHash(hash)
      setStep('APPROVED')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed')
      setStep('ERROR')
    }
  }, [address, writeContractAsync])

  const submit = useCallback(async () => {
    if (!address || !cachedParams) { setError('No order params.'); return }
    setError(null)
    setStep('SIGNING')

    try {
      // tokenAddr only needed for approval (handled in approve()), not re-used in submit
      const budget = parseUnits(cachedParams.budgetEther, 18)
      const ask = parseUnits(cachedParams.askEther, 18)
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600)
      const nonce = findFreeNonce(nonceBits ?? 0n)
      const sellingCurrency0 = cachedParams.side === 'OTA'

      const order = {
        trader: address,
        poolId: otter.poolId,
        sellingCurrency0,
        ask,
        budget,
        deadline,
        nonce,
      }

      const sig = await signTypedDataAsync({
        domain: ORDER_BOOK_DOMAIN,
        types: ORDER_TYPES,
        primaryType: 'Order',
        message: order,
      })
      // sig used directly in writeContractAsync below
      setStep('SUBMITTING')

      const hash = await writeContractAsync({
        address: otter.orderBook,
        abi: ORDER_BOOK_ABI,
        functionName: 'submit',
        args: [[order], [sig]],
      })
      setTxHash(hash)
      setStep('DONE')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submission failed')
      setStep('ERROR')
    }
  }, [address, cachedParams, nonceBits, signTypedDataAsync, writeContractAsync])

  const reset = useCallback(() => {
    setStep('IDLE')
    setTxHash(null)
    setBatchId(null)
    setError(null)
    setCachedParams(null)
  }, [])

  return { step, txHash, batchId, error, approve, submit, reset }
}
