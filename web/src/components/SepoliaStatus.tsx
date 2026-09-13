import React from 'react'
import { useBatchStatus } from '@/hooks/useBatchStatus'
import { ETHERSCAN } from '@/config/contracts'
import { BatchClock } from './BatchClock'
import { OrderComposer } from './OrderComposer'
import styles from './SepoliaStatus.module.css'

const WINDOW_SECONDS = 60

export function SepoliaStatus() {
  const { batchId, closesAt, orderCount, settled, secondsRemaining, isLoading, error } = useBatchStatus()

  return (
    <div className={styles.wrap}>
      {/* Solver disclaimer — prominent */}
      <div className={styles.disclaimer}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M7 4v4M7 9.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span>
          <strong>No public solver is running.</strong> Orders are submitted on Sepolia;
          settlement is currently demonstrated through the guided fixture.
          The guided demo shows what a real settlement looks like.
        </span>
      </div>

      {/* Live batch panel */}
      <div className={styles.livePanel}>
        <div className={styles.clockWrap}>
          <BatchClock
            secondsRemaining={secondsRemaining}
            windowSeconds={WINDOW_SECONDS}
            isDemo={false}
          />
        </div>

        <div className={styles.batchInfo}>
          <div className={styles.batchRow}>
            <span className={styles.batchLabel}>Batch</span>
            <span className={styles.batchVal}>
              {isLoading ? '…' : batchId !== null ? `#${batchId.toString()}` : '—'}
            </span>
          </div>
          <div className={styles.batchRow}>
            <span className={styles.batchLabel}>Status</span>
            <span className={styles.batchVal}>
              {isLoading ? '…' :
                settled ? <span className="tag tag-settled">Settled</span> :
                secondsRemaining > 0 ? <span className="tag tag-live">Live</span> :
                <span className="tag">Closed</span>}
            </span>
          </div>
          <div className={styles.batchRow}>
            <span className={styles.batchLabel}>Orders</span>
            <span className={styles.batchVal}>{isLoading ? '…' : orderCount}</span>
          </div>
          <div className={styles.batchRow}>
            <span className={styles.batchLabel}>Reference price</span>
            <span className={styles.batchVal}>1:1</span>
          </div>
          {closesAt && (
            <div className={styles.batchRow}>
              <span className={styles.batchLabel}>Closes at</span>
              <span className={styles.batchVal} style={{ fontSize: '0.75rem' }}>
                {new Date(closesAt * 1000).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className={styles.errorNote}>
          Could not read live batch: {error.message}
        </p>
      )}

      <div className={styles.links}>
        <a href={ETHERSCAN.orderBook} target="_blank" rel="noopener noreferrer" className={styles.link}>
          OtterOrderBook ↗
        </a>
        <a href={ETHERSCAN.settlement} target="_blank" rel="noopener noreferrer" className={styles.link}>
          OtterSettlement ↗
        </a>
        <a href={ETHERSCAN.hook} target="_blank" rel="noopener noreferrer" className={styles.link}>
          OtterHook ↗
        </a>
      </div>

      <hr className="divider" />

      {/* Order composer lives here in Sepolia mode */}
      <OrderComposer />
    </div>
  )
}
