import React from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import styles from './Header.module.css'

interface HeaderProps {
  mode: 'demo' | 'sepolia'
  onModeChange: (mode: 'demo' | 'sepolia') => void
}

export function Header({ mode, onModeChange }: HeaderProps) {
  return (
    <header className={styles.header} role="banner">
      <div className={styles.left}>
        <div className={styles.wordmark} aria-label="Otter">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect width="28" height="28" rx="4" fill="var(--ink)" />
            {/* Stylized wave representing a batch */}
            <path d="M5 14 Q8 10 11 14 Q14 18 17 14 Q20 10 23 14" stroke="var(--flow)" strokeWidth="2" fill="none" strokeLinecap="round"/>
            <circle cx="5" cy="14" r="1.5" fill="var(--flow)" />
            <circle cx="14" cy="18" r="1.5" fill="var(--flow)" />
            <circle cx="23" cy="14" r="1.5" fill="var(--flow)" />
          </svg>
          <span className={styles.name}>OTTER</span>
          <span className={styles.tagline}>Batch AMM · Sepolia live</span>
        </div>
      </div>

      <nav className={styles.nav} aria-label="Mode selector">
        <button
          id="mode-demo"
          className={`btn btn-sm ${mode === 'demo' ? styles.modeActive : styles.modeInactive}`}
          onClick={() => onModeChange('demo')}
          aria-pressed={mode === 'demo'}
        >
          Demo story
        </button>
        <button
          id="mode-sepolia"
          className={`btn btn-sm ${mode === 'sepolia' ? styles.modeActive : styles.modeInactive}`}
          onClick={() => onModeChange('sepolia')}
          aria-pressed={mode === 'sepolia'}
        >
          Sepolia sandbox
        </button>
      </nav>

      <div className={styles.right}>
        <ConnectButton
          chainStatus="icon"
          showBalance={false}
          accountStatus="address"
        />
      </div>
    </header>
  )
}
