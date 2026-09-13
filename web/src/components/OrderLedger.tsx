import React, { useState } from 'react'
import { DEMO_BATCH, type DemoOrder } from '@/data/demoBatch'
import type { StoryStep } from '@/hooks/useDemoStory'
import styles from './OrderLedger.module.css'

interface OrderLedgerProps {
  step: StoryStep
}

function fmt(n: number, d = 3) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

function OrderChip({
  order,
  isSelected,
  isLocked,
  isRevealed,
  onClick,
}: {
  order: DemoOrder
  isSelected: boolean
  isLocked: boolean
  isRevealed: boolean
  onClick: () => void
}) {
  const tagClass = {
    full: 'tag-full',
    partial: 'tag-partial',
    excluded: 'tag-excluded',
    ineligible: 'tag-ineligible',
  }[order.outcome]

  const chipClass = [
    styles.chip,
    'order-arrive',
    isSelected ? styles.chipSelected : '',
    isLocked ? styles.chipLocked : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      className={chipClass}
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`Order ${order.index}: ${order.sellsCurrency0 ? 'sells OTA' : 'sells OTB'}, budget ${fmt(order.budgetEther, 2)}, ${order.label}`}
    >
      <div className={styles.chipTop}>
        <span className={styles.chipToken}>
          {order.sellsCurrency0 ? 'OTA→OTB' : 'OTB→OTA'}
        </span>
        {isRevealed && (
          <span className={`tag ${tagClass}`}>{order.label}</span>
        )}
      </div>
      <div className={styles.chipBudget}>
        {fmt(order.budgetEther, 2)} <span className={styles.chipUnit}>budget</span>
      </div>
      {isRevealed && order.outcome !== 'excluded' && order.outcome !== 'ineligible' && (
        <div className={styles.chipFill}>
          <div className={styles.chipBar}>
            <div
              className={`${styles.chipBarFill} fill-grow`}
              style={{
                width: `${(order.filledEther / order.budgetEther) * 100}%`,
                background: order.outcome === 'full' ? 'var(--flow-dark)' : '#a0631e',
              }}
            />
          </div>
        </div>
      )}
    </button>
  )
}

function OrderDetail({ order }: { order: DemoOrder }) {
  const tagClass = {
    full: 'tag-full',
    partial: 'tag-partial',
    excluded: 'tag-excluded',
    ineligible: 'tag-ineligible',
  }[order.outcome]

  return (
    <div className={`${styles.detail} outcome-reveal`}>
      <div className={styles.detailHeader}>
        <span className={styles.detailTitle}>
          Order {order.index} · {order.sellsCurrency0 ? 'OTA → OTB' : 'OTB → OTA'}
        </span>
        <span className={`tag ${tagClass}`}>{order.label}</span>
      </div>
      <dl className={styles.detailGrid}>
        <dt>Ask (min price)</dt>
        <dd className="mono">{fmt(order.askEther, 4)}</dd>
        <dt>Budget</dt>
        <dd className="mono">{fmt(order.budgetEther, 4)} {order.sellsCurrency0 ? 'OTA' : 'OTB'}</dd>
        <dt>Filled</dt>
        <dd className="mono" style={{ color: 'var(--flow-dark)' }}>{fmt(order.filledEther, 4)}</dd>
        <dt>Paid out</dt>
        <dd className="mono">{fmt(order.paidEther, 4)} {order.sellsCurrency0 ? 'OTB' : 'OTA'}</dd>
        <dt>Refund</dt>
        <dd className="mono" style={{ color: order.refundEther > 0 ? '#a0631e' : 'var(--ink-dim)' }}>
          {fmt(order.refundEther, 4)} {order.sellsCurrency0 ? 'OTA' : 'OTB'}
        </dd>
      </dl>
      {order.outcome === 'ineligible' && (
        <p className={styles.detailNote}>Ask exceeds the 1:1 reference price — ineligible by rule, not by queue.</p>
      )}
      {order.outcome === 'excluded' && (
        <p className={styles.detailNote}>Priced out by the marginal surplus curve — no funds transferred.</p>
      )}
    </div>
  )
}

export function OrderLedger({ step }: OrderLedgerProps) {
  const [selected, setSelected] = useState<number | null>(null)

  // When the ledger locks (step ≥ BATCH_CLOSES), show fills
  const isRevealed = step === 'SOLVER_VERIFIES' || step === 'SETTLEMENT_AUDITABLE'
  const isLocked = step === 'BATCH_CLOSES' || step === 'SOLVER_VERIFIES' || step === 'SETTLEMENT_AUDITABLE'
  const isVisible = step !== 'QUEUE_ATTACK'

  if (!isVisible) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderText}>
          The order ledger opens in step 2, when orders arrive into the batch.
        </p>
      </div>
    )
  }

  const handleSelect = (idx: number) => {
    if (!isRevealed) return
    setSelected(prev => prev === idx ? null : idx)
  }

  const selectedOrder = selected !== null ? DEMO_BATCH.orders[selected] : null

  return (
    <div className={styles.ledger}>
      <div className={styles.ledgerHeader}>
        <h3 className={styles.ledgerTitle}>Tidal order ledger</h3>
        {isLocked && (
          <span className={styles.lockedBadge} aria-label="Batch window closed">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <rect x="2" y="5" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M4 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Sealed
          </span>
        )}
      </div>

      {!isLocked && (
        <p className={styles.ledgerSubtitle}>
          Orders arrive together. They settle fair.
        </p>
      )}

      <div className={styles.chips}>
        {DEMO_BATCH.orders.map(order => (
          <OrderChip
            key={order.index}
            order={order}
            isSelected={selected === order.index}
            isLocked={isLocked}
            isRevealed={isRevealed}
            onClick={() => handleSelect(order.index)}
          />
        ))}
      </div>

      {isRevealed && !selectedOrder && (
        <p className={styles.selectHint}>Select an order to see its fill, payment, and refund.</p>
      )}

      {isRevealed && selectedOrder && (
        <OrderDetail order={selectedOrder} />
      )}
    </div>
  )
}
