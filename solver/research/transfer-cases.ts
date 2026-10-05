/** Complete small allocation-domain evidence; not a chosen allocation rule. */
import { WAD, executionTable, optimize, type Domain } from '../src/discrete-research.ts';
import { MAX_OUTPUT, Q96 } from '../src/execution.ts';
import { analyzeTransfers, type TransferPoint } from '../src/transfer-research.ts';
import { bid, fullPool } from './discrete-cases.ts';
import { scarceLotFrame } from './lot-cases.ts';

export const transferAsks = [WAD / 16n, WAD / 8n, WAD * 3n / 16n];
export const transferPoints = (fills: readonly bigint[], bounds = false): TransferPoint[] =>
  transferAsks.map((ask, i) => ({ ask, input: fills[i],
    lowerPayment: bounds ? (ask * fills[i] + WAD - 1n) / WAD : 0n,
    upperPayment: bounds ? 8n - (WAD / 8n * (4n - fills[i]) + WAD - 1n) / WAD : MAX_OUTPUT }));

export function rawTransferTable() {
  const frame = scarceLotFrame();
  return executionTable(fullPool(1000n, 60, Q96 * 3n / 2n), true, frame.sell0.limit, 1n, 5);
}

/** Exhaust every raw fill response at THREE fixed-budget reported asks.
 * This is all 5^3 responses, not a sample or full multi-user mechanism search.
 * At a fixed target fill k, filling the rival with 4-k maximizes welfare here.
 * Any unused pool capacity only increases the stated regret lower bound.
 */
export function enumerateTransferResponses(d: Domain) {
  if (d.lotSize !== 1n || d.output.length !== 6
    || [0n, 2n, 4n, 6n, 8n, null].some((x, i) => d.output[i] !== x)) {
    throw new RangeError('response enumeration requires the declared raw capacity-four curve');
  }
  const rival = bid(1, WAD / 8n, 4n);
  const efficient = transferAsks.map(ask => optimize(d, [bid(2, ask, 4n), rival]));
  const feasible: { fills: bigint[]; payments: bigint[]; regretNumerator: bigint[]; worstRegretNumerator: bigint }[] = [];
  let examined = 0, infeasible = 0, nonconstantMonotone = 0;
  for (let a = 0n; a <= 4n; a++) for (let b = 0n; b <= 4n; b++) for (let c = 0n; c <= 4n; c++) {
    const fills = [a, b, c], result = analyzeTransfers(transferPoints(fills));
    examined++;
    if (!result.feasible) {
      infeasible++;
      if (a >= b && b >= c && (a !== b || b !== c)) nonconstantMonotone++;
      continue;
    }
    const bounded = analyzeTransfers(transferPoints(fills, true));
    if (!bounded.feasible) throw new Error('unexpected conditional IR/funding conflict');
    const regret = fills.map((fill, i) => efficient[i].welfareNumerator
      - (8n * WAD - transferAsks[i] * fill - rival.ask * (4n - fill)));
    feasible.push({ fills, payments: bounded.payments, regretNumerator: regret,
      worstRegretNumerator: regret.reduce((x, y) => x > y ? x : y) });
  }
  return { examined, infeasible, nonconstantMonotone, feasible,
    minimumWorstRegretNumerator: feasible.reduce((x, row) => x < row.worstRegretNumerator ? x : row.worstRegretNumerator,
      feasible[0].worstRegretNumerator) };
}

export function transferCases() {
  const table = rawTransferTable(), rival = bid(1, WAD / 8n, 4n);
  const efficient = transferAsks.map(ask => optimize(table, [bid(2, ask, 4n), rival]));
  const points = transferPoints(efficient.map(r => r.fill[0]));
  return { schema: 'otter/transfer-research/v1',
    qualification: 'Offline necessary single-identity truthfulness constraints with fixed others/budget. No production rule or universal paper impossibility claim.',
    rawCurve: { lotSize: table.lotSize, output: table.output, quotes: table.quotes, limit: table.limit },
    trueBudget: 4n, asks: transferAsks, rival, efficient, efficientTransferProblem: points,
    efficientTransferAnalysis: analyzeTransfers(points),
    exhaustiveResponses: enumerateTransferResponses(table),
    unit: 'Regret/welfare numerators are WAD-scaled underlying output, not token fractions payable by production.' };
}

export const renderTransferCases = (): string => JSON.stringify(transferCases(), (_k, v) =>
  typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
