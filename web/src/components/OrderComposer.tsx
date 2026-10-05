import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useSubmitOrder } from '@/hooks/useSubmitOrder'
import { deployment, deploymentError } from '@/config/deployment'
import styles from './OrderComposer.module.css'
export function OrderComposer() {
  const { isConnected, chainId } = useAccount(), action = useSubmitOrder()
  const [side, setSide] = useState(true), [budget, setBudget] = useState('10'), [ask, setAsk] = useState('0.95'), [word, setWord] = useState('0')
  if (!deployment) return <p className={styles.hint}>{deploymentError}</p>
  if (!isConnected || chainId !== deployment.chainId) return <p className={styles.hint}>Connect the intended wallet on Ethereum Sepolia to submit or recover orders.</p>
  const sold = deployment.assets[side ? 0 : 1], received = deployment.assets[side ? 1 : 0]
  return <div className={styles.composer}>
    <h3 className={styles.title}>Submit an order</h3>
    <p className={styles.hint}>Orders are public and escrow your budget. Payment and incentive gaps remain unresolved. No public solver is running; an unexecuted epoch can be recovered after its execution deadline.</p>
    <div className={styles.sideToggle}>{deployment.assets.map((a, i) => <button key={a.address} className="btn btn-sm" aria-pressed={side === (i === 0)} disabled={action.busy} onClick={() => setSide(i === 0)}>Sell {a.symbol}</button>)}</div>
    <div className={styles.fields}>
      <div className={styles.field}><label htmlFor="order-budget">Budget ({sold.symbol})</label><input id="order-budget" inputMode="decimal" value={budget} onChange={e => setBudget(e.target.value)} disabled={action.busy}/></div>
      <div className={styles.field}><label htmlFor="order-ask">Minimum price ({received.symbol} per {sold.symbol})</label><input id="order-ask" inputMode="decimal" value={ask} onChange={e => setAsk(e.target.value)} disabled={action.busy}/></div>
      <div className={styles.field}><label htmlFor="order-word">Starting nonce word</label><input id="order-word" inputMode="numeric" value={word} onChange={e => setWord(e.target.value)} disabled={action.busy}/></div>
    </div>
    <p className={styles.hint}>Approval is limited to the budget and confirmed before signing. ETH is attached as the exact budget. Admission validity is at most 60 seconds; the signed execution cap includes 60 seconds for the first order to open the epoch.</p>
    <button className="btn btn-primary" disabled={action.busy || !budget || !ask} onClick={() => { void action.submit(side, budget, ask, word) }}>Approve if needed, sign &amp; submit</button>
    {action.order && <dl className={styles.hint}><dt>Signed epoch / configuration / nonce</dt><dd>{action.order.epoch.toString()} / {action.order.configVersion.toString()} / {action.order.nonce.toString()}</dd><dt>Admission deadline (Unix seconds)</dt><dd>{action.order.deadline.toString()}</dd><dt>Latest permitted execution boundary (Unix seconds)</dt><dd>{action.order.maxExecutionTime.toString()}</dd></dl>}
    {action.stage && <p role="status" className={styles.hint}>{action.stage}</p>}
    {action.error && <p role="alert" className={styles.errorText}>{action.error}</p>}
    {action.hash && <a className={styles.txLink} href={`https://sepolia.etherscan.io/tx/${action.hash}`} target="_blank" rel="noopener noreferrer">Inspect transaction ↗</a>}
    {action.admission && <p className={styles.successMsg}>Confirmed admission: epoch {action.admission.epoch.toString()}, order index {action.admission.index}. Save these values for recovery. Settlement is a separate action.</p>}
  </div>
}
