/**
 * Offline transfer-implementability research. Original raw WAD asks and whole
 * inputs/payments are retained. This is a necessary single-user condition with
 * others and budget fixed, NOT a mechanism, two-sided proof or settlement check.
 */
import { WAD } from './discrete-research.ts';
import { MAX_INPUT, MAX_OUTPUT } from './execution.ts';

export const MAX_TRANSFER_REPORTS = 16;
const MAX_ASK = (1n << 128n) - 1n;
export interface TransferPoint {
  ask: bigint;
  input: bigint;
  lowerPayment: bigint;
  upperPayment: bigint;
}
export interface TransferEdge {
  from: number;
  to: number;
  /** p[to] - p[from] <= limit. Node points.length is the zero anchor. */
  limit: bigint;
  kind: 'truthfulness' | 'lower' | 'upper';
}
export type TransferAnalysis = {
  feasible: true; payments: bigint[]; relaxations: number;
} | {
  feasible: false; negativeCycle: TransferEdge[]; cycleWeight: bigint; relaxations: number;
};

function constraints(points: readonly TransferPoint[]): TransferEdge[] {
  if (points.length < 1 || points.length > MAX_TRANSFER_REPORTS) throw new RangeError('report domain exceeded');
  const asks = new Set<bigint>(), edges: TransferEdge[] = [], anchor = points.length;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    for (const [x, max] of [[p.ask, MAX_ASK], [p.input, MAX_INPUT],
      [p.lowerPayment, MAX_OUTPUT], [p.upperPayment, MAX_OUTPUT]]) {
      if (typeof x !== 'bigint' || x < 0n || x > max) throw new RangeError('invalid transfer quantity');
    }
    if (asks.has(p.ask)) throw new RangeError('duplicate reported ask');
    asks.add(p.ask);
    // A lower bound above its upper bound is a valid INFEASIBLE problem.
    edges.push({ from: anchor, to: i, limit: p.upperPayment, kind: 'upper' },
      { from: i, to: anchor, limit: -p.lowerPayment, kind: 'lower' });
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      // Validate every point before monetary operations in the second pass.
      edges.push({ from: i, to: j, limit: 0n, kind: 'truthfulness' });
    }
  }
  for (const e of edges) if (e.kind === 'truthfulness') {
    const n = points[e.from].ask * (points[e.to].input - points[e.from].input);
    // JS BigInt division truncates toward zero. Signed inequalities require
    // mathematical FLOOR, including negative fractional transfer differences.
    e.limit = n / WAD - (n < 0n && n % WAD !== 0n ? 1n : 0n);
  }
  return edges;
}

/** Exact all-pairs single-identity truthfulness inequalities plus integer
 * bounds. Bellman-Ford either constructs integer payments or returns a closed
 * negative cycle: summing its necessary inequalities gives 0 <= negative.
 * Reported input must fit the SAME true budget at every point; the caller owns
 * that model assumption. No ask rounding, optimizer or pivot supplies payments.
 */
export function analyzeTransfers(points: readonly TransferPoint[]): TransferAnalysis {
  const edges = constraints(points), nodes = points.length + 1;
  const distance = Array<bigint>(nodes).fill(0n), predecessor: (TransferEdge | undefined)[] = Array(nodes);
  let last = -1, relaxations = 0;
  for (let pass = 0; pass < nodes; pass++) {
    last = -1;
    for (const e of edges) {
      const next = distance[e.from] + e.limit;
      if (distance[e.to] > next) {
        distance[e.to] = next; predecessor[e.to] = e; last = e.to; relaxations++;
      }
    }
    if (last === -1) {
      const payments = distance.slice(0, points.length).map(p => p - distance[points.length]);
      if (!verifyTransferPayments(points, payments)) throw new Error('invalid transfer potential');
      return { feasible: true, payments, relaxations };
    }
  }
  let node = last;
  for (let i = 0; i < nodes; i++) node = predecessor[node]!.from;
  const start = node, reverse: TransferEdge[] = [];
  do {
    const e = predecessor[node]!;
    reverse.push(e); node = e.from;
    if (reverse.length > nodes) throw new Error('invalid cycle extraction');
  } while (node !== start);
  const negativeCycle = reverse.reverse();
  if (!verifyTransferCycle(points, negativeCycle)) throw new Error('invalid negative cycle');
  return { feasible: false, negativeCycle,
    cycleWeight: negativeCycle.reduce((sum, e) => sum + e.limit, 0n), relaxations };
}

/** Direct scaled utilities, independent of signed-floor constraint encoding. */
export function verifyTransferPayments(points: readonly TransferPoint[], payments: readonly bigint[]): boolean {
  constraints(points);
  if (payments.length !== points.length || payments.some(p => typeof p !== 'bigint')) return false;
  for (let i = 0; i < points.length; i++) {
    if (payments[i] < points[i].lowerPayment || payments[i] > points[i].upperPayment) return false;
    for (let j = 0; j < points.length; j++) {
      if (WAD * (payments[i] - payments[j]) < points[i].ask * (points[i].input - points[j].input)) return false;
    }
  }
  return true;
}

/** Check a bounded closed simple cycle against the actual problem's edges. */
export function verifyTransferCycle(points: readonly TransferPoint[], cycle: readonly TransferEdge[]): boolean {
  const edges = constraints(points);
  if (cycle.length < 2 || cycle.length > points.length + 1) return false;
  const seen = new Set<number>();
  for (let i = 0; i < cycle.length; i++) {
    const e = cycle[i];
    if (seen.has(e.from) || e.to !== cycle[(i + 1) % cycle.length].from
      || !edges.some(real => real.from === e.from && real.to === e.to && real.limit === e.limit && real.kind === e.kind)) return false;
    seen.add(e.from);
  }
  return cycle.reduce((sum, e) => sum + e.limit, 0n) < 0n;
}
