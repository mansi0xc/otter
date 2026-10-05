import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { approveBudget, submitOrder } from '@/protocol/client'
import { orderAmounts } from '@/protocol/orders'
import { uint } from '@/protocol/deployment'
import { useWalletActions } from './useWalletActions'
export function useSubmitOrder() {
  const actions = useWalletActions()
  const { address, chainId } = useAccount()
  const [admission, setAdmission] = useState<{ epoch: bigint; index: number } | null>(null)
  useEffect(() => { setAdmission(null) }, [address, chainId])
  const submit = async (side: boolean, budgetText: string, priceText: string, wordText: string) => {
    setAdmission(null)
    const result = await actions.run(async (io, d, account, progress) => {
      const { budget, ask } = orderAmounts(d, side, budgetText, priceText)
      const word = uint(wordText, 248)
      await approveBudget(io, d, account, side, budget, progress)
      return submitOrder(io, d, account, side, budget, ask, word, progress)
    })
    if (result) setAdmission({ epoch: result.epoch, index: result.index })
  }
  return { ...actions, submit, admission }
}
