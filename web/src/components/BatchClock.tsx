import React, { useEffect, useRef, useState } from 'react'
import styles from './BatchClock.module.css'

interface BatchClockProps {
  /** seconds remaining (0 = closed) */
  secondsRemaining: number
  /** total window duration for the arc calculation */
  windowSeconds: number
  /** whether this is a simulated demo clock */
  isDemo?: boolean
  /** demo: whether to animate or be frozen */
  frozen?: boolean
}

export function BatchClock({
  secondsRemaining,
  windowSeconds,
  isDemo = false,
  frozen = false,
}: BatchClockProps) {
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const fraction = windowSeconds > 0 ? Math.max(0, Math.min(1, secondsRemaining / windowSeconds)) : 0
  const dashOffset = circumference * (1 - fraction)

  const minutes = Math.floor(secondsRemaining / 60)
  const seconds = secondsRemaining % 60
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  const isUrgent = secondsRemaining <= 10 && secondsRemaining > 0
  const isClosed = secondsRemaining === 0

  return (
    <div className={styles.clockWrap} aria-label={`Batch closes in ${timeStr}`}>
      <svg
        className={styles.svg}
        viewBox="0 0 120 120"
        role="img"
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx="60" cy="60" r={radius}
          fill="none"
          stroke="var(--rule)"
          strokeWidth="6"
        />
        {/* Progress arc */}
        <circle
          cx="60" cy="60" r={radius}
          fill="none"
          stroke={isClosed ? 'var(--alarm)' : 'var(--flow-dark)'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transformOrigin: '60px 60px',
            transform: 'rotate(-90deg)',
            transition: frozen ? 'none' : 'stroke-dashoffset 1s linear',
          }}
        />
        {/* Inner dot on the arc tip */}
        {!isClosed && (
          <circle
            cx={60 + radius * Math.cos(-Math.PI / 2 + 2 * Math.PI * (1 - fraction))}
            cy={60 + radius * Math.sin(-Math.PI / 2 + 2 * Math.PI * (1 - fraction))}
            r="4"
            fill={isClosed ? 'var(--alarm)' : 'var(--flow-dark)'}
          />
        )}
      </svg>

      <div className={`${styles.display} ${isUrgent ? 'timer-urgent' : ''}`}>
        {isClosed ? (
          <span className={styles.closedLabel}>Closed</span>
        ) : (
          <>
            <span className={styles.time}>{timeStr}</span>
            <span className={styles.label}>to close</span>
          </>
        )}
      </div>

      {isDemo && (
        <div className={styles.demoTag}>
          <span className="tag">demo</span>
        </div>
      )}
    </div>
  )
}
