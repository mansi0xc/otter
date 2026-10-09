/** Bound finite ask-response diagnostics for one trader with one order and no
 * opening LP position. Necessary integer truthfulness conditions, not a rule,
 * complete type-space proof, beneficial-owner model or settlement verifier. */
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hash } from 'viem'
import { researchBoundOneSidedBatch } from './boundResearch.ts'
import type { CoverageAnchor } from './batchCoverage.ts'
import type { OpeningRecord } from './openingExecution.ts'
import type { CapturedExecutionCurves } from './executionSnapshot.ts'
import { ORDER_COMPONENTS, storedBatchCommitment } from './epochBatch.ts'
import { orderHash, type Order } from './orders.ts'
import { analyzeTransfers, verifyTransferPayments, verifyTransferCycle, MAX_TRANSFER_REPORTS, type TransferAnalysis, type TransferPoint } from '../../../solver/src/transfer-research.ts'
import { MAX_OUTPUT } from '../../../solver/src/execution.ts'

export interface ReportProfile { anchor: CoverageAnchor; record: OpeningRecord; frame: CapturedExecutionCurves; orders: readonly Order[] }
export const MENU_TYPEHASH = keccak256(stringToHex('OtterBoundAskResponse/v1'))
export const MENU_EDGE_COMPONENTS = [{ name: 'from', type: 'uint8' }, { name: 'to', type: 'uint8' },
  { name: 'limit', type: 'int256' }, { name: 'kind', type: 'uint8' }] as const
export const MENU_ANALYSIS_COMPONENTS = [
  { name: 'kind', type: 'uint8' }, { name: 'payments', type: 'uint256[]' },
  { name: 'cycle', type: 'tuple[]', components: MENU_EDGE_COMPONENTS },
  { name: 'cycleWeight', type: 'int256' }, { name: 'relaxations', type: 'uint256' },
] as const
export const MENU_REPORT_COMPONENTS = [
  { name: 'ask', type: 'uint256' }, { name: 'input', type: 'uint256' }, { name: 'minimumPayment', type: 'uint256' },
  { name: 'otherMinimumPayment', type: 'uint256' }, { name: 'output', type: 'uint256' },
  { name: 'availablePayment', type: 'uint256' }, { name: 'otherMinimumDeficit', type: 'uint256' },
  { name: 'researchHash', type: 'bytes32' }, { name: 'ordersHash', type: 'bytes32' }, { name: 'targetOrderHash', type: 'bytes32' },
  { name: 'ceilPivotPayment', type: 'uint256' }, { name: 'pivotCeilDeficit', type: 'uint256' },
] as const
export const MENU_RESULT_COMPONENTS = [
  { name: 'contextHash', type: 'bytes32' }, { name: 'fixedReportsHash', type: 'bytes32' }, { name: 'targetIndex', type: 'uint8' },
  { name: 'trader', type: 'address' }, { name: 'trueBudget', type: 'uint256' }, { name: 'down', type: 'bool' },
  { name: 'soldCurrency', type: 'address' }, { name: 'paymentCurrency', type: 'address' },
  { name: 'reports', type: 'tuple[]', components: MENU_REPORT_COMPONENTS },
  { name: 'loose', type: 'tuple', components: MENU_ANALYSIS_COMPONENTS },
  { name: 'funded', type: 'tuple', components: MENU_ANALYSIS_COMPONENTS },
] as const
export interface MenuAnalysis {
  /** 0 = not analyzed because other minima exceed output; 1 = feasible necessary
   * constraints; 2 = infeasible with a checked closed negative cycle. */
  kind: 0 | 1 | 2; payments: readonly bigint[];
  cycle: readonly Readonly<{ from: number; to: number; limit: bigint; kind: number }>[];
  cycleWeight: bigint; relaxations: bigint
}
export interface MenuReport {
  ask: bigint; input: bigint; minimumPayment: bigint; otherMinimumPayment: bigint; output: bigint;
  availablePayment: bigint; otherMinimumDeficit: bigint; researchHash: Hash; ordersHash: Hash; targetOrderHash: Hash;
  ceilPivotPayment: bigint; pivotCeilDeficit: bigint
}
export interface ReportMenu {
  scope: 'bound-finite-single-trader-ask-responses'; menuHash: Hash; contextHash: Hash; fixedReportsHash: Hash;
  targetIndex: number; trader: Address; trueBudget: bigint; down: boolean; soldCurrency: Address; paymentCurrency: Address;
  reports: readonly Readonly<MenuReport>[]; loose: Readonly<MenuAnalysis>; funded: Readonly<MenuAnalysis>
}
const empty = Object.freeze([])
function normalized(points: readonly TransferPoint[], result: TransferAnalysis): Readonly<MenuAnalysis> {
  if (result.feasible) {
    if (!verifyTransferPayments(points, result.payments)) throw new Error('Bound ask-response payment certificate failed.')
    return Object.freeze({ kind: 1, payments: Object.freeze([...result.payments]), cycle: empty, cycleWeight: 0n, relaxations: BigInt(result.relaxations) })
  }
  if (!verifyTransferCycle(points, result.negativeCycle)) throw new Error('Bound ask-response cycle certificate failed.')
  return Object.freeze({ kind: 2, payments: empty, cycle: Object.freeze(result.negativeCycle.map(e => Object.freeze({
    from: e.from, to: e.to, limit: e.limit, kind: e.kind === 'truthfulness' ? 0 : e.kind === 'lower' ? 1 : 2 }))),
    cycleWeight: result.cycleWeight, relaxations: BigInt(result.relaxations) })
}

export function inspectBoundAskResponses(profiles: readonly ReportProfile[], targetIndex: number): Readonly<ReportMenu> {
  if (!Array.isArray(profiles) || profiles.length < 1 || profiles.length > MAX_TRANSFER_REPORTS
    || !Number.isSafeInteger(targetIndex) || targetIndex < 0 || targetIndex > 7) throw new Error('Bound ask-response research requires 1..16 profiles and an original target index 0..7.')
  const seen = new Set<bigint>()
  const rows = profiles.map((p: ReportProfile) => {
    const research = researchBoundOneSidedBatch(p.anchor, p.record, p.frame, p.orders)
    const batch = storedBatchCommitment({ ...p.anchor, executeUntil: p.record.executeUntil }, p.orders), target = batch.orders[targetIndex]
    if (!target) throw new Error('Bound ask-response target index is absent from an original batch.')
    if (batch.orders.filter(o => o.trader === target.trader).length !== 1)
      throw new Error('Bound ask-response target must control exactly one original record.')
    if (p.record.positions.some(position => position.owner.toLowerCase() === target.trader.toLowerCase()))
      throw new Error('Bound ask-response target cannot own an opening LP position under this single-role model.')
    if (seen.has(target.ask)) throw new Error('Bound ask-response reported asks must be distinct.')
    seen.add(target.ask)
    const contextHash = keccak256(encodeAbiParameters([
      { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' },
    ], [p.anchor.snapshotHash, p.anchor.curvesHash, p.anchor.blockNumber, p.anchor.blockHash, p.frame.source.runtimeHash, batch.domainSeparator]))
    // Mask only the selected ask for comparison, preserving all other fields,
    // sequence, true budget and identity. This is a content key, not admission.
    const fixedReportsHash = keccak256(encodeAbiParameters([{ type: 'tuple[]', components: ORDER_COMPONENTS }],
      [batch.orders.map((o, i) => i === targetIndex ? { ...o, ask: 0n } : o)]))
    const otherMinimumPayment = research.records.reduce((sum, t, i) => sum + (i === targetIndex ? 0n : t.minimumPayment), 0n)
    const output = research.cases[0].output, t = research.records[targetIndex]
    const otherMinimumDeficit = otherMinimumPayment > output ? otherMinimumPayment - output : 0n
    const report = Object.freeze({ ask: target.ask, input: t.spent, minimumPayment: t.minimumPayment, otherMinimumPayment, output,
      availablePayment: otherMinimumDeficit === 0n ? output - otherMinimumPayment : 0n,
      otherMinimumDeficit, researchHash: research.researchHash, ordersHash: research.cases[0].ordersHash,
      targetOrderHash: orderHash(target), ceilPivotPayment: t.ceilPayment, pivotCeilDeficit: research.recordCeilDeficit })
    return { contextHash, fixedReportsHash, target, research, report }
  })
  const first = rows[0]
  if (rows.some(r => r.contextHash !== first.contextHash || r.fixedReportsHash !== first.fixedReportsHash))
    throw new Error('Bound ask-response profiles must keep the same opening context and every original field except the selected ask.')
  const reports = Object.freeze(rows.map(r => r.report))
  const loosePoints = reports.map(r => ({ ask: r.ask, input: r.input, lowerPayment: 0n, upperPayment: MAX_OUTPUT }))
  const loose = normalized(loosePoints, analyzeTransfers(loosePoints))
  // Do not clamp a negative available budget into a falsely funded constraint.
  // Zero is only an unavailable-row sentinel; skip the funded analysis entirely.
  const funded: Readonly<MenuAnalysis> = reports.some(r => r.otherMinimumDeficit > 0n)
    ? Object.freeze({ kind: 0, payments: empty, cycle: empty, cycleWeight: 0n, relaxations: 0n })
    : (() => { const points = reports.map(r => ({ ask: r.ask, input: r.input, lowerPayment: r.minimumPayment, upperPayment: r.availablePayment }))
      return normalized(points, analyzeTransfers(points)) })()
  const result = { contextHash: first.contextHash, fixedReportsHash: first.fixedReportsHash, targetIndex,
    trader: first.target.trader, trueBudget: first.target.budget, down: first.research.down,
    soldCurrency: first.research.soldCurrency, paymentCurrency: first.research.paymentCurrency, reports, loose, funded }
  const menuHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'tuple', components: MENU_RESULT_COMPONENTS }], [MENU_TYPEHASH, result]))
  return Object.freeze({ scope: 'bound-finite-single-trader-ask-responses', menuHash, ...result })
}
