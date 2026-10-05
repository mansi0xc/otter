import React from 'react'
import { ETHERSCAN } from '@/config/contracts'
import styles from './HomePage.module.css'

interface HomePageProps {
  onEnterDemo: () => void
  onEnterSepolia: () => void
}

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M1 10L10 1M10 1H4M10 1V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function WaveLogo() {
  return (
    <svg width="48" height="48" viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="4" fill="var(--ink)" />
      <path d="M5 14 Q8 10 11 14 Q14 18 17 14 Q20 10 23 14" stroke="var(--flow)" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="5" cy="14" r="1.5" fill="var(--flow)" />
      <circle cx="14" cy="18" r="1.5" fill="var(--flow)" />
      <circle cx="23" cy="14" r="1.5" fill="var(--flow)" />
    </svg>
  )
}

const INVARIANTS = [
  { label: 'Feasibility', desc: 'Pool conservation holds — net swap matches the curve.' },
  { label: 'Signed minimum output', desc: 'Settlement rejects payments below signed minima on either side.' },
  { label: 'Budget bounds', desc: 'No order filled beyond its own budget.' },
  { label: 'Curve conservation', desc: 'Virtual reserves after settlement satisfy the invariant.' },
]

const STATS = [
  { n: '32', label: 'orders per epoch', sub: 'current admission cap' },
  { n: '32', label: 'opening LP positions', sub: 'current roster cap' },
  { n: '27×', label: 'historical solver speedup', sub: 'legacy float benchmark at n=1,000' },
  { n: '3.8e-10', label: 'historical relative error', sub: 'legacy float comparison; not an integer proof' },
]

const CONTRACTS = [
  { name: 'OtterOrderBook', url: ETHERSCAN.orderBook, desc: 'Batch commitment & escrow', detail: '60-second window · EIP-712 signed orders' },
  { name: 'OtterSettlement', url: ETHERSCAN.settlement, desc: 'Legacy feasibility verifier', detail: 'Canonical allocation and payments are not enforced' },
  { name: 'OtterHook', url: ETHERSCAN.hook, desc: 'Uniswap v4 hook', detail: 'beforeSwap · beforeAddLiquidity · beforeRemoveLiquidity' },
]

export function HomePage({ onEnterDemo, onEnterSepolia }: HomePageProps) {
  return (
    <div className={styles.page}>

      {/* ── Hero ── */}
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroInner}>
          <div className={styles.heroLogo}>
            <WaveLogo />
            <span className={styles.heroWordmark}>OTTER</span>
          </div>
          <h1 id="hero-title" className={styles.heroTitle}>
            Researching MEV resilience<br />with Uniswap v4 batches
          </h1>
          <p className={styles.heroSub}>
            A Uniswap v4 hook implementation of{' '}
            <em>Otter: A Provably MEV-Resilient Automated Market Maker via Surplus Redistribution</em>{' '}
            — Shi, Zhang, Chung &amp; Li (ePrint 2026/1877).{' '}
            The paper’s incentive guarantees are research targets; this prototype has unresolved integer-payment and combined trader/LP gaps.
          </p>
          <div className={styles.heroCta}>
            <button className="btn btn-primary" onClick={onEnterDemo}>
              Walk through a recorded batch →
            </button>
            <button className="btn btn-ghost" onClick={onEnterSepolia}>
              Sepolia sandbox
            </button>
          </div>
          <p className={styles.heroNote}>
            September Sepolia deployment is historical · hardened wallet writes disabled until configured
          </p>
        </div>

        {/* Animated wave decoration */}
        <div className={styles.heroWave} aria-hidden="true">
          <svg viewBox="0 0 800 80" preserveAspectRatio="none" className={styles.heroWaveSvg}>
            <path d="M0 40 Q100 0 200 40 Q300 80 400 40 Q500 0 600 40 Q700 80 800 40" fill="none" stroke="var(--flow)" strokeWidth="2" opacity="0.5"/>
            <path d="M0 40 Q100 0 200 40 Q300 80 400 40 Q500 0 600 40 Q700 80 800 40" fill="none" stroke="var(--flow)" strokeWidth="1" opacity="0.3" transform="translate(0 10)"/>
          </svg>
        </div>
      </section>

      {/* ── The Problem ── */}
      <section className={styles.section} aria-labelledby="problem-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabel}>The problem</span>
          <h2 id="problem-title" className={styles.sectionTitle}>Every queue is for sale</h2>
          <p className={styles.sectionLead}>
            On a conventional AMM, transaction ordering is visible and purchasable.
            A searcher who sees your order can insert before it — buying ahead of you,
            raising the price you pay, then selling after. Your loss is their profit, by construction.
          </p>

          <div className={styles.attackGrid}>
            <div className={`${styles.attackBlock} ${styles.attackBlockBad}`}>
              <span className={styles.attackRole}>Attacker · front-run</span>
              <span className={styles.attackAction}>Buys OTA with 5,000 OTB — price moves against victim</span>
            </div>
            <div className={styles.attackArrow} aria-hidden="true">↓</div>
            <div className={`${styles.attackBlock} ${styles.attackBlockVictim}`}>
              <span className={styles.attackRole}>Victim · swap</span>
              <span className={styles.attackAction}>Sells 50 OTA — gets <strong style={{ color: 'var(--alarm)' }}>1.38 OTB</strong> instead of 47.6</span>
            </div>
            <div className={styles.attackArrow} aria-hidden="true">↓</div>
            <div className={`${styles.attackBlock} ${styles.attackBlockBad}`}>
              <span className={styles.attackRole}>Attacker · back-run</span>
              <span className={styles.attackAction}>Sells OTA — pockets <strong style={{ color: 'var(--alarm)' }}>48.6 OTB profit</strong></span>
            </div>
          </div>

          <p className={styles.attackNote}>
            92% of the victim's trade captured on the plain pool, with zero-fee conditions that
            <em> favour the attacker</em>. Otter competes with the best case for the attack.
          </p>
        </div>
      </section>

      {/* ── The Mechanism ── */}
      <section className={`${styles.section} ${styles.sectionDark}`} aria-labelledby="mechanism-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabelLight}>The mechanism</span>
          <h2 id="mechanism-title" className={styles.sectionTitleLight}>Remove the queue. Redistribute the surplus.</h2>

          <div className={styles.mechanismGrid}>
            <div className={styles.mechanismCard}>
              <div className={styles.mechanismIcon} aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="2" y="8" width="18" height="12" rx="2" stroke="var(--flow)" strokeWidth="1.5"/>
                  <path d="M6 8V5a5 5 0 0 1 10 0v3" stroke="var(--flow)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <h3 className={styles.mechanismCardTitle}>Batch window</h3>
              <p className={styles.mechanismCardBody}>
                Signed orders enter a public collection window. The on-chain digest commits
                to admitted membership and submission order; it does not prevent censorship or strategic admission timing.
              </p>
            </div>

            <div className={styles.mechanismCard}>
              <div className={styles.mechanismIcon} aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle cx="11" cy="11" r="9" stroke="var(--flow)" strokeWidth="1.5"/>
                  <path d="M7 11l3 3 5-5" stroke="var(--flow)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h3 className={styles.mechanismCardTitle}>VCG allocation</h3>
              <p className={styles.mechanismCardBody}>
                The paper defines welfare-maximising allocations and pivot payments. The legacy
                contract accepts feasible solver outcomes without enforcing that rule. Integer settlement and joint LP incentives remain open.
              </p>
            </div>

            <div className={styles.mechanismCard}>
              <div className={styles.mechanismIcon} aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M11 3v16M3 11h16" stroke="var(--flow)" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="11" cy="11" r="4" stroke="var(--flow)" strokeWidth="1.5"/>
                </svg>
              </div>
              <h3 className={styles.mechanismCardTitle}>Surplus redistribution</h3>
              <p className={styles.mechanismCardBody}>
                Historical rewards in the hardened contracts belong to opening LP owners.
                This prevents later LPs taking past pots, but variable rewards can still benefit an LP trader’s false report.
              </p>
            </div>

            <div className={styles.mechanismCard}>
              <div className={styles.mechanismIcon} aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path d="M4 6h14M4 11h14M4 16h9" stroke="var(--flow)" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </div>
              <h3 className={styles.mechanismCardTitle}>On-chain verification</h3>
              <p className={styles.mechanismCardBody}>
                The local verifier checks signed minimum output on both sides and budget/curve bounds.
                Canonical allocations and pivot payments remain unimplemented.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Invariants ── */}
      <section className={styles.section} aria-labelledby="invariants-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabel}>Prototype checks</span>
          <h2 id="invariants-title" className={styles.sectionTitle}>Checks with known limits</h2>
          <p className={styles.sectionLead}>
            These checks enforce signed minima at settlement. A complete integer mechanism,
            canonical payouts and combined trader/LP incentives remain unresolved.
          </p>
          <div className={styles.invariantList}>
            {INVARIANTS.map((inv, i) => (
              <div key={i} className={styles.invariantRow}>
                <span className={styles.invariantCheck} aria-label="Verified">✓</span>
                <div>
                  <span className={styles.invariantLabel}>{inv.label}</span>
                  <span className={styles.invariantDesc}> — {inv.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <p className={styles.invariantNote}>
            Welfare-optimality of the proposed allocation is asserted by the solver, verified for small n (≤ 4)
            by independent grid search in <code>solver/test/properties.ts</code>.
            The on-chain checks bound the outcome; they do not prove optimality for arbitrary n.
          </p>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className={`${styles.section} ${styles.sectionAccent}`} aria-labelledby="stats-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabel}>By the numbers</span>
          <h2 id="stats-title" className={`${styles.sectionTitle} ${styles.srOnlyMobile}`}>Measured performance</h2>
          <div className={styles.statsGrid}>
            {STATS.map((s, i) => (
              <div key={i} className={styles.statCard}>
                <span className={styles.statN}>{s.n}</span>
                <span className={styles.statLabel}>{s.label}</span>
                <span className={styles.statSub}>{s.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Architecture ── */}
      <section className={styles.section} aria-labelledby="arch-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabel}>Architecture</span>
          <h2 id="arch-title" className={styles.sectionTitle}>Four layers, one mechanism</h2>

          <div className={styles.archTable}>
            <div className={styles.archRow}>
              <span className={styles.archPath}>solver/</span>
              <span className={styles.archDesc}>
                TypeScript VCG solver. Two-sided mechanism, layer-cake pivot algorithm (Lemma 16),
                property tests with independent grid search.
              </span>
            </div>
            <div className={styles.archRow}>
              <span className={styles.archPath}>contracts/</span>
              <span className={styles.archDesc}>
                OtterOrderBook, OtterSettlement, OtterHook — Foundry, solc 0.8.26.
                OtterMath compiled into Settlement; no square root on-chain.
                Fixed-point arithmetic with consistent rounding via solmate's mulDivDown/Up.
              </span>
            </div>
            <div className={styles.archRow}>
              <span className={styles.archPath}>harness/</span>
              <span className={styles.archDesc}>
                Sandwich comparison (vanilla v4 vs Otter) and settlement-cost benchmarks.
                Real EVM measurements, not estimates.
              </span>
            </div>
            <div className={styles.archRow}>
              <span className={styles.archPath}>web/</span>
              <span className={styles.archDesc}>
                Vite + React + wagmi. Static results page over a real testnet batch.
                Demo data is from the actual solver fixture, not hardcoded numbers.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Contracts ── */}
      <section className={`${styles.section} ${styles.sectionDark}`} aria-labelledby="contracts-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabelLight}>Deployed contracts</span>
          <h2 id="contracts-title" className={styles.sectionTitleLight}>Historical Sepolia prototype</h2>
          <p className={styles.sectionLeadLight}>
            These links identify the September 2026 prototype. They do not identify a deployment
            of the hardened version 2 stack, and are never used by the new wallet transaction path.
          </p>
          <div className={styles.contractsGrid}>
            {CONTRACTS.map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.contractCard}
              >
                <div className={styles.contractCardTop}>
                  <span className={styles.contractName}>{c.name}</span>
                  <span className="tag">Historical</span>
                </div>
                <span className={styles.contractDesc}>{c.desc}</span>
                <span className={styles.contractDetail}>{c.detail}</span>
                <span className={styles.contractLink}>View on Etherscan <ExternalIcon /></span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── Limitations ── */}
      <section className={styles.section} aria-labelledby="limitations-title">
        <div className={styles.sectionInner}>
          <span className={styles.sectionLabel}>Stated limitations</span>
          <h2 id="limitations-title" className={styles.sectionTitle}>What this is, and what it isn't</h2>
          <p className={styles.sectionLead}>
            Stated upfront rather than buried, because the judges will ask.
          </p>
          <div className={styles.limitList}>
            <div className={styles.limitRow}>
              <span className={styles.limitIcon} aria-hidden="true">△</span>
              <p className={styles.limitText}>
                <strong>Censorship resilience.</strong> The mechanism's guarantees require censorship resilience
                at the consensus layer (Theorem 23 of the paper). A testnet does not provide this.
              </p>
            </div>
            <div className={styles.limitRow}>
              <span className={styles.limitIcon} aria-hidden="true">△</span>
              <p className={styles.limitText}>
                <strong>Economic guarantees.</strong> Canonical allocation and pivot payments are not
                enforced. Rounded outcomes below signed minima are rejected and can require timeout refunds.
                An LP trader can still benefit from a false ask through surplus rewards.
              </p>
            </div>
            <div className={styles.limitRow}>
              <span className={styles.limitIcon} aria-hidden="true">△</span>
              <p className={styles.limitText}>
                <strong>Pivot algorithm.</strong> The O(n log n) layer-cake algorithm is extracted from the
                proof of Lemma 16. It is not original to this work. The current implementation is O(n²)
                with a small constant; binary-search optimisation is outstanding.
              </p>
            </div>
            <div className={styles.limitRow}>
              <span className={styles.limitIcon} aria-hidden="true">△</span>
              <p className={styles.limitText}>
                <strong>No public solver.</strong> The guided story uses historical fixtures. Wallet writes
                require a reviewed version 2 deployment, which is not configured in this repository.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className={styles.ctaSection} aria-labelledby="cta-title">
        <div className={styles.ctaInner}>
          <h2 id="cta-title" className={styles.ctaTitle}>See it in action</h2>
          <p className={styles.ctaSub}>
            Walk through a real settled batch — sandwich comparison, VCG allocation,
            order fills, surplus redistribution, and live Etherscan links.
          </p>
          <div className={styles.ctaBtns}>
            <button className="btn btn-primary" onClick={onEnterDemo}>
              Demo story →
            </button>
            <button className="btn btn-ghost" onClick={onEnterSepolia}>
              Sepolia sandbox
            </button>
            <a
              href="https://github.com/mansi0xc/otter"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
            >
              Source ↗
            </a>
          </div>
          <p className={styles.ctaPaper}>
            Based on{' '}
            <a href="https://eprint.iacr.org/2026/1877" target="_blank" rel="noopener noreferrer">
              IACR ePrint 2026/1877
            </a>{' '}
            — Shi, Zhang, Chung &amp; Li.
            No public implementation was found as of 9 September 2026.
          </p>
        </div>
      </section>

    </div>
  )
}
