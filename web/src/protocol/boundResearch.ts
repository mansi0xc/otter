/** Bound one-sided raw-unit welfare/pivot diagnostics, never settlement.
 * Preserves original reports. Every retained case is checked by independent
 * scan/Cartesian optimizers. Record and address pivots are distinct hypotheses,
 * not a selected participant, payment, delivery or guarantee-preserving rule. */
import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hash } from 'viem'
import { requireWholeInputOpeningPrefixes, type CoverageAnchor } from './batchCoverage.ts'
import { storedBatchCommitment } from './epochBatch.ts'
import type { OpeningRecord } from './openingExecution.ts'
import type { CapturedExecutionCurves } from './executionSnapshot.ts'
import { orderHash, type Order } from './orders.ts'
import { address } from './deployment.ts'
import { optimize, exhaustive, pivots, WAD, MAX_BIDS, MAX_VECTORS, type Domain, type Bid } from '../../../solver/src/discrete-research.ts'

export const RESEARCH_TYPEHASH = keccak256(stringToHex('OtterBoundOneSidedResearch/v1'))
export const RESEARCH_CASE_COMPONENTS = [
  { name: 'kind', type: 'uint8' }, { name: 'trader', type: 'address' }, { name: 'omittedIndices', type: 'uint8[]' },
  { name: 'indices', type: 'uint8[]' }, { name: 'ordersHash', type: 'bytes32' }, { name: 'fill', type: 'uint256[]' },
  { name: 'totalInput', type: 'uint256' }, { name: 'output', type: 'uint256' },
  { name: 'welfareNumerator', type: 'uint256' }, { name: 'costNumerator', type: 'uint256' },
  { name: 'scanEvaluated', type: 'uint256' }, { name: 'exhaustiveEvaluated', type: 'uint256' },
] as const
export const RECORD_TRANSFER_COMPONENTS = [
  { name: 'index', type: 'uint8' }, { name: 'id', type: 'bytes32' }, { name: 'trader', type: 'address' },
  { name: 'spent', type: 'uint256' }, { name: 'unspent', type: 'uint256' }, { name: 'withoutWelfareNumerator', type: 'uint256' },
  { name: 'paymentNumerator', type: 'uint256' }, { name: 'floorPayment', type: 'uint256' }, { name: 'ceilPayment', type: 'uint256' },
  { name: 'minimumPayment', type: 'uint256' }, { name: 'floorIR', type: 'bool' },
] as const
export const ADDRESS_TRANSFER_COMPONENTS = [
  { name: 'trader', type: 'address' }, { name: 'indices', type: 'uint8[]' },
  { name: 'spent', type: 'uint256' }, { name: 'unspent', type: 'uint256' }, { name: 'costNumerator', type: 'uint256' },
  { name: 'withoutWelfareNumerator', type: 'uint256' }, { name: 'paymentNumerator', type: 'uint256' },
  { name: 'floorPayment', type: 'uint256' }, { name: 'ceilPayment', type: 'uint256' },
  { name: 'aggregateMinimumPayment', type: 'uint256' }, { name: 'sumRecordMinimumPayment', type: 'uint256' },
  { name: 'recordPaymentNumerator', type: 'uint256' }, { name: 'recordCeilPayment', type: 'uint256' },
  { name: 'recordVsGroupPaymentNumerator', type: 'int256' }, { name: 'groupedCeilMeetsRecordMinimums', type: 'bool' },
] as const
export const RESEARCH_RESULT_COMPONENTS = [
  { name: 'down', type: 'bool' }, { name: 'soldCurrency', type: 'address' }, { name: 'paymentCurrency', type: 'address' },
  { name: 'originalInput', type: 'uint256' }, { name: 'vectorBound', type: 'uint256' },
  { name: 'cases', type: 'tuple[]', components: RESEARCH_CASE_COMPONENTS },
  { name: 'records', type: 'tuple[]', components: RECORD_TRANSFER_COMPONENTS },
  { name: 'addresses', type: 'tuple[]', components: ADDRESS_TRANSFER_COMPONENTS },
  { name: 'recordRawDeficitNumerator', type: 'int256' }, { name: 'recordCeilResidual', type: 'int256' }, { name: 'recordCeilDeficit', type: 'uint256' },
  { name: 'addressRawDeficitNumerator', type: 'int256' }, { name: 'addressCeilResidual', type: 'int256' }, { name: 'addressCeilDeficit', type: 'uint256' },
] as const
export interface ResearchCase {
  kind: 0 | 1 | 2; trader: Address; omittedIndices: readonly number[]; indices: readonly number[]; ordersHash: Hash;
  fill: readonly bigint[]; totalInput: bigint; output: bigint; welfareNumerator: bigint; costNumerator: bigint;
  scanEvaluated: bigint; exhaustiveEvaluated: bigint
}
export interface RecordTransfer {
  index: number; id: Hash; trader: Address; spent: bigint; unspent: bigint; withoutWelfareNumerator: bigint;
  paymentNumerator: bigint; floorPayment: bigint; ceilPayment: bigint; minimumPayment: bigint; floorIR: boolean
}
export interface AddressTransfer {
  trader: Address; indices: readonly number[]; spent: bigint; unspent: bigint; costNumerator: bigint;
  withoutWelfareNumerator: bigint; paymentNumerator: bigint; floorPayment: bigint; ceilPayment: bigint;
  aggregateMinimumPayment: bigint; sumRecordMinimumPayment: bigint; recordPaymentNumerator: bigint; recordCeilPayment: bigint;
  recordVsGroupPaymentNumerator: bigint; groupedCeilMeetsRecordMinimums: boolean
}
export interface BoundResearch {
  scope: 'one-sided-linear-raw-unit-pivots'; coverageHash: Hash; researchHash: Hash;
  down: boolean; soldCurrency: Address; paymentCurrency: Address; originalInput: bigint; vectorBound: bigint;
  cases: readonly Readonly<ResearchCase>[]; records: readonly Readonly<RecordTransfer>[]; addresses: readonly Readonly<AddressTransfer>[];
  recordRawDeficitNumerator: bigint; recordCeilResidual: bigint; recordCeilDeficit: bigint;
  addressRawDeficitNumerator: bigint; addressCeilResidual: bigint; addressCeilDeficit: bigint
}
const ceil = (n: bigint) => (n + WAD - 1n) / WAD
const sum = (values: readonly bigint[]) => values.reduce((a, b) => a + b, 0n)

export function researchBoundOneSidedBatch(anchor: CoverageAnchor, record: OpeningRecord,
  frame: CapturedExecutionCurves, orders: readonly Order[]): Readonly<BoundResearch> {
  const coverage = requireWholeInputOpeningPrefixes(anchor, record, frame, orders)
  const batch = storedBatchCommitment({ ...anchor, executeUntil: record.executeUntil }, orders)
  if (batch.orders.length > MAX_BIDS) throw new Error('Bound one-sided research requires 1..8 original orders.')
  const down = batch.orders[0].sellingCurrency0
  if (batch.orders.some(o => o.sellingCurrency0 !== down)) throw new Error('Bound one-sided research cannot omit opposing orders or select a direction for a mixed batch.')
  let vectorBound = 1n
  for (const o of batch.orders) vectorBound *= o.budget + 1n
  if (vectorBound > BigInt(MAX_VECTORS)) throw new Error('Bound one-sided research exceeds the exhaustive vector work limit.')
  const originalInput = down ? batch.budget0 : batch.budget1
  // The coverage guard established the complete ORIGINAL raw input domain.
  // Counterfactuals use this same fixed table and unchanged retained budgets.
  const curve = frame.curves.find(c => c.domain.down === down)!
  const domain: Domain = { lotSize: 1n, output: curve.points.slice(0, Number(originalInput) + 1).map(q => q.output) }
  const bids: Bid[] = batch.orders.map(o => ({ id: orderHash(o), ask: o.ask, budget: o.budget }))
  const cases: Readonly<ResearchCase>[] = coverage.cases.map(c => {
    const indices = bids.map((_, i) => i).filter(i => !c.omittedIndices.includes(i)), retained = indices.map(i => bids[i])
    const scan = optimize(domain, retained), cartesian = exhaustive(domain, retained)
    if (['totalInput', 'output', 'welfareNumerator', 'costNumerator'].some(f => scan[f as keyof typeof scan] !== cartesian[f as keyof typeof cartesian])
      || scan.fill.length !== cartesian.fill.length || scan.fill.some((n, i) => n !== cartesian.fill[i])) throw new Error('Independent bound research optimizers disagree.')
    return Object.freeze({ kind: c.kind, trader: c.trader, omittedIndices: Object.freeze([...c.omittedIndices]), indices: Object.freeze(indices),
      ordersHash: c.ordersHash, fill: Object.freeze([...scan.fill]), totalInput: scan.totalInput, output: scan.output,
      welfareNumerator: scan.welfareNumerator, costNumerator: scan.costNumerator,
      scanEvaluated: BigInt(scan.evaluated), exhaustiveEvaluated: BigInt(cartesian.evaluated) })
  })
  const base = cases[0], candidate = pivots(domain, bids)
  if (candidate.welfareNumerator !== base.welfareNumerator || candidate.totalInput !== base.totalInput
    || candidate.output !== base.output || candidate.fill.some((n, i) => n !== base.fill[i])) throw new Error('Bound pivot allocation disagrees with checked original case.')
  const records = batch.orders.map((o, i) => {
    const withoutWelfareNumerator = cases[i + 1].welfareNumerator
    const paymentNumerator = o.ask * base.fill[i] + base.welfareNumerator - withoutWelfareNumerator
    if (withoutWelfareNumerator !== candidate.withoutWelfareNumerator[i] || paymentNumerator !== candidate.paymentNumerator[i]) throw new Error('Bound record pivot disagrees with checked removal case.')
    return Object.freeze({ index: i, id: bids[i].id as Hash, trader: o.trader, spent: base.fill[i], unspent: candidate.unspent[i],
      withoutWelfareNumerator, paymentNumerator, floorPayment: candidate.floorPayment[i], ceilPayment: candidate.ceilPayment[i],
      minimumPayment: candidate.minimumPayment[i], floorIR: candidate.floorPayment[i] >= candidate.minimumPayment[i] })
  })
  const addresses = cases.filter(c => c.kind === 2).map(c => {
    const indices = [...c.omittedIndices], spent = sum(indices.map(i => base.fill[i])), unspent = sum(indices.map(i => records[i].unspent))
    const costNumerator = sum(indices.map(i => batch.orders[i].ask * base.fill[i]))
    const paymentNumerator = costNumerator + base.welfareNumerator - c.welfareNumerator
    if (paymentNumerator < 0n || (spent === 0n && paymentNumerator !== 0n)) throw new Error('Bound address pivot invariant failed.')
    const sumRecordMinimumPayment = sum(indices.map(i => records[i].minimumPayment)), recordPaymentNumerator = sum(indices.map(i => records[i].paymentNumerator))
    const ceilPayment = ceil(paymentNumerator)
    return Object.freeze({ trader: c.trader, indices: Object.freeze(indices), spent, unspent, costNumerator,
      withoutWelfareNumerator: c.welfareNumerator, paymentNumerator, floorPayment: paymentNumerator / WAD, ceilPayment,
      aggregateMinimumPayment: ceil(costNumerator), sumRecordMinimumPayment, recordPaymentNumerator,
      recordCeilPayment: sum(indices.map(i => records[i].ceilPayment)), recordVsGroupPaymentNumerator: recordPaymentNumerator - paymentNumerator,
      groupedCeilMeetsRecordMinimums: ceilPayment >= sumRecordMinimumPayment })
  })
  const addressRawDeficitNumerator = sum(addresses.map(a => a.paymentNumerator)) - base.output * WAD
  const addressCeilResidual = base.output - sum(addresses.map(a => a.ceilPayment))
  const result = { down, soldCurrency: address(down ? record.pool.key.currency0 : record.pool.key.currency1, true),
    paymentCurrency: address(down ? record.pool.key.currency1 : record.pool.key.currency0, true), originalInput, vectorBound,
    cases: Object.freeze(cases), records: Object.freeze(records), addresses: Object.freeze(addresses),
    recordRawDeficitNumerator: candidate.rawDeficitNumerator, recordCeilResidual: candidate.ceilResidual, recordCeilDeficit: candidate.ceilDeficit,
    addressRawDeficitNumerator, addressCeilResidual, addressCeilDeficit: addressCeilResidual < 0n ? -addressCeilResidual : 0n }
  const researchHash = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' },
    { type: 'tuple', components: RESEARCH_RESULT_COMPONENTS }], [RESEARCH_TYPEHASH, coverage.coverageHash, result]))
  return Object.freeze({ scope: 'one-sided-linear-raw-unit-pivots', coverageHash: coverage.coverageHash, researchHash, ...result })
}
