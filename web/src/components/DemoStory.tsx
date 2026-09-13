import React, { useEffect, useState } from 'react'
import { useDemoStory, STORY_COPY, type StoryStep } from '@/hooks/useDemoStory'
import { BatchClock } from './BatchClock'
import { SandwichViz } from './SandwichViz'
import { OrderLedger } from './OrderLedger'
import { OutcomePanel } from './OutcomePanel'
import { ProofRail } from './ProofRail'
import styles from './DemoStory.module.css'

const STEP_NAMES: Record<StoryStep, string> = {
  QUEUE_ATTACK:           '1 · Queue attack',
  ORDERS_ARRIVE:          '2 · Orders arrive',
  BATCH_CLOSES:           '3 · Batch closes',
  SOLVER_VERIFIES:        '4 · Solver verifies',
  SETTLEMENT_AUDITABLE:   '5 · Settlement',
}

const WINDOW = 60


export function DemoStory() {
  const story = useDemoStory()
  const { step, stepIndex, isFirst, isLast, next, prev, restart } = story

  // Simulated clock — counts down in ORDERS_ARRIVE step
  const [demoSeconds, setDemoSeconds] = useState(WINDOW)

  useEffect(() => {
    if (step === 'ORDERS_ARRIVE') {
      setDemoSeconds(WINDOW)
      const id = setInterval(() => {
        setDemoSeconds(s => {
          if (s <= 0) { clearInterval(id); return 0 }
          return s - 1
        })
      }, 80) // 80ms per tick = fast demo clock (~5s to close)
      return () => clearInterval(id)
    }
    if (step === 'BATCH_CLOSES' || step === 'SOLVER_VERIFIES' || step === 'SETTLEMENT_AUDITABLE') {
      setDemoSeconds(0)
    }
    if (step === 'QUEUE_ATTACK') {
      setDemoSeconds(WINDOW)
    }
  }, [step])

  const clockSeconds = demoSeconds
  const isFrozen = step !== 'ORDERS_ARRIVE'

  const copy = STORY_COPY[step]

  return (
    <div className={styles.story}>
      {/* ── Step rail ── */}
      <nav className={styles.stepRail} aria-label="Demo story steps">
        {(Object.keys(STEP_NAMES) as StoryStep[]).map((s) => (
          <button
            key={s}
            className={`${styles.stepBtn} ${s === step ? styles.stepBtnActive : ''}`}
            onClick={() => story.goTo(s)}
            aria-current={s === step ? 'step' : undefined}
            aria-label={STEP_NAMES[s]}
          >
            <span className={`${styles.stepDot} ${s === step ? 'step-active-pulse' : ''}`} />
            <span className={styles.stepName}>{STEP_NAMES[s]}</span>
          </button>
        ))}
      </nav>

      {/* ── Main layout ── */}
      <div className={styles.layout}>
        {/* Left column */}
        <div className={styles.leftCol}>
          {/* Clock — hidden in step 1 (no batch yet) */}
          {step !== 'QUEUE_ATTACK' && (
            <div className={`${styles.clockRow} water-current`}>
              <BatchClock
                secondsRemaining={clockSeconds}
                windowSeconds={WINDOW}
                isDemo
                frozen={isFrozen}
              />
              <div className={styles.batchMeta}>
                <div className={styles.batchMetaRow}>
                  <span className={styles.metaLabel}>Orders</span>
                  <span className={styles.metaVal}>6</span>
                </div>
                <div className={styles.batchMetaRow}>
                  <span className={styles.metaLabel}>Reference price</span>
                  <span className={styles.metaVal}>1:1</span>
                </div>
                <div className={styles.batchMetaRow}>
                  <span className={styles.metaLabel}>Pool</span>
                  <span className={styles.metaVal}>OTA / OTB</span>
                </div>
                <div className={styles.batchMetaRow}>
                  <span className={styles.metaLabel}>Status</span>
                  <span className={styles.metaVal}>
                    {step === 'BATCH_CLOSES' || step === 'SOLVER_VERIFIES' || step === 'SETTLEMENT_AUDITABLE'
                      ? <span className="tag tag-settled">Sealed</span>
                      : <span className="tag tag-live">Live</span>}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Story copy */}
          <div className={styles.storyCopy}>
            <h2 className={styles.storyTitle}>{copy.title}</h2>
            <p className={styles.storyBody}>{copy.body}</p>
          </div>

          {/* Sandwich viz (steps 1 & 2) */}
          <SandwichViz step={step} />
        </div>

        {/* Right column */}
        <div className={styles.rightCol}>
          {/* Order ledger */}
          <OrderLedger step={step} />

          {/* Outcome panel (steps 4 & 5) */}
          <OutcomePanel step={step} />
        </div>
      </div>

      {/* ── Navigation ── */}
      <div className={styles.nav}>
        <button
          id="btn-prev-step"
          className="btn btn-ghost btn-sm"
          onClick={prev}
          disabled={isFirst}
          aria-label="Previous step"
        >
          ← Prev
        </button>
        <span className={styles.navProgress} aria-live="polite">
          Step {stepIndex + 1} of 5
        </span>
        {isLast ? (
          <button
            id="btn-restart-story"
            className="btn btn-primary btn-sm"
            onClick={restart}
          >
            ↺ Restart
          </button>
        ) : (
          <button
            id="btn-next-step"
            className="btn btn-primary btn-sm"
            onClick={next}
            aria-label="Next step"
          >
            Next →
          </button>
        )}
      </div>

      {/* ── Proof rail ── */}
      <ProofRail step={step} onRestart={restart} />
    </div>
  )
}
