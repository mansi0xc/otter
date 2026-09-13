import React from 'react'
import { ETHERSCAN } from '@/config/contracts'
import { MAX_ORDERS_PER_BLOCK } from '@/data/gasCurve'
import type { StoryStep } from '@/hooks/useDemoStory'
import styles from './ProofRail.module.css'

interface ProofRailProps {
  step: StoryStep
  onRestart: () => void
}

const CONTRACTS = [
  { name: 'OtterOrderBook', url: ETHERSCAN.orderBook, desc: 'Verified source — batch commitment, escrow' },
  { name: 'OtterSettlement', url: ETHERSCAN.settlement, desc: 'Verified source — VCG outcome verification' },
  { name: 'OtterHook', url: ETHERSCAN.hook, desc: 'Verified source — Uniswap v4 hook' },
]

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M1 10L10 1M10 1H4M10 1V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function ProofRail({ step, onRestart }: ProofRailProps) {
  const isVisible = step === 'SETTLEMENT_AUDITABLE'

  if (!isVisible) {
    return (
      <div className={styles.footer}>
        <span className={styles.footerMeta}>
          Direct swap: rejected&nbsp;·&nbsp;LP surplus: redistributed
        </span>
        <a href={ETHERSCAN.orderBook} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
          Contracts on Sepolia <ExternalIcon />
        </a>
      </div>
    )
  }

  return (
    <div className={styles.rail}>
      <div className={styles.railInner}>
        {/* Disclaimer */}
        <div className={`${styles.disclaimer} proof-appear`}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}>
            <circle cx="7" cy="7" r="6" stroke="var(--flow-dark)" strokeWidth="1.5"/>
            <path d="M7 4v4M7 9.5v.5" stroke="var(--flow-dark)" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <span>
            Orders are submitted on Sepolia; settlement is currently demonstrated through the guided fixture.
            No public solver/relayer is running yet.
          </span>
        </div>

        {/* Contract links */}
        <div className={styles.contracts}>
          {CONTRACTS.map((c, i) => (
            <a
              key={c.name}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${styles.contractCard} proof-appear`}
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <div className={styles.contractName}>{c.name}</div>
              <div className={styles.contractDesc}>{c.desc}</div>
              <div className={styles.contractBadge}>
                <span className="tag tag-full">Verified</span>
                <ExternalIcon />
              </div>
            </a>
          ))}
        </div>

        {/* Gas stats */}
        <div className={`${styles.gasRow} proof-appear`} style={{ animationDelay: '0.4s' }}>
          <span className={styles.gasItem}>
            <span className={styles.gasN}>{MAX_ORDERS_PER_BLOCK}</span>
            <span className={styles.gasL}>orders per block, measured</span>
          </span>
          <span className={styles.gasDivider} aria-hidden="true">·</span>
          <span className={styles.gasItem}>
            <span className={styles.gasN}>40,906</span>
            <span className={styles.gasL}>gas per order at n=200</span>
          </span>
          <span className={styles.gasDivider} aria-hidden="true">·</span>
          <span className={styles.gasItem}>
            <span className={styles.gasN}>
              <a href={ETHERSCAN.orderBook} target="_blank" rel="noopener noreferrer">
                Proof ↗
              </a>
            </span>
          </span>
        </div>

        {/* Restart */}
        <div className={styles.restartRow}>
          <button id="btn-restart" className="btn btn-ghost btn-sm" onClick={onRestart}>
            ↺ Restart story
          </button>
          <span className={styles.footerCredit}>
            Implementation of Shi, Zhang, Chung &amp; Li — ePrint 2026/1877
          </span>
        </div>
      </div>
    </div>
  )
}
