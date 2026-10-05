import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { deployment } from '@/config/deployment'
import { getTransport, useWalletActions } from '@/hooks/useWalletActions'
import { claim, expireEpoch, invalidateNonce, readClaims, readEpoch, recoverOrder, type EpochStatus } from '@/protocol/client'
import { exactUnits } from '@/protocol/orders'
import { uint } from '@/protocol/deployment'
import { EPOCH_STATES } from '@/hooks/useBatchStatus'
import styles from './OrderComposer.module.css'
export function RecoveryPanel() {
  const { address, chainId } = useAccount(), action = useWalletActions()
  const [epoch, setEpoch] = useState('0'), [index, setIndex] = useState('0'), [nonce, setNonce] = useState('0')
  const [recipient, setRecipient] = useState(''), [amount, setAmount] = useState(''), [selected, setSelected] = useState(0)
  const [claims, setClaims] = useState<bigint[] | null>(null), [status, setStatus] = useState<EpochStatus | null>(null)
  const [readError, setReadError] = useState<string | null>(null), [reading, setReading] = useState(false)
  useEffect(() => { setClaims(null); setStatus(null); setRecipient(address ?? ''); setReadError(null) }, [address, chainId])
  if (!deployment || !address || chainId !== deployment.chainId) return null
  const d = deployment, account = address
  const refresh = async () => {
    setReading(true); setReadError(null); setClaims(null); setStatus(null)
    try {
      const [newClaims, newStatus] = await Promise.all([readClaims(getTransport(), d, account), readEpoch(getTransport(), d, uint(epoch))])
      const current = await getTransport().session()
      if (current.address.toLowerCase() !== account.toLowerCase() || current.chainId !== d.chainId) throw new Error('Wallet changed; refresh again.')
      setClaims(newClaims); setStatus(newStatus)
    } catch (e) { setReadError(e instanceof Error ? e.message : 'Recovery read failed.') }
    finally { setReading(false) }
  }
  const target = selected < 2 ? 'orderBook' as const : selected < 4 ? 'rewardLedger' as const : 'liquidityGuard' as const
  const assetIndex = (selected % 2) as 0 | 1, asset = d.assets[assetIndex]
  const run = (fn: Parameters<typeof action.run>[0]) => { void action.run(fn).then(() => { setClaims(null); setStatus(null) }) }
  return <div className={styles.composer}>
    <h3 className={styles.title}>Recovery &amp; claims</h3>
    <p className={styles.hint}>Recovery credits the stored trader’s budget. Withdraw that credit separately. It requires no solver or replay of every order; older epochs remain accessible.</p>
    <div className={styles.fields}>
      <div className={styles.field}><label htmlFor="recovery-epoch">Epoch to inspect or recover</label><input id="recovery-epoch" inputMode="numeric" value={epoch} onChange={e => { setEpoch(e.target.value); setStatus(null) }} disabled={action.busy || reading}/></div>
      <div className={styles.field}><label htmlFor="recovery-index">Your stored order index (0–31)</label><input id="recovery-index" inputMode="numeric" value={index} onChange={e => setIndex(e.target.value)} disabled={action.busy}/></div>
    </div>
    <button className="btn btn-ghost" disabled={action.busy || reading} onClick={() => { void refresh() }}>Read epoch &amp; my funded claims</button>
    {status && <p className={styles.hint}>Epoch {status.epoch.toString()}: {EPOCH_STATES[status.state] ?? 'Unknown'}. {status.count} stored orders. Execution deadline: {status.executeUntil.toString()} Unix seconds. Read at chain time {status.timestamp.toString()}.</p>}
    <div className={styles.actions}>
      <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => run((io, config, owner, progress) => expireEpoch(io, config, owner, uint(epoch), progress))}>Expire after execution deadline</button>
      <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => run((io, config, owner, progress) => expireEpoch(io, config, owner, uint(epoch), progress, true))}>Expire if pool fees are unsupported</button>
      <button className="btn btn-primary btn-sm" disabled={action.busy} onClick={() => run((io, config, owner, progress) => recoverOrder(io, config, owner, uint(epoch), uint(index), progress))}>Recover my stored order</button>
    </div>
    <div className={styles.field}><label htmlFor="claim-source">Funded claim to withdraw</label><select id="claim-source" value={selected} onChange={e => { setSelected(Number(e.target.value)); setAmount('') }} disabled={action.busy}>{[0, 1, 2, 3, 4, 5].map(i => <option key={i} value={i}>{i < 2 ? 'Trader' : i < 4 ? 'LP / community reward' : 'Liquidity exit / fee credit'}: {d.assets[i % 2].symbol}{claims ? ` — ${formatUnits(claims[i], d.assets[i % 2].decimals)}` : ' — refresh to read'}</option>)}</select></div>
    {target === 'liquidityGuard' && <p className={styles.hint}>These vault credits contain liquidity principal and collected core fees, separately from Otter rewards. Large balances may need multiple withdrawals; each is capped at {(2n ** 120n - 1n).toString()} raw units.</p>}
    <div className={styles.field}><label htmlFor="claim-amount">Amount ({asset.symbol})</label><input id="claim-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={action.busy}/></div>
    <div className={styles.field}><label htmlFor="claim-recipient">Recipient address</label><input id="claim-recipient" value={recipient} onChange={e => setRecipient(e.target.value)} disabled={action.busy}/></div>
    <button className="btn btn-primary" disabled={action.busy || !amount || !recipient} onClick={() => run((io, config, owner, progress) => claim(io, config, owner, target, assetIndex, exactUnits(amount, asset.decimals), recipient, progress))}>Withdraw selected funded claim</button>
    <p className={styles.hint}>A failed delivery affects only this withdrawal. LP rewards remain part of the prototype and do not establish the paper’s combined incentive guarantees.</p>
    <div className={styles.field}><label htmlFor="invalidate-nonce">Signature nonce to invalidate</label><input id="invalidate-nonce" inputMode="numeric" value={nonce} onChange={e => setNonce(e.target.value)} disabled={action.busy}/></div>
    <p className={styles.hint}>Invalidation cancels an unused signature. It does not cancel or refund an admitted order.</p>
    <button className="btn btn-ghost" disabled={action.busy} onClick={() => run((io, config, owner, progress) => invalidateNonce(io, config, owner, uint(nonce), progress))}>Invalidate this signature nonce</button>
    {action.stage && <p role="status" className={styles.hint}>{action.stage}</p>}
    {(action.error || readError) && <p role="alert" className={styles.errorText}>{action.error || readError}</p>}
    {action.hash && <a className={styles.txLink} href={`https://sepolia.etherscan.io/tx/${action.hash}`} target="_blank" rel="noopener noreferrer">Inspect transaction ↗</a>}
  </div>
}
