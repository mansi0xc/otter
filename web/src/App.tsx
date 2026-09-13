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
          {mode === 'demo' ? (
            <DemoStory />
          ) : (
            <div className={styles.sandboxLayout}>
              <div className={styles.sandboxLeft}>
                <div className={styles.sandboxBanner}>
                  <span className="tag tag-live">Sepolia sandbox</span>
                  <p>
                    Connect a Sepolia wallet to submit a real order to the deployed
                    OtterOrderBook. The batch countdown is live from the contract.
                  </p>
                </div>
                <SepoliaStatus />
              </div>
              <div className={styles.sandboxRight}>
                <div className={styles.sandboxInfo}>
                  <h2 className={styles.sandboxInfoTitle}>How it works</h2>
                  <ol className={styles.sandboxSteps}>
                    <li>Connect a Sepolia wallet via the header.</li>
                    <li>Mint demo OTA or OTB tokens — no cost beyond gas.</li>
                    <li>Choose a side, budget, and minimum acceptable price.</li>
                    <li>Approve the token spend and sign the EIP-712 Order payload.</li>
                    <li>Your order is submitted to the live OtterOrderBook batch window.</li>
                  </ol>
                  <div className={styles.sandboxNote}>
                    <strong>Settlement note:</strong> No public solver is running.
                    Orders are collected in Sepolia batches but settlement is currently
                    demonstrated through the guided fixture in the Demo story.
                    Switch to <button className={styles.inlineLink} onClick={() => setMode('demo')}>Demo story</button> to
                    see what a real settled batch looks like.
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
          Otter — Implementation of Shi, Zhang, Chung &amp; Li,{' '}
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
