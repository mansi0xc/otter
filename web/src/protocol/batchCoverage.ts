/** Pure inventory of original opening-input prefixes and removal cases.
 * Caller authenticates the supplied 4O anchor. No optimizer, signature/RPC,
 * participant policy, canonical witness or future execution proof is supplied. */
import { encodeAbiParameters, keccak256, stringToHex, zeroAddress, type Address, type Hash } from 'viem'
import { bindOpeningExecution, type OpeningRecord } from './openingExecution.ts'
import { storedBatchCommitment, ORDER_COMPONENTS, type CapturedEpochBatch } from './epochBatch.ts'
import type { CapturedExecutionCurves, ExecutionCurve } from './executionSnapshot.ts'
import type { Order } from './orders.ts'
import { usableQuote } from '../../../solver/src/execution.ts'

export type CoverageAnchor = CapturedEpochBatch['batchBinding']
export const COVERAGE_TYPEHASH = keccak256(stringToHex('OtterOpeningPrefixCoverage/v1'))
export const DIRECTION_COVERAGE_COMPONENTS = [
  { name: 'down', type: 'bool' }, { name: 'requiredInput', type: 'uint256' }, { name: 'domainPresent', type: 'bool' },
  { name: 'maxInput', type: 'uint256' }, { name: 'limit', type: 'uint160' }, { name: 'representedInputs', type: 'uint256' },
  { name: 'missingInputs', type: 'uint256' }, { name: 'unsupportedAt', type: 'uint256[]' }, { name: 'partialAt', type: 'uint256[]' },
] as const
export const COVERAGE_CASE_COMPONENTS = [
  { name: 'kind', type: 'uint8' }, { name: 'trader', type: 'address' }, { name: 'omittedIndices', type: 'uint8[]' },
  { name: 'ordersHash', type: 'bytes32' }, { name: 'directions', type: 'tuple[]', components: DIRECTION_COVERAGE_COMPONENTS },
] as const
export const COVERAGE_ABI = [
  { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' },
  { type: 'uint256' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' },
  { type: 'tuple[]', components: COVERAGE_CASE_COMPONENTS },
] as const
export interface DirectionCoverage {
  down: boolean; requiredInput: bigint; domainPresent: boolean; maxInput: bigint; limit: bigint;
  representedInputs: bigint; missingInputs: bigint; firstMissing: bigint | null;
  unsupportedAt: readonly bigint[]; partialAt: readonly bigint[];
  supportedPrefixRepresented: boolean; wholeInputPrefixAvailable: boolean
}
export interface CoverageCase {
  /** 0 = original, 1 = omit one record, 2 = omit all records for one address.
   * These are inventories, not a selected economic participant definition. */
  kind: 0 | 1 | 2; trader: Address; omittedIndices: readonly number[]; ordersHash: Hash;
  directions: readonly Readonly<DirectionCoverage>[]
}
export interface OpeningPrefixCoverage {
  scope: 'opening-alternative-prefixes'; snapshotHash: Hash; curvesHash: Hash; ordersHash: Hash;
  batchDigest: Hash; coverageHash: Hash; wholeInputPrefixesAvailable: boolean;
  cases: readonly Readonly<CoverageCase>[]
}

function prefix(curve: ExecutionCurve | undefined, down: boolean, requiredInput: bigint): Readonly<DirectionCoverage> {
  const unsupportedAt: bigint[] = [], partialAt: bigint[] = []
  // Only the already bounded table is scanned, never the original uint96 range.
  let representedInputs = 0n
  if (curve) for (const q of curve.points) {
    if (q.requestedInput > requiredInput) break
    ++representedInputs
    if (!usableQuote(q)) unsupportedAt.push(q.requestedInput)
    else if (q.consumedInput !== q.requestedInput) partialAt.push(q.requestedInput)
  }
  const missingInputs = requiredInput + 1n - representedInputs
  const supportedPrefixRepresented = missingInputs === 0n && unsupportedAt.length === 0
  return Object.freeze({ down, requiredInput, domainPresent: !!curve, maxInput: curve?.domain.maxInput ?? 0n,
    limit: curve?.domain.limit ?? 0n, representedInputs, missingInputs,
    firstMissing: missingInputs === 0n ? null : representedInputs,
    unsupportedAt: Object.freeze(unsupportedAt), partialAt: Object.freeze(partialAt),
    supportedPrefixRepresented, wholeInputPrefixAvailable: supportedPrefixRepresented && partialAt.length === 0 })
}

export function inspectOpeningPrefixCoverage(anchor: CoverageAnchor, record: OpeningRecord,
  frame: CapturedExecutionCurves, orders: readonly Order[]): Readonly<OpeningPrefixCoverage> {
  // Revalidate mutable records/curves against the caller-authenticated anchor.
  // Merely supplying matching new hashes alongside invented content is not authentication.
  const opening = bindOpeningExecution(anchor, record, frame)
  for (const field of ['positionsHash', 'weightsHash', 'curvesHash', 'pointCount'] as const) {
    if (opening[field] !== anchor[field]) throw new Error('Coverage opening content changed from its bound anchor.')
  }
  const batch = storedBatchCommitment({ chainId: opening.chainId, book: opening.book, poolId: opening.poolId,
    epoch: opening.epoch, configVersion: opening.configVersion, executeUntil: record.executeUntil,
    count: anchor.count, batchDigest: anchor.batchDigest }, orders)
  for (const field of ['ordersHash', 'batchDigest', 'domainSeparator', 'budget0', 'budget1'] as const) {
    if (batch[field] !== anchor[field]) throw new Error('Coverage batch content changed from its bound anchor.')
  }
  const curves = [frame.curves.find(c => c.domain.down), frame.curves.find(c => !c.domain.down)]
  const cases: Readonly<CoverageCase>[] = []
  const add = (kind: 0 | 1 | 2, trader: Address, omittedIndices: number[]) => {
    const omitted = new Set(omittedIndices), retained = batch.orders.filter((_, i) => !omitted.has(i))
    const budgets = [0n, 0n]
    for (const o of retained) budgets[o.sellingCurrency0 ? 0 : 1] += o.budget
    cases.push(Object.freeze({ kind, trader, omittedIndices: Object.freeze(omittedIndices),
      ordersHash: keccak256(encodeAbiParameters([{ type: 'tuple[]', components: ORDER_COMPONENTS }], [retained])),
      directions: Object.freeze(budgets.map((budget, i) => prefix(curves[i], i === 0, budget))) }))
  }
  add(0, zeroAddress, [])
  batch.orders.forEach((o, i) => add(1, o.trader, [i]))
  const traders = new Map<Address, number[]>()
  batch.orders.forEach((o, i) => { if (!traders.has(o.trader)) traders.set(o.trader, []); traders.get(o.trader)!.push(i) })
  for (const [trader, indices] of traders) add(2, trader, indices)
  const coverageHash = keccak256(encodeAbiParameters(COVERAGE_ABI, [COVERAGE_TYPEHASH, opening.chainId, opening.book,
    opening.poolId, opening.epoch, opening.configVersion, opening.blockNumber, opening.blockHash,
    opening.snapshotHash, opening.curvesHash, batch.ordersHash, batch.batchDigest, cases]))
  return Object.freeze({ scope: 'opening-alternative-prefixes', snapshotHash: opening.snapshotHash,
    curvesHash: opening.curvesHash, ordersHash: batch.ordersHash, batchDigest: batch.batchDigest, coverageHash,
    wholeInputPrefixesAvailable: cases.every(c => c.directions.every(d => d.wholeInputPrefixAvailable)), cases: Object.freeze(cases) })
}

/** Conservative data precondition for experiments assuming full requested
 * input at every original prefix point. It evaluates the content again rather
 * than trusting a caller-supplied report flag. It does not authorize settlement. */
export function requireWholeInputOpeningPrefixes(anchor: CoverageAnchor, record: OpeningRecord,
  frame: CapturedExecutionCurves, orders: readonly Order[]): Readonly<OpeningPrefixCoverage> {
  const report = inspectOpeningPrefixCoverage(anchor, record, frame, orders)
  if (!report.wholeInputPrefixesAvailable) throw new Error('Original opening prefixes contain missing, unsupported or partially consumed inputs.')
  return report
}
