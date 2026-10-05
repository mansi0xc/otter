import { useEffect, useState } from 'react'
import { deployment, deploymentError } from '@/config/deployment'
import { readEpoch, type EpochStatus } from '@/protocol/client'
import { getTransport } from './useWalletActions'
export const EPOCH_STATES = ['Not started', 'Collecting', 'Closed; execution permitted', 'Executing', 'Settled', 'Refundable']
export function useBatchStatus() {
  const [status, setStatus] = useState<EpochStatus | null>(null), [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!deployment)
  useEffect(() => {
    if (!deployment) return
    const d = deployment
    let cancelled = false, pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try { const value = await readEpoch(getTransport(), d); if (!cancelled) { setStatus(value); setError(null) } }
      catch (e) { if (!cancelled) { setStatus(null); setError(e instanceof Error ? e.message : 'Epoch read failed.') } }
      finally { pending = false; if (!cancelled) setLoading(false) }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 15_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [])
  return { status, error: deployment ? error : deploymentError, loading }
}
