import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { formatUnits } from 'viem'
import { deployment } from '@/config/deployment'
import { getTransport, useWalletActions } from '@/hooks/useWalletActions'
import { processVaultExit, readVaultPosition, requestVaultExit, type VaultPosition } from '@/protocol/client'
import { uint } from '@/protocol/deployment'
import styles from './OrderComposer.module.css'

export function LiquidityExitPanel() {
  const { address, chainId } = useAccount(), action = useWalletActions()
  const [id, setId] = useState('1'), [amount, setAmount] = useState(''), [acknowledged, setAcknowledged] = useState(false)
  const [reading, setReading] = useState(false), [error, setError] = useState<string | null>(null)
  const [read, setRead] = useState<{ key: string; value: VaultPosition } | null>(null)
  const [result, setResult] = useState<{ key: string; text: string } | null>(null)
  const generation = useRef(0)
  const key = `${address?.toLowerCase() ?? ''}:${chainId ?? ''}:${id}`
  useEffect(() => {
    generation.current++; setRead(null); setResult(null); setError(null); setReading(false); setAcknowledged(false)
    return () => { generation.current++ }
  }, [key])
  if (!deployment || !address || chainId !== deployment.chainId) return null
  const d = deployment, account = address
  const position = read?.key === key ? read.value : null
  const refresh = async () => {
    const turn = ++generation.current
    setReading(true); setRead(null); setError(null)
    try {
      const value = await readVaultPosition(getTransport(), d, account, uint(id))
      if (turn === generation.current) setRead({ key, value })
    } catch (e) { if (turn === generation.current) setError(e instanceof Error ? e.message : 'Position read failed.') }
    finally { if (turn === generation.current) setReading(false) }
  }
  const request = async () => {
    if (!acknowledged) return
    const turn = generation.current
    const confirmed = await action.run((io, config, owner, progress) => requestVaultExit(io, config, owner, uint(id), uint(amount, 128), progress))
    if (turn !== generation.current) return
    setRead(null); setAcknowledged(false)
    if (confirmed) setResult({ key, text: `Exit request confirmed for position ${confirmed.positionId}, ${confirmed.liquidity} liquidity units. Processing and withdrawal are separate actions.` })
  }
  const process = async () => {
    const turn = generation.current
    const confirmed = await action.run((io, config, owner, progress) => processVaultExit(io, config, owner, uint(id), progress))
    if (turn !== generation.current) return
    setRead(null)
    if (confirmed) setResult({ key, text: `Position ${confirmed.positionId} processed: ${formatUnits(confirmed.credited0, d.assets[0].decimals)} ${d.assets[0].symbol} and ${formatUnits(confirmed.credited1, d.assets[1].decimals)} ${d.assets[1].symbol} credited to its owner. Select a liquidity exit / fee credit below to withdraw.` })
  }
  return <div className={styles.composer}>
    <h3 className={styles.title}>Exit my liquidity position</h3>
    <p className={styles.hint}>Enter the vault position ID from your deposit receipt. This flow supports positions in the configured pool; it does not discover positions in other pools.</p>
    <div className={styles.field}>
      <label htmlFor="exit-position">Vault position ID</label>
      <input id="exit-position" inputMode="numeric" value={id} onChange={e => setId(e.target.value)} disabled={action.busy || reading}/>
    </div>
    <button className="btn btn-ghost" disabled={action.busy || reading || !id} onClick={() => { void refresh() }}>{reading ? 'Reading position…' : 'Read my position'}</button>
    {position && <>
      <dl className={styles.hint}>
        <dt>Owned position / range ticks</dt><dd>{position.id.toString()} / {position.lower} to {position.upper}</dd>
        <dt>Position liquidity / queued exit</dt><dd>{position.liquidity.toString()} / {position.queued.toString()} liquidity units (L)</dd>
        <dt>Pool state at block {position.blockNumber.toString()}</dt><dd>{position.active ? 'Batch active; processing must wait' : 'Idle; a queued exit may be processed'}</dd>
      </dl>
      <div className={styles.field}>
        <label htmlFor="exit-amount">Liquidity units (L) to queue</label>
        <input id="exit-amount" inputMode="numeric" aria-describedby="exit-risk" value={amount} onChange={e => { setAmount(e.target.value); setAcknowledged(false) }} disabled={action.busy || position.queued > 0n}/>
      </div>
      <button className="btn btn-ghost btn-sm" disabled={action.busy || position.queued > 0n || position.liquidity === 0n} onClick={() => { setAmount(position.liquidity.toString()); setAcknowledged(false) }}>Use the full position liquidity</button>
      <p id="exit-risk" className={styles.hint}>An exit request cannot be cancelled and has no minimum token-output protection. It authorizes removal at the pool state when processed, which may change during the current batch. It does not withdraw tokens immediately.</p>
      <label className={styles.exitAcknowledgement}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} disabled={action.busy || position.queued > 0n}/><span>I accept the irrevocable request and variable token amounts.</span></label>
      <div className={styles.actions}>
        <button className="btn btn-primary btn-sm" disabled={action.busy || !acknowledged || !amount || position.queued > 0n || position.liquidity === 0n} onClick={() => { void request() }}>Queue my exit</button>
        <button className="btn btn-ghost btn-sm" disabled={action.busy || position.queued === 0n || position.active} onClick={() => { void process() }}>Process my queued exit into credits</button>
      </div>
      <p className={styles.hint}>The current batch can still settle. New epochs wait for reserved exits to be processed. If execution times out, expire the epoch using the recovery controls below before processing. Processing pays the position owner; anyone can call the contract.</p>
    </>}
    {result?.key === key && <p role="status" className={styles.successMsg}>{result.text}</p>}
    {action.stage && <p role="status" className={styles.hint}>{action.stage}</p>}
    {(action.error || error) && <p role="alert" className={styles.errorText}>{action.error || error}</p>}
    {action.hash && <a className={styles.txLink} href={`https://sepolia.etherscan.io/tx/${action.hash}`} target="_blank" rel="noopener noreferrer">Inspect transaction ↗</a>}
  </div>
}
