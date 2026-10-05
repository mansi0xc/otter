import { createTransactionJournal } from './transactionJournal.ts'

export const walletJournal = createTransactionJournal(() => window.localStorage)
// Separate keys per transaction avoid overwriting another tab's unrelated records.
// This is history synchronization, not a lock on other tabs' wallet actions.
if (typeof window !== 'undefined') window.addEventListener('storage', () => walletJournal.notify())
