import React, { useState } from 'react'
import { Header } from '@/components/Header'
import { HomePage } from '@/components/HomePage'
import { DemoStory } from '@/components/DemoStory'
import { SepoliaStatus } from '@/components/SepoliaStatus'
import { GasChart } from '@/components/GasChart'
import styles from './App.module.css'

type AppMode = 'home' | 'demo' | 'sepolia'

export default function App() {
  const [mode, setMode] = useState<AppMode>('home')

  return (
    <>
      <Header mode={mode} onModeChange={setMode} />

      <main className={styles.main} role="main">
        <div className={styles.container}>

          {/* ── Mode content ── */}
          {mode === 'home' ? (
            <HomePage
              onEnterDemo={() => setMode('demo')}
              onEnterSepolia={() => setMode('sepolia')}
            />
          ) : mode === 'demo' ? (
            <DemoStory />
          ) : (
            <div className={styles.sandboxLayout}>
              <div className={styles.sandboxLeft}>
                <div className={styles.sandboxBanner}>
                  <span className="tag tag-live">Sepolia sandbox</span>
                  <p>
                    Inspect the hardened wallet flow. Signing and recovery require
                    a reviewed version 2 deployment; the historical September addresses are references.
                  </p>
                </div>
                <SepoliaStatus />
              </div>
              <div className={styles.sandboxRight}>
                <div className={styles.sandboxInfo}>
                  <h2 className={styles.sandboxInfoTitle}>How it works</h2>
                  <ol className={styles.sandboxSteps}>
                    <li>Connect a Sepolia wallet via the header.</li>
                    <li>Check the configured pool and asset addresses.</li>
                    <li>Choose a side, budget, and minimum acceptable price.</li>
                    <li>Approve the token spend and sign the EIP-712 Order payload.</li>
                    <li>Wait for confirmed admission and save its epoch and order index.</li>
                    <li>If execution times out, recover the stored order and withdraw your funded claim.</li>
                  </ol>
                  <div className={styles.sandboxNote}>
                    <strong>Settlement note:</strong> No public solver is running.
                    The current contracts do not enforce canonical payments or establish
                    the paper’s full incentive guarantees. The Demo story uses a historical fixture.
                    Switch to <button className={styles.inlineLink} onClick={() => setMode('demo')}>Demo story</button> to
                    inspect that recorded batch.
                  </div>
                  <GasChart />
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      <footer className={styles.footer} role="contentinfo">
        <span>
          Otter — Research prototype based on Shi, Zhang, Chung &amp; Li,{' '}
          <em>Otter: A Provably MEV-Resilient Automated Market Maker via Surplus Redistribution</em>{' '}
          (ePrint 2026/1877).{' '}
          <a href="https://github.com/mansi0xc/otter" target="_blank" rel="noopener noreferrer">
            Source ↗
          </a>
        </span>
      </footer>
    </>
  )
}
