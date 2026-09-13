import React from 'react'
import { GAS_CURVE, BLOCK_LIMIT, MAX_ORDERS_PER_BLOCK } from '@/data/gasCurve'
import styles from './GasChart.module.css'

export function GasChart() {
  const W = 480, H = 200, L = 44, B = 28, T = 10, R = 10
  const pts = GAS_CURVE

  const maxN = Math.max(...pts.map(p => p.orders)) * 1.08
  const maxG = Math.max(BLOCK_LIMIT * 1.1, ...pts.map(p => p.totalGas))

  const X = (n: number) => L + (n / maxN) * (W - L - R)
  const Y = (g: number) => H - B - (g / maxG) * (H - B - T)
  const px = (v: number) => v.toFixed(1)

  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${px(X(p.orders))},${px(Y(p.totalGas))}`).join(' ')
  const blockY = Y(BLOCK_LIMIT)
  const capX = X(MAX_ORDERS_PER_BLOCK)

  const gridGs = [0, 10e6, 20e6, 30e6]

  return (
    <div className={styles.wrap}>
      <h3 className={styles.title}>Gas per batch size</h3>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Settlement gas cost vs orders in the batch. Block limit is 30M gas. Maximum is 630 orders."
      >
        {/* Grid lines */}
        {gridGs.map(g => (
          <g key={g}>
            <line x1={L} y1={px(Y(g))} x2={W - R} y2={px(Y(g))} stroke="var(--rule-light)" />
            <text x={L - 6} y={px(Y(g) + 4)} fontSize="9" textAnchor="end" fill="var(--ink-dim)">
              {g === 0 ? '0' : `${(g / 1e6).toFixed(0)}M`}
            </text>
          </g>
        ))}

        {/* Block limit line */}
        <line
          x1={L} y1={px(blockY)} x2={W - R} y2={px(blockY)}
          stroke="var(--alarm)" strokeWidth="1" strokeDasharray="5 4"
        />
        <text x={W - R - 4} y={px(blockY - 5)} fontSize="9" textAnchor="end" fill="var(--alarm)">
          block limit
        </text>

        {/* Gas curve */}
        <path d={path} fill="none" stroke="var(--flow-dark)" strokeWidth="2" />

        {/* Dots */}
        {pts.map(p => (
          <circle
            key={p.orders}
            cx={px(X(p.orders))} cy={px(Y(p.totalGas))}
            r="3" fill="var(--flow-dark)"
          />
        ))}

        {/* Capacity marker */}
        <line
          x1={px(capX)} y1={T} x2={px(capX)} y2={H - B}
          stroke="var(--ink)" strokeWidth="1"
        />
        <text x={px(capX + 5)} y={T + 12} fontSize="9" fill="var(--ink)">
          {MAX_ORDERS_PER_BLOCK} orders
        </text>

        {/* Axes */}
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--rule)" />
        <text x={(L + W) / 2} y={H - 6} fontSize="9" textAnchor="middle" fill="var(--ink-dim)">
          orders in the batch
        </text>
      </svg>
    </div>
  )
}
