import { useReadContract } from 'wagmi'
import { otter, ORDER_BOOK_ABI } from '@/config/contracts'

export interface BatchStatus {
  batchId: bigint | null
  closesAt: number | null       // unix timestamp seconds
  orderCount: number
  settled: boolean
  secondsRemaining: number
  isLoading: boolean
  error: Error | null
}

export function useBatchStatus(): BatchStatus {
  const {
    data: openData,
    isLoading: loadingOpen,
    error: errorOpen,
  } = useReadContract({
    address: otter.orderBook,
    abi: ORDER_BOOK_ABI,
    functionName: 'openBatchId',
    args: [otter.poolId],
    query: { refetchInterval: 15_000 },
  })

  const batchId = openData ? openData[0] : null
  const closesAt = openData ? Number(openData[1]) : null

  const {
    data: batchData,
    isLoading: loadingBatch,
  } = useReadContract({
    address: otter.orderBook,
    abi: ORDER_BOOK_ABI,
    functionName: 'batches',
    args: batchId != null ? [otter.poolId, batchId] : undefined,
    query: {
      enabled: batchId != null,
      refetchInterval: 15_000,
    },
  })

  const now = Math.floor(Date.now() / 1000)
  const secondsRemaining = closesAt ? Math.max(0, closesAt - now) : 0

  return {
    batchId: batchId ?? null,
    closesAt,
    orderCount: batchData ? Number(batchData[1]) : 0,
    settled: batchData ? batchData[2] : false,
    secondsRemaining,
    isLoading: loadingOpen || loadingBatch,
    error: errorOpen ?? null,
  }
}
