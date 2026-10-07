/** Complete small-domain signed-minimum diagnostics, never a payment policy.
 * For every quantity, independently check the least total whole-unit output
 * needed by original per-record minima. This is not welfare maximization on a
 * new feasible set, a grouped delivery rule or an incentive guarantee. */
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hash } from 'viem'
import { researchBoundOneSidedBatch } from './boundResearch.ts'
import type { CoverageAnchor } from './batchCoverage.ts'
import type { OpeningRecord } from './openingExecution.ts'
import type { CapturedExecutionCurves } from './executionSnapshot.ts'
import { orderHash, type Order } from './orders.ts'
import { WAD } from '../../../solver/src/discrete-research.ts'

export const MINIMUM_TYPEHASH = keccak256(stringToHex('OtterSignedMinimumFrontier/v1'))
export const MINIMUM_POINT_COMPONENTS = [
  { name: 'totalInput', type: 'uint256' }, { name: 'output', type: 'uint256' }, { name: 'fill', type: 'uint256[]' },
  { name: 'minimumPayment', type: 'uint256' }, { name: 'aggregateMinimumPayment', type: 'uint256' },
  { name: 'costNumerator', type: 'uint256' }, { name: 'welfareNumerator', type: 'int256' },
  { name: 'deficit', type: 'uint256' }, { name: 'feasible', type: 'bool' },
] as const
export const MINIMUM_CASE_COMPONENTS = [
  { name: 'kind', type: 'uint8' }, { name: 'trader', type: 'address' }, { name: 'omittedIndices', type: 'uint8[]' },
  { name: 'indices', type: 'uint8[]' }, { name: 'ordersHash', type: 'bytes32' },
  { name: 'points', type: 'tuple[]', components: MINIMUM_POINT_COMPONENTS },
  { name: 'vectorCount', type: 'uint256' }, { name: 'dpTransitions', type: 'uint256' },
  { name: 'researchInput', type: 'uint256' }, { name: 'researchMinimumPayment', type: 'uint256' },
  { name: 'researchMinimumDeficit', type: 'uint256' }, { name: 'sameInputMinimumPayment', type: 'uint256' },
  { name: 'sameInputFeasible', type: 'bool' }, { name: 'positiveOutputAllocationExists', type: 'bool' },
] as const
export const MINIMUM_RESULT_COMPONENTS = [{ name: 'cases', type: 'tuple[]', components: MINIMUM_CASE_COMPONENTS }] as const
export interface MinimumPoint {
  totalInput: bigint; output: bigint; fill: readonly bigint[]; minimumPayment: bigint; aggregateMinimumPayment: bigint;
  costNumerator: bigint; welfareNumerator: bigint; deficit: bigint; feasible: boolean
}
export interface MinimumCase {
  kind: 0 | 1 | 2; trader: Address; omittedIndices: readonly number[]; indices: readonly number[]; ordersHash: Hash;
  points: readonly Readonly<MinimumPoint>[]; vectorCount: bigint; dpTransitions: bigint;
  researchInput: bigint; researchMinimumPayment: bigint; researchMinimumDeficit: bigint;
  sameInputMinimumPayment: bigint; sameInputFeasible: boolean; positiveOutputAllocationExists: boolean
}
export interface MinimumFeasibility {
  scope: 'one-sided-signed-minimum-frontier'; coverageHash: Hash; researchHash: Hash; minimumHash: Hash;
  down: boolean; soldCurrency: Address; paymentCurrency: Address; originalInput: bigint;
  cases: readonly Readonly<MinimumCase>[]
}
interface Choice { fill: bigint[]; minimum: bigint; cost: bigint }
const ceil = (x: bigint) => (x + WAD - 1n) / WAD
const deficit = (minimum: bigint, output: bigint) => minimum > output ? minimum - output : 0n
function better(a: Choice, b: Choice | undefined, rank: readonly number[]) {
  if (!b || a.minimum !== b.minimum) return !b || a.minimum < b.minimum
  if (a.cost !== b.cost) return a.cost < b.cost
  for (const i of rank) if (a.fill[i] !== b.fill[i]) return a.fill[i] > b.fill[i]
  return false
}

export function inspectSignedMinimumFeasibility(anchor: CoverageAnchor, record: OpeningRecord,
  frame: CapturedExecutionCurves, orders: readonly Order[]): Readonly<MinimumFeasibility> {
  // Recompute the bound research, never accept a saved calculation/hash as proof.
  const research = researchBoundOneSidedBatch(anchor, record, frame, orders)
  const output = frame.curves.find(c => c.domain.down === research.down)!.points
  const cases = research.cases.map(c => {
    const retained = c.indices.map(i => orders[i]), n = retained.length
    const ids = retained.map(orderHash), rank = retained.map((_, i) => i).sort((a, b) =>
      retained[a].ask < retained[b].ask ? -1 : retained[a].ask > retained[b].ask ? 1 : ids[a] < ids[b] ? -1 : 1)
    // The guard established each budget and sum as an integer <=64. Monetary
    // arithmetic stays BigInt; Number is used only for these bounded loop indices.
    const budgets = retained.map(o => Number(o.budget)), total = budgets.reduce((a, b) => a + b, 0)
    let dp: (Choice | undefined)[] = [{ fill: Array<bigint>(n).fill(0n), minimum: 0n, cost: 0n }]
    let transitions = 0n
    for (let i = 0; i < n; ++i) {
      const next: (Choice | undefined)[] = Array(dp.length + budgets[i])
      for (let q = 0; q < dp.length; ++q) if (dp[q]) for (let take = 0; take <= budgets[i]; ++take) {
        ++transitions
        const prior = dp[q]!, fill = [...prior.fill], cost = retained[i].ask * BigInt(take)
        fill[i] = BigInt(take)
        const candidate = { fill, minimum: prior.minimum + ceil(cost), cost: prior.cost + cost }
        if (better(candidate, next[q + take], rank)) next[q + take] = candidate
      }
      dp = next
    }
    // Independent Cartesian enumeration retains all original budget vectors;
    // it neither uses DP states nor cheapest linear-cost prefixes.
    const cartesian: (Choice | undefined)[] = Array(total + 1), fill = Array<bigint>(n).fill(0n)
    let vectors = 0n
    const visit = (i: number, q: number, minimum: bigint, cost: bigint) => {
      if (i < n) {
        for (let take = 0; take <= budgets[i]; ++take) {
          fill[i] = BigInt(take); const term = retained[i].ask * fill[i]
          visit(i + 1, q + take, minimum + ceil(term), cost + term)
        }
      } else {
        ++vectors; const candidate = { fill: [...fill], minimum, cost }
        if (better(candidate, cartesian[q], rank)) cartesian[q] = candidate
      }
    }
    visit(0, 0, 0n, 0n)
    const points = dp.map((best, q) => {
      const independent = cartesian[q]
      if (!best || !independent || best.minimum !== independent.minimum || best.cost !== independent.cost
        || best.fill.some((f, i) => f !== independent.fill[i])) throw new Error('Independent signed-minimum frontiers disagree.')
      const out = output[q].output, shortfall = deficit(best.minimum, out)
      return Object.freeze({ totalInput: BigInt(q), output: out, fill: Object.freeze([...best.fill]), minimumPayment: best.minimum,
        aggregateMinimumPayment: ceil(best.cost), costNumerator: best.cost, welfareNumerator: out * WAD - best.cost,
        deficit: shortfall, feasible: shortfall === 0n })
    })
    if (vectors !== retained.reduce((p, o) => p * (o.budget + 1n), 1n) || points.length !== total + 1)
      throw new Error('Signed-minimum frontier did not cover the complete retained domain.')
    const researchMinimumPayment = retained.reduce((p, o, i) => p + ceil(o.ask * c.fill[i]), 0n)
    const sameInput = points[Number(c.totalInput)]
    return Object.freeze({ kind: c.kind, trader: c.trader, omittedIndices: Object.freeze([...c.omittedIndices]),
      indices: Object.freeze([...c.indices]), ordersHash: c.ordersHash, points: Object.freeze(points), vectorCount: vectors, dpTransitions: transitions,
      researchInput: c.totalInput, researchMinimumPayment, researchMinimumDeficit: deficit(researchMinimumPayment, c.output),
      sameInputMinimumPayment: sameInput.minimumPayment, sameInputFeasible: sameInput.feasible,
      positiveOutputAllocationExists: points.some(p => p.totalInput > 0n && p.output > 0n && p.feasible) })
  })
  const result = { cases: Object.freeze(cases) }
  const minimumHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' },
    { type: 'tuple', components: MINIMUM_RESULT_COMPONENTS }], [MINIMUM_TYPEHASH, research.researchHash, result]))
  return Object.freeze({ scope: 'one-sided-signed-minimum-frontier', coverageHash: research.coverageHash,
    researchHash: research.researchHash, minimumHash, down: research.down, soldCurrency: research.soldCurrency,
    paymentCurrency: research.paymentCurrency, originalInput: research.originalInput, ...result })
}
