import React, { useState } from 'react'
import { useAccount } from 'wagmi'
import { useSubmitOrder, type OrderSide } from '@/hooks/useSubmitOrder'
import { useMintTokens } from '@/hooks/useMintTokens'
import { ETHERSCAN } from '@/config/contracts'
import styles from './OrderComposer.module.css'

const STEP_LABELS: Record<string, string> = {
  IDLE: 'Place an order',
  APPROVING: 'Approving token…',
  APPROVED: 'Approved — ready to sign',
  SIGNING: 'Sign the order in your wallet…',
  SUBMITTING: 'Submitting to OtterOrderBook…',
  DONE: 'Order submitted!',
  ERROR: 'Something went wrong',
}

export function OrderComposer() {
  const { isConnected } = useAccount()
  const { step, txHash, error, approve, submit, reset } = useSubmitOrder()
  const { isMinting, mint, error: mintError, txHash: mintTx } = useMintTokens()

  const [side, setSide] = useState<OrderSide>('OTA')
  const [budget, setBudget] = useState('10')
  const [ask, setAsk] = useState('0.95')

  if (!isConnected) {
    return (
      <div className={styles.disconnected}>
        <p>Connect a Sepolia wallet to place real orders.</p>
        <p className={styles.hint}>
          The demo story above works without a wallet.
        </p>
      </div>
    )
  }

  const handleApprove = () => {
    approve({ side, budgetEther: budget, askEther: ask })
  }

  const isIdle = step === 'IDLE' || step === 'ERROR'
  const canSign = step === 'APPROVED'
  const isDone = step === 'DONE'
  const isWorking = step === 'APPROVING' || step === 'SIGNING' || step === 'SUBMITTING'

  return (
    <div className={styles.composer}>
      <h3 className={styles.title}>Place an order</h3>

      {/* Faucet */}
      <div className={styles.faucet}>
        <span className={styles.faucetLabel}>Need tokens?</span>
        <button
          id="btn-mint-ota"
          className="btn btn-ghost btn-sm"
          disabled={isMinting}
          onClick={() => mint('OTA', '100')}
        >
          Mint 100 OTA
        </button>
        <button
          id="btn-mint-otb"
          className="btn btn-ghost btn-sm"
          disabled={isMinting}
          onClick={() => mint('OTB', '100')}
        >
          Mint 100 OTB
        </button>
        {mintTx && (
          <a
            href={`${ETHERSCAN.base}/tx/${mintTx}`}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.txLink}
          >
            Tx ↗
          </a>
        )}
        {mintError && <span className={styles.errorText}>{mintError}</span>}
      </div>

      {isDone ? (
        <div className={styles.success}>
          <span className={styles.successIcon}>✓</span>
          <div>
            <p className={styles.successMsg}>Order submitted to batch.</p>
            {txHash && (
              <a
                href={`${ETHERSCAN.base}/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.txLink}
              >
                View transaction ↗
              </a>
            )}
            <p className={styles.settlementNote}>
              Settlement is currently demonstrated through the guided fixture — no public solver is running.
            </p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={reset}>New order</button>
        </div>
      ) : (
        <div className={styles.form}>
          <div className={styles.sideToggle}>
            <button
              id="side-ota"
              className={`btn btn-sm ${side === 'OTA' ? styles.sideActive : styles.sideInactive}`}
              onClick={() => setSide('OTA')}
              disabled={isWorking}
              aria-pressed={side === 'OTA'}
            >
              Sell OTA
            </button>
            <button
              id="side-otb"
              className={`btn btn-sm ${side === 'OTB' ? styles.sideActive : styles.sideInactive}`}
              onClick={() => setSide('OTB')}
              disabled={isWorking}
              aria-pressed={side === 'OTB'}
            >
              Sell OTB
            </button>
          </div>

          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor="order-budget">
                Budget ({side}) — tokens to sell
              </label>
              <input
                id="order-budget"
                type="number"
                min="0"
                step="0.1"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                disabled={isWorking}
                placeholder="10"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="order-ask">
                Minimum price (ask)
                <span className={styles.fieldHint}> — {side === 'OTA' ? 'OTB' : 'OTA'} per token sold</span>
              </label>
              <input
                id="order-ask"
                type="number"
                min="0"
                step="0.01"
                value={ask}
                onChange={e => setAsk(e.target.value)}
                disabled={isWorking}
                placeholder="0.95"
              />
            </div>
          </div>

          <div className={styles.stepper}>
            {/* Step 1: Approve */}
            <div className={`${styles.stepItem} ${(step === 'APPROVING' || step === 'APPROVED') ? styles.stepActive : ''}`}>
              <span className={styles.stepNum}>1</span>
              <span className={styles.stepLabel}>Approve</span>
            </div>
            <span className={styles.stepArrow} aria-hidden="true">→</span>
            {/* Step 2: Sign */}
            <div className={`${styles.stepItem} ${step === 'SIGNING' ? styles.stepActive : ''}`}>
              <span className={styles.stepNum}>2</span>
              <span className={styles.stepLabel}>Sign EIP-712</span>
            </div>
            <span className={styles.stepArrow} aria-hidden="true">→</span>
            {/* Step 3: Submit */}
            <div className={`${styles.stepItem} ${step === 'SUBMITTING' ? styles.stepActive : ''}`}>
              <span className={styles.stepNum}>3</span>
              <span className={styles.stepLabel}>Submit</span>
            </div>
          </div>

          {error && <p className={styles.errorText}>{error}</p>}

          <div className={styles.actions}>
            {isIdle && (
              <button
                id="btn-approve"
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={!budget || !ask}
              >
                Approve {side}
              </button>
            )}
            {canSign && (
              <button
                id="btn-sign-submit"
                className="btn btn-flow"
                onClick={submit}
              >
                Sign &amp; submit order
              </button>
            )}
            {isWorking && (
              <span className={styles.working}>{STEP_LABELS[step]}</span>
            )}
            {step === 'ERROR' && (
              <button className="btn btn-ghost btn-sm" onClick={reset}>Try again</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
