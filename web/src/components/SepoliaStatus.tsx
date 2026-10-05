import { useBatchStatus, EPOCH_STATES } from '@/hooks/useBatchStatus'
import { deployment } from '@/config/deployment'
import { OrderComposer } from './OrderComposer'
import { RecoveryPanel } from './RecoveryPanel'
import { LiquidityExitPanel } from './LiquidityExitPanel'
import styles from './SepoliaStatus.module.css'
export function SepoliaStatus() {
  const { status, loading, error } = useBatchStatus()
  return <div className={styles.wrap}>
    <div className={styles.disclaimer}><span><strong>Research prototype.</strong> Canonical payments and joint trader/LP incentives remain unresolved. The guided demo uses historical fixtures. Wallet writes require a configured version 2 deployment; no public solver is running.</span></div>
    {deployment && <div className={styles.batchInfo}>
      <div className={styles.batchRow}><span className={styles.batchLabel}>Current stored epoch</span><span className={styles.batchVal}>{loading ? 'Reading…' : status?.epoch.toString() ?? 'Unavailable'}</span></div>
      {status && <>
        <div className={styles.batchRow}><span className={styles.batchLabel}>State</span><span className={styles.batchVal}>{EPOCH_STATES[status.state] ?? 'Unknown'}</span></div>
        <div className={styles.batchRow}><span className={styles.batchLabel}>Orders</span><span className={styles.batchVal}>{status.count}</span></div>
        {status.state !== 0 && <>
          <div className={styles.batchRow}><span className={styles.batchLabel}>Collects until (Unix)</span><span className={styles.batchVal}>{status.closesAt.toString()}</span></div>
          <div className={styles.batchRow}><span className={styles.batchLabel}>Execution deadline (Unix)</span><span className={styles.batchVal}>{status.executeUntil.toString()}</span></div>
        </>}
        <p>Read at chain time {status.timestamp.toString()}. Updates every 15 seconds; wallet actions recheck the chain.</p>
      </>}
    </div>}
    {error && <p role="status" className={deployment ? styles.errorNote : styles.disclaimer}>{error}</p>}
    {deployment && <div className={styles.links}>{Object.entries(deployment.contracts).map(([name, c]) => <a key={name} className={styles.link} href={`https://sepolia.etherscan.io/address/${c.address}#code`} target="_blank" rel="noopener noreferrer">{name} ↗</a>)}</div>}
    {deployment && <><hr className="divider"/><OrderComposer/><hr className="divider"/><LiquidityExitPanel/><hr className="divider"/><RecoveryPanel/></>}
  </div>
}
