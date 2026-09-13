import React from 'react'
import { DEMO_BATCH } from '@/data/demoBatch'
import type { StoryStep } from '@/hooks/useDemoStory'
import styles from './OutcomePanel.module.css'

interface OutcomePanelProps {
  step: StoryStep
}

const INVARIANTS = [
  { label: 'Feasibility', desc: 'Pool conservation holds — net swap matches the curve.' },
  { label: 'Individual rationality', desc: 'No seller paid less than its stated reservation value.' },
  { label: 'Budget bounds', desc: 'No order filled beyond its own budget.' },
  { label: 'Curve conservation', desc: 'Virtual reserves after settlement satisfy the invariant.' },
]

function fmt(n: number, d = 4) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function OutcomePanel({ step }: OutcomePanelProps) {
  const isVisible = step === 'SOLVER_VERIFIES' || step === 'SETTLEMENT_AUDITABLE'
  if (!isVisible) return null

  const { orders, burnEther, burnPpm } = DEMO_BATCH

  const excluded = orders.filter(o => o.outcome === 'excluded' || o.outcome === 'ineligible')

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Outcome &amp; proof</h3>
      <p className={styles.motto}>
        The solver proposes. The contract refuses bad outcomes.
      </p>

      <div className={styles.rows}>
        {orders.map(order => (
          <div key={order.index} className={`${styles.row} outcome-reveal`}>
            <span className={styles.rowLabel}>
              Order {order.index}
              <span className={styles.rowSide}> {order.sellsCurrency0 ? 'OTA→OTB' : 'OTB→OTA'}</span>
            </span>
            <div className={styles.rowBar}>
              <div
                className={`${styles.rowFill} fill-grow`}
                style={{
                  width: order.budgetEther > 0
                    ? `${(order.filledEther / order.budgetEther) * 100}%`
                    : '0%',
                  background:
                    order.outcome === 'full' ? 'var(--flow-dark)' :
                    order.outcome === 'partial' ? '#a0631e' : 'var(--rule)',
                }}
              />
            </div>
            <span className={styles.rowFillVal}>
              {order.outcome === 'excluded' || order.outcome === 'ineligible'
                ? '—'
                : `${fmt(order.filledEther, 2)} filled`}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.surplus}>
        <div className={styles.surplusItem}>
          <span className={styles.surplusN} style={{ color: 'var(--flow-dark)' }}>
            {fmt(burnEther, 4)}
          </span>
          <span className={styles.surplusL}>LP surplus redistributed</span>
        </div>
        <div className={styles.surplusItem}>
          <span className={styles.surplusN}>{burnPpm.toLocaleString()} ppm</span>
          <span className={styles.surplusL}>of the batch volume</span>
        </div>
        <div className={styles.surplusItem}>
          <span className={styles.surplusN}>{excluded.length}</span>
          <span className={styles.surplusL}>orders excluded or ineligible</span>
        </div>
      </div>

      <div className={styles.invariants}>
        <h4 className={styles.invariantsTitle}>On-chain verification</h4>
        {INVARIANTS.map((inv, i) => (
          <div key={i} className={`${styles.invRow} outcome-reveal`}>
            <span className={styles.invCheck} aria-label="Passed">✓</span>
            <div>
              <span className={styles.invLabel}>{inv.label}</span>
              <span className={styles.invDesc}> — {inv.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
