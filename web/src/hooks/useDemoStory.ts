import { useState, useCallback } from 'react'

export type StoryStep =
  | 'QUEUE_ATTACK'
  | 'ORDERS_ARRIVE'
  | 'BATCH_CLOSES'
  | 'SOLVER_VERIFIES'
  | 'SETTLEMENT_AUDITABLE'

export interface StoryState {
  step: StoryStep
  stepIndex: number
  isFirst: boolean
  isLast: boolean
  next: () => void
  prev: () => void
  restart: () => void
  goTo: (step: StoryStep) => void
}

const STEPS: StoryStep[] = [
  'QUEUE_ATTACK',
  'ORDERS_ARRIVE',
  'BATCH_CLOSES',
  'SOLVER_VERIFIES',
  'SETTLEMENT_AUDITABLE',
]

export const STORY_COPY: Record<StoryStep, { title: string; body: string }> = {
  QUEUE_ATTACK: {
    title: 'A queue is sellable',
    body: `On a conventional AMM, a searcher can front-run any visible order. They buy before you, driving up the price \u2014 then sell after you fill at the worse price. The victim's loss is the searcher's profit. Here, the attacker deploys 5,000 OTB and captures 92% of the victim's trade.`,
  },
  ORDERS_ARRIVE: {
    title: 'Otter removes the sequence',
    body: 'Orders enter the batch window as an unordered set. There is no first, no second — no sequence position to purchase. A searcher who joins the batch clears at the same price everyone else does. The queue-sellability assumption is gone.',
  },
  BATCH_CLOSES: {
    title: 'The batch closes',
    body: 'After 60 seconds the window shuts. The ledger is sealed: no new orders enter, existing orders cannot be removed. The commitment digest is now fixed on-chain.',
  },
  SOLVER_VERIFIES: {
    title: 'Solver proposes; contract verifies',
    body: 'The solver computes the VCG allocation off-chain and submits it. The contract checks feasibility, individual rationality, budget bounds, and curve conservation. The solver proposes. The contract refuses bad outcomes.',
  },
  SETTLEMENT_AUDITABLE: {
    title: 'Settlement is auditable',
    body: 'The filled amounts, refunds, and LP surplus are emitted as on-chain events. Every guarantee is reproducible from the deployed, source-verified contracts. Orders are submitted on Sepolia; settlement is currently demonstrated through the guided fixture.',
  },
}

export function useDemoStory(): StoryState {
  const [stepIndex, setStepIndex] = useState(0)

  const step = STEPS[stepIndex]
  const isFirst = stepIndex === 0
  const isLast = stepIndex === STEPS.length - 1

  const next = useCallback(() => {
    setStepIndex(i => Math.min(i + 1, STEPS.length - 1))
  }, [])

  const prev = useCallback(() => {
    setStepIndex(i => Math.max(i - 1, 0))
  }, [])

  const restart = useCallback(() => {
    setStepIndex(0)
  }, [])

  const goTo = useCallback((s: StoryStep) => {
    const idx = STEPS.indexOf(s)
    if (idx >= 0) setStepIndex(idx)
  }, [])

  return { step, stepIndex, isFirst, isLast, next, prev, restart, goTo }
}
