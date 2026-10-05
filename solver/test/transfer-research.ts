import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAD, exhaustive } from '../src/discrete-research.ts';
import { MAX_INPUT, MAX_OUTPUT, Status } from '../src/execution.ts';
import { MAX_TRANSFER_REPORTS, analyzeTransfers, verifyTransferPayments, verifyTransferCycle,
  type TransferPoint } from '../src/transfer-research.ts';
import { bid } from '../research/discrete-cases.ts';
import { rawTransferTable, transferAsks, transferPoints, transferCases, enumerateTransferResponses,
  renderTransferCases } from '../research/transfer-cases.ts';

let groups = 0;
function test(name: string, body: () => void) { body(); groups++; console.log(`PASS ${name}`); }
const point = (ask: bigint, input: bigint, lower = 0n, upper = 4n): TransferPoint =>
  ({ ask, input, lowerPayment: lower, upperPayment: upper });
const c = transferCases();

/** Independent payment-vector enumeration using utilities, never graph floors. */
function brute(points: readonly TransferPoint[], ceiling: number): bigint[] | null {
  const p = points.map(() => 0n);
  function visit(i: number): bigint[] | null {
    if (i < points.length) {
      for (let n = 0; n <= ceiling; n++) {
        p[i] = BigInt(n);
        const found = visit(i + 1);
        if (found) return found;
      }
      return null;
    }
    if (points.some((x, j) => p[j] < x.lowerPayment || p[j] > x.upperPayment)) return null;
    for (let t = 0; t < points.length; t++) for (let r = 0; r < points.length; r++) {
      const honest = WAD * p[t] - points[t].ask * points[t].input;
      const deviation = WAD * p[r] - points[t].ask * points[r].input;
      if (honest < deviation) return null;
    }
    return [...p];
  }
  return visit(0);
}

test('raw quantity domain includes every partial fill and preserves partial-swap diagnostics', () => {
  const d = rawTransferTable();
  assert.equal(d.lotSize, 1n); assert.deepEqual(d.output, [0n, 2n, 4n, 6n, 8n, null]);
  for (let q = 0; q <= 4; q++) {
    assert.equal(d.quotes[q].status, Status.Complete); assert.equal(d.quotes[q].consumedInput, BigInt(q));
  }
  assert.equal(d.quotes[5].status, Status.PriceLimit); assert.equal(d.quotes[5].consumedInput, 4n);
  for (let i = 0; i < transferAsks.length; i++) {
    const r = exhaustive(d, [bid(2, transferAsks[i], 4n), c.rival]);
    const { evaluated: _r, ...actual } = r, { evaluated: _c, ...expected } = c.efficient[i];
    assert.deepEqual(actual, expected);
  }
});
test('efficient raw fills admit no integer payments even without IR or zero-loser normalization', () => {
  assert.deepEqual(c.efficient.map(r => r.fill[0]), [4n, 0n, 0n]);
  const r = c.efficientTransferAnalysis;
  assert.equal(r.feasible, false);
  if (r.feasible) throw new Error('unexpected feasible transfer');
  assert.equal(r.cycleWeight, -1n); assert.ok(verifyTransferCycle(c.efficientTransferProblem, r.negativeCycle));
  assert.ok(r.negativeCycle.every(e => e.kind === 'truthfulness'));
  assert.ok(c.efficientTransferProblem.every(p => p.lowerPayment === 0n && p.upperPayment === MAX_OUTPUT));
});
test('signed fractional differences use floor rather than truncation', () => {
  // Winning report needs p[0]-p[1]>=1; losing report requires <=0.
  const points = [point(WAD / 16n, 4n), point(WAD * 3n / 16n, 0n)];
  const r = analyzeTransfers(points);
  assert.equal(r.feasible, false);
  if (!r.feasible) {
    assert.ok(r.negativeCycle.some(e => e.from === 0 && e.to === 1 && e.limit === -1n));
    assert.ok(r.negativeCycle.some(e => e.from === 1 && e.to === 0 && e.limit === 0n));
  }
  assert.equal(verifyTransferPayments(points, [0n, 0n]), false);
  assert.equal(verifyTransferPayments(points, [1n, 0n]), false);
});
test('exactly aligned payment differences can support distinct partial-fill responses', () => {
  const points = [point(WAD / 4n, 4n, 1n, 8n), point(WAD / 2n, 0n, 0n, 8n)];
  const r = analyzeTransfers(points); assert.equal(r.feasible, true);
  if (r.feasible) { assert.ok(verifyTransferPayments(points, r.payments)); assert.deepEqual(r.payments, [1n, 0n]); }
  // Exact endpoints matter: at cost 1/4, fill 4 has whole cost 1.
  assert.equal(verifyTransferPayments(points, [1n, 0n]), true);
});
test('all 125 raw allocation responses reduce to five constant menus in the low-cost interval', () => {
  const d = rawTransferTable(), rows = enumerateTransferResponses(d);
  assert.equal(rows.examined, 125); assert.equal(rows.infeasible, 120); assert.equal(rows.nonconstantMonotone, 30);
  assert.deepEqual(rows.feasible.map(x => x.fills), [0n, 1n, 2n, 3n, 4n].map(x => [x, x, x]));
  for (let a = 0n; a <= 4n; a++) for (let b = 0n; b <= 4n; b++) for (let cc = 0n; cc <= 4n; cc++) {
    const points = transferPoints([a, b, cc]).map(p => ({ ...p, upperPayment: 8n }));
    const result = analyzeTransfers(points);
    assert.equal(result.feasible, brute(points, 8) !== null);
  }
});
test('any fixed-fill response has a quantified welfare loss even with all remaining capacity used', () => {
  const rows = c.exhaustiveResponses;
  assert.equal(rows.minimumWorstRegretNumerator, WAD / 8n);
  assert.deepEqual(rows.feasible.find(row => row.fills[0] === 2n)!.regretNumerator, [WAD / 8n, 0n, WAD / 8n]);
  // Independently enumerate ALL target/rival fills, including total <4.
  const d = rawTransferTable();
  for (const row of rows.feasible) for (let i = 0; i < transferAsks.length; i++) {
    const k = row.fills[i];
    for (let other = 0n; other + k <= 4n; other++) {
      const welfare = d.output[Number(other + k)]! * WAD - transferAsks[i] * k - c.rival.ask * other;
      assert.ok(c.efficient[i].welfareNumerator - welfare >= row.regretNumerator[i]);
    }
  }
});
test('conditional menu payments meet original IR and leave enough cash for rival IR', () => {
  for (const row of c.exhaustiveResponses.feasible) {
    assert.ok(verifyTransferPayments(transferPoints(row.fills, true), row.payments));
    row.fills.forEach((k, i) => {
      assert.ok(row.payments[i] * WAD >= transferAsks[i] * k);
      const rivalMinimum = (c.rival.ask * (4n - k) + WAD - 1n) / WAD;
      assert.ok(row.payments[i] + rivalMinimum <= 8n);
    });
  }
  // No rival-report or false-name incentives are claimed for these menus.
});
test('payment bounds and one-report feasibility are enforced independently of truthfulness', () => {
  const p = point(WAD, 2n, 2n, 2n), r = analyzeTransfers([p]);
  assert.ok(r.feasible); if (r.feasible) assert.deepEqual(r.payments, [2n]);
  const bad = [point(WAD, 2n, 3n, 2n)], impossible = analyzeTransfers(bad);
  assert.equal(impossible.feasible, false);
  if (!impossible.feasible) assert.ok(verifyTransferCycle(bad, impossible.negativeCycle));
});
test('seeded bounded constraints match exhaustive integer payment search', () => {
  let seed = 0x4a74de21, infeasible = 0;
  const next = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let trial = 0; trial < 1000; trial++) {
    const asks = [...new Set(Array.from({ length: 9 }, () => BigInt(next(10)) * WAD / 4n))].slice(0, 3);
    if (asks.length < 3) throw new Error('seeded report construction shortfall');
    const points = asks.map(a => point(a, BigInt(next(5)), BigInt(next(5)), BigInt(next(5))));
    const reference = brute(points, 4), r = analyzeTransfers(points);
    assert.equal(r.feasible, reference !== null);
    if (r.feasible) assert.ok(verifyTransferPayments(points, r.payments));
    else { infeasible++; assert.ok(verifyTransferCycle(points, r.negativeCycle)); }
  }
  console.log(`  1000 bounded problems, ${infeasible} independently infeasible`);
});
test('certificates reject changed weights, edges, problems and nonclosed cycles', () => {
  const p = c.efficientTransferProblem, r = analyzeTransfers(p);
  if (r.feasible) throw new Error('expected negative cycle');
  const cycle = r.negativeCycle;
  assert.equal(verifyTransferCycle(p, cycle.slice(0, 1)), false);
  assert.equal(verifyTransferCycle(p, [...cycle, ...cycle]), false);
  assert.equal(verifyTransferCycle(p, cycle.map((e, i) => i ? e : { ...e, limit: e.limit - 1n })), false);
  assert.equal(verifyTransferCycle(p.map(x => ({ ...x, input: 0n })), cycle), false);
  assert.equal(verifyTransferCycle(p, cycle.map((e, i) => i ? e : { ...e, to: 999 })), false);
  assert.equal(verifyTransferPayments(p, [0n]), false);
  assert.equal(verifyTransferPayments(p, [-1n, 0n, 0n]), false);
});
test('wide monetary products and maximum report counts stay exact BigInt', () => {
  const asks = Array.from({ length: MAX_TRANSFER_REPORTS }, (_, i) => (1n << 128n) - 1n - BigInt(i));
  const r = analyzeTransfers(asks.map(a => point(a, MAX_INPUT, MAX_OUTPUT, MAX_OUTPUT)));
  assert.ok(r.feasible); if (r.feasible) assert.deepEqual(r.payments, asks.map(() => MAX_OUTPUT));
  // Wide cost differences cannot wrap into apparently truthful whole payments.
  const impossible = analyzeTransfers([point(asks[0], 0n, 0n, MAX_OUTPUT), point(asks[1], MAX_INPUT, 0n, MAX_OUTPUT)]);
  assert.equal(impossible.feasible, false);
});
test('malformed research quantities are rejected and the golden artifact reproduces exactly', () => {
  assert.throws(() => analyzeTransfers([]), RangeError);
  assert.throws(() => analyzeTransfers(Array.from({ length: 17 }, (_, i) => point(BigInt(i), 0n))), RangeError);
  assert.throws(() => analyzeTransfers([point(1n, 0n), point(1n, 0n)]), RangeError);
  for (const bad of [point(-1n, 0n), point(1n << 128n, 0n), point(0n, MAX_INPUT + 1n),
    point(0n, 0n, -1n), point(0n, 0n, 0n, MAX_OUTPUT + 1n), { ...point(0n, 0n), ask: 1 as unknown as bigint }]) {
    assert.throws(() => analyzeTransfers([bad]), RangeError);
  }
  assert.throws(() => enumerateTransferResponses({ lotSize: 1n, output: [0n, 2n] }), RangeError);
  assert.equal(renderTransferCases(), readFileSync(new URL('../../fixtures/research/transfer-research.json', import.meta.url), 'utf8'));
});
console.log(`${groups} transfer implementability research groups passed`);
