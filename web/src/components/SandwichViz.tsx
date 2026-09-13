import React from 'react'
import { SANDWICH } from '@/data/sandwich'
import type { StoryStep } from '@/hooks/useDemoStory'
import styles from './SandwichViz.module.css'

interface SandwichVizProps {
  step: StoryStep
}

export function SandwichViz({ step }: SandwichVizProps) {
  const showAttack = step === 'QUEUE_ATTACK'
  const showCollapse = step === 'ORDERS_ARRIVE'

  if (!showAttack && !showCollapse) return null

  const max = Math.max(SANDWICH.fairOutEther, SANDWICH.otterOutEther)

  function pct(v: number) {
    return ((v / max) * 100).toFixed(1)
  }

  if (showCollapse) {
    // Collapse to unordered chips visual
    return (
      <div className={styles.wrap}>
        <p className={styles.caption}>
          In Otter, orders enter as an unordered set. No position to purchase.
        </p>
        <div className={styles.chips}>
          {['OTA→OTB', 'OTB→OTA', 'OTA→OTB', 'OTA→OTB', 'OTB→OTA', 'OTA→OTB'].map((label, i) => (
            <div key={i} className={`${styles.orderChip} order-arrive`}>
              <span className={styles.chipDot} style={{ background: i % 2 === 0 ? 'var(--flow-dark)' : 'var(--plum-mid)' }} />
              {label}
            </div>
          ))}
        </div>
        <p className={styles.note}>
          A searcher who joins the batch clears at the same price as everyone else.
        </p>
      </div>
    )
  }

  // QUEUE_ATTACK: show MEV sequence
  return (
    <div className={styles.wrap}>
      <div className={styles.sequence}>
        <div className={`${styles.block} ${styles.blockAttacker} block-enter`}>
          <span className={styles.blockRole}>Attacker</span>
          <span className={styles.blockAction}>Front-run: buys OTA</span>
          <span className={styles.blockCapital}>5,000 OTB capital</span>
        </div>
        <div className={`${styles.arrow} block-enter`} aria-hidden="true">↓</div>
        <div className={`${styles.block} ${styles.blockVictim} block-enter`}>
          <span className={styles.blockRole}>Victim</span>
          <span className={styles.blockAction}>Swap: 50 OTA</span>
          <span className={styles.blockResult} style={{ color: 'var(--alarm)' }}>
            Gets {SANDWICH.sandwichedOutEther.toFixed(2)} OTB
            &nbsp;instead of&nbsp;
            {SANDWICH.fairOutEther.toFixed(2)}
          </span>
        </div>
        <div className={`${styles.arrow} block-enter`} aria-hidden="true">↓</div>
        <div className={`${styles.block} ${styles.blockAttacker} block-enter`}>
          <span className={styles.blockRole}>Attacker</span>
          <span className={styles.blockAction}>Back-run: sells OTA</span>
          <span className={styles.blockResult} style={{ color: 'var(--alarm)' }}>
            Profit: {SANDWICH.searcherProfitEther.toFixed(2)} OTB
          </span>
        </div>
      </div>

      <div className={styles.stat}>
        <span className={styles.statN} style={{ color: 'var(--alarm)' }}>
          {SANDWICH.victimLossPct.toFixed(0)}%
        </span>
        <span className={styles.statL}>of victim's trade stolen on the plain pool</span>
      </div>

      <div className={styles.bars}>
        {SANDWICH.bars.map(bar => (
          <div key={bar.label} className={styles.barRow}>
            <span className={styles.barLabel}>{bar.label}</span>
            <div className={styles.barTrack}>
              <div
                className={`${styles.barFill} fill-grow`}
                style={{
                  width: `${pct(bar.valueEther)}%`,
                  background:
                    bar.color === 'alarm' ? 'var(--alarm)' :
                    bar.color === 'flow' ? 'var(--flow-dark)' : 'var(--ink-dim)',
                }}
              />
            </div>
            <span className={styles.barValue}>{bar.valueEther.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <p className={styles.note}>
        On Otter, the direct swap reverts. Zero-fee pool — which only flatters the attacker.
      </p>
    </div>
  )
}
