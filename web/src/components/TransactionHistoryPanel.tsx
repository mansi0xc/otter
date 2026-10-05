import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { getPublicClient } from 'wagmi/actions'
import { deployment } from '@/config/deployment'
import { wagmiConfig } from '@/config/wagmi'
import { walletJournal } from '@/protocol/walletJournal'
import { deploymentScope, type TransactionIntent, type WalletMethod } from '@/protocol/transactionJournal'
import { inspectTransaction, type TransactionInspection } from '@/protocol/inspectTransaction'
import styles from './OrderComposer.module.css'

const labels: Record<WalletMethod, string> = { approve: 'Token approval', submit: 'Order submission', expire: 'Epoch expiry',
  expireUnsupportedFees: 'Fee invalidation', refundOrder: 'Order recovery', claim: 'Credit withdrawal',
  invalidateNonces: 'Signature invalidation', requestExit: 'LP exit request', processExit: 'LP exit processing' }
const messages: Record<TransactionInspection['state'], string> = {
  unmined: 'No mined receipt at this RPC. It may be pending, dropped, cancelled or replaced. Inspect before retrying.',
  different: 'The mined transaction differs from the locally recorded intent. No requested action verified.',
  reverted: 'The intended transaction was mined and reverted. No successful action verified.',
  mined: 'The intended transaction has a successful mined receipt. This is not finality or a current balance check.',
}
export function TransactionHistoryPanel() {
  const { address, chainId } = useAccount()
  const [snapshot, setSnapshot] = useState<ReturnType<typeof walletJournal.snapshot>>({ records: [], warning: null })
  const [results, setResults] = useState<Record<string, TransactionInspection | string>>({})
  const [checking, setChecking] = useState<string | null>(null), [forgetAck, setForgetAck] = useState(false)
  const revision = useRef(0)
  const viewKey = `${address?.toLowerCase() ?? ''}:${chainId ?? ''}`
  const liveKey = useRef(viewKey); liveKey.current = viewKey
  useEffect(() => {
    const refresh = () => { revision.current++; setSnapshot(walletJournal.snapshot()); setResults({}); setChecking(null) }
    refresh(); setForgetAck(false)
    const unsubscribe = walletJournal.subscribe(refresh)
    return () => { revision.current++; unsubscribe() }
  }, [viewKey])
  if (!deployment) return null
  if (!address || chainId !== deployment.chainId) return <p className={styles.hint}>Connect the intended Sepolia wallet to view its local transaction history.</p>
  const d = deployment, scope = deploymentScope(d)
  const records = snapshot.records.filter(r => r.scope === scope && r.account.toLowerCase() === address.toLowerCase())
  const inspect = async (record: TransactionIntent) => {
    const version = ++revision.current, key = viewKey
    setChecking(record.hash); setResults(old => { const next = { ...old }; delete next[record.hash]; return next })
    try {
      const client = getPublicClient(wagmiConfig)
      if (!client) throw new Error('Sepolia RPC client unavailable.')
      const result = await inspectTransaction(client, d, record)
      if (revision.current === version && liveKey.current === key) setResults(old => ({ ...old, [record.hash]: result }))
    } catch (e) {
      if (revision.current === version && liveKey.current === key) setResults(old => ({ ...old, [record.hash]: e instanceof Error ? e.message : 'Receipt inspection failed.' }))
    } finally { if (revision.current === version && liveKey.current === key) setChecking(null) }
  }
  const forget = (record: TransactionIntent) => {
    if (!forgetAck || checking) return
    try { walletJournal.forget(record.hash); setForgetAck(false) }
    catch (e) { setResults(old => ({ ...old, [record.hash]: e instanceof Error ? e.message : 'Could not forget the local record.' })) }
  }
  return <div className={styles.composer}>
    <h3 className={styles.title}>Local transaction history</h3>
    <p className={styles.hint}>Saved in this browser for this wallet and deployment. Receipt checks only read Sepolia; they never sign or resend an action. Local records can be changed or cleared and are not authenticated proof. Save important transaction hashes and admission IDs separately.</p>
    {snapshot.warning && <p role="alert" className={styles.errorText}>{snapshot.warning}</p>}
    {!records.length && <p className={styles.hint}>No saved transactions for this wallet and manifest. Another browser, an old manifest or a wallet broadcast interrupted before returning its hash will not appear here.</p>}
    {records.map(record => {
      const result = results[record.hash], checked = result && typeof result !== 'string' ? result : null
      return <div key={record.hash} className={styles.historyRecord}>
        <strong>{labels[record.functionName]}</strong>
        <span className={styles.hint}>Recorded locally: {new Date(record.recordedAt).toISOString()}</span>
        <span className={styles.historyHash}>{record.hash}</span>
        <a className={styles.txLink} href={`https://sepolia.etherscan.io/tx/${record.observedHash ?? record.hash}`} target="_blank" rel="noopener noreferrer">Inspect {record.observedHash && record.observedHash !== record.hash ? 'observed replacement' : 'transaction'} ↗</a>
        {record.observedHash && record.observedHash !== record.hash && <span className={styles.historyHash}>Observed receipt: {record.observedHash}</span>}
        <div className={styles.actions}>
          <button className="btn btn-ghost btn-sm" disabled={!!checking} onClick={() => { void inspect(record) }}>{checking === record.hash ? 'Reading receipt…' : 'Check mined receipt'}</button>
          <button className="btn btn-ghost btn-sm" disabled={!forgetAck || !!checking} onClick={() => forget(record)}>Forget local record</button>
        </div>
        {typeof result === 'string' && <p role="alert" className={styles.errorText}>{result}</p>}
        {checked && <p role="status" className={checked.state === 'mined' ? styles.hint : styles.errorText}>{messages[checked.state]}{checked.block !== undefined && ` Checked at block ${checked.block.toString()}.`}</p>}
        {checked?.admission && <p className={styles.hint}>Admitted epoch <strong>{checked.admission.epoch.toString()}</strong>, stored index <strong>{checked.admission.index}</strong>. Use these IDs in recovery after checking the epoch state; this receipt does not mean settled or refundable.</p>}
      </div>
    })}
    {!!records.length && <label className={styles.exitAcknowledgement}><input type="checkbox" checked={forgetAck} disabled={!!checking} onChange={e => setForgetAck(e.target.checked)}/><span>I saved the hashes I need. Forgetting removes only this browser’s record; it does not cancel, refund or reverse any transaction.</span></label>}
    <p className={styles.hint}>One mined receipt can be reorganized. Recheck before acting. Replacement discovery after a reload and wallet actions in other tabs are not coordinated here.</p>
  </div>
}
