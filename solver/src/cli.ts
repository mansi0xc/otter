/**
 * Emits fixtures/vectors.json — the shared test vectors consumed by both
 * solver/test and contracts/test/CrossCheck.t.sol.
 *
 *   npm run vectors
 *
 * Design note: these are deliberately NOT random mid-range batches. A payment
 * sitting comfortably inside its bound tells you nothing about a fixed-point
 * port. Every case here sits ON a boundary, one wei inside it, or one wei
 * outside it, because that is where a wrong rounding direction shows up and
 * nowhere else.
 *
 * Verdicts are not predicted, they are computed: each case is run through the
 * BigInt mirror in fixed.ts and whatever it returns is what gets recorded. So a
 * perturbation that happens to trip an earlier check is still a valid vector.
 */

import {
  WAD,
  type Curve,
  type Fill,
  verify,
  payCeiling,
  mulDivUp,
  spotDown,
} from "./fixed.ts";

// deterministic PRNG — the fixture must not churn between runs
let s = 0x6f74746e;
function rnd(): number {
  s ^= s << 13;
  s ^= s >>> 17;
  s ^= s << 5;
  s |= 0;
  return (s >>> 0) / 4294967296;
}
const between = (lo: bigint, hi: bigint): bigint =>
  lo + (hi > lo ? BigInt(Math.floor(rnd() * Number(hi - lo))) : 0n);

const hex = (v: bigint) => "0x" + v.toString(16);

interface Case {
  name: string;
  curve: Curve;
  fills: Fill[];
}

/** Build a batch whose payments all sit exactly at their ceiling. */
function baseCase(n: number): Case {
  const x0 = between(10n ** 21n, 10n ** 27n);
  const y0 = between(10n ** 21n, 10n ** 27n);
  const M = rnd() < 0.3 ? 0n : between(0n, 10n ** 22n);
  const c: Curve = { x0, y0, M };

  // total input must reach M or the batch is infeasible by construction
  const fills: Fill[] = [];
  let acc = 0n;
  for (let i = 0; i < n; i++) {
    const budget = between(M / BigInt(n) + 1n, M / BigInt(n) + 10n ** 21n);
    const y = rnd() < 0.35 ? budget : between(0n, budget); // sometimes exactly at budget
    fills.push({ ask: 0n, budget, y, x: 0n });
    acc += y;
  }
  if (acc < M) {
    fills[0].budget += M - acc;
    fills[0].y += M - acc;
    acc = M;
  }

  // asks below spot so IR is satisfiable, then pay at the ceiling
  for (let i = 0; i < n; i++) {
    const ceiling = payCeiling(c, fills, i, acc);
    fills[i].x = ceiling;
    // pick an ask whose IR requirement lands under what we just paid
    const maxAsk = fills[i].y === 0n ? 0n : mulDivUp(ceiling, WAD, fills[i].y);
    fills[i].ask = maxAsk === 0n ? 0n : between(0n, maxAsk);
  }
  return { name: "", curve: c, fills };
}

const clone = (k: Case): Case => ({
  name: k.name,
  curve: { ...k.curve },
  fills: k.fills.map((f) => ({ ...f })),
});

const cases: Case[] = [];

for (let t = 0; t < 20; t++) {
  const n = 1 + Math.floor(rnd() * 5);
  const base = baseCase(n);
  const pick = Math.floor(rnd() * n);

  // --- expected to verify ---
  const atBound = clone(base);
  atBound.name = `accept/at-ceiling/${t}`;
  cases.push(atBound);

  const under = clone(base);
  under.name = `accept/one-wei-under/${t}`;
  if (under.fills[pick].x > 0n) under.fills[pick].x -= 1n;
  cases.push(under);

  const atIR = clone(base);
  atIR.name = `accept/exactly-at-IR/${t}`;
  for (const f of atIR.fills) f.x = mulDivUp(f.ask, f.y, WAD);
  cases.push(atIR);

  // --- expected to be rejected ---
  const over = clone(base);
  over.name = `reject/one-wei-over-ceiling/${t}`;
  over.fills[pick].x += 1n;
  cases.push(over);

  const irBreak = clone(base);
  irBreak.name = `reject/one-wei-under-IR/${t}`;
  irBreak.fills[pick].x = mulDivUp(irBreak.fills[pick].ask, irBreak.fills[pick].y, WAD);
  if (irBreak.fills[pick].x > 0n) {
    irBreak.fills[pick].x -= 1n;
    cases.push(irBreak);
  }

  const budgetBreak = clone(base);
  budgetBreak.name = `reject/one-wei-over-budget/${t}`;
  budgetBreak.fills[pick].y = budgetBreak.fills[pick].budget + 1n;
  cases.push(budgetBreak);

  const spotBreak = clone(base);
  spotBreak.name = `reject/above-spot/${t}`;
  spotBreak.fills[pick].x = spotDown(spotBreak.curve, spotBreak.fills[pick].y) + 1n;
  cases.push(spotBreak);

  if (base.curve.M > 0n) {
    const domBreak = clone(base);
    domBreak.name = `reject/total-below-M/${t}`;
    // shrink every fill so the batch cannot reach M
    for (const f of domBreak.fills) {
      f.y = f.y / 4n;
      f.x = 0n;
      f.ask = 0n;
    }
    let tot = 0n;
    for (const f of domBreak.fills) tot += f.y;
    if (tot < domBreak.curve.M) cases.push(domBreak);
  }
}

// zero-fill edge: an order that was priced out entirely
{
  const k = baseCase(2);
  k.name = "accept/priced-out-order";
  k.fills[1].y = 0n;
  k.fills[1].x = 0n;
  let tot = 0n;
  for (const f of k.fills) tot += f.y;
  if (tot >= k.curve.M) {
    k.fills[0].x = payCeiling(k.curve, k.fills, 0, tot);
    cases.push(k);
  }
}

const dir = process.argv[2] ?? "../fixtures/vectors";
const fs = await import("node:fs");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

// One file per case. The cross-check reads these individually: holding a single
// large fixture in memory and re-passing it to every cheatcode call costs
// quadratic memory expansion in the EVM and blows the test's gas limit.
const tally: Record<number, number> = {};
for (let i = 0; i < cases.length; i++) {
  const k = cases[i];
  const v = verify(k.curve, k.fills);
  tally[v.code] = (tally[v.code] ?? 0) + 1;
  const body = {
    name: k.name,
    x0: hex(k.curve.x0),
    y0: hex(k.curve.y0),
    M: hex(k.curve.M),
    ask: k.fills.map((f) => hex(f.ask)),
    budget: k.fills.map((f) => hex(f.budget)),
    y: k.fills.map((f) => hex(f.y)),
    x: k.fills.map((f) => hex(f.x)),
    code: v.code,
    index: v.index,
    arg0: hex(v.arg0),
    arg1: hex(v.arg1),
    totalIn: hex(v.totalIn),
    totalPaid: hex(v.totalPaid),
    burn: hex(v.burn),
  };
  fs.writeFileSync(`${dir}/${i}.json`, JSON.stringify(body) + "\n");
}

fs.writeFileSync(
  `${dir}/index.json`,
  JSON.stringify(
    {
      generatedBy: "solver/src/cli.ts",
      note: "Boundary-focused vectors. Verdicts computed by solver/src/fixed.ts, the BigInt mirror of OtterMath.sol.",
      count: cases.length,
    },
    null,
    2,
  ) + "\n",
);

const label = [
  "accept",
  "BudgetExceeded",
  "PaymentExceedsSpot",
  "PaymentExceedsMarginal",
  "IndividualRationality",
  "DominanceViolated",
  "NegativeBurn",
];
console.log(`wrote ${cases.length} vectors to ${dir}/`);
for (const k of Object.keys(tally).sort()) {
  console.log(`  ${label[Number(k)].padEnd(24)} ${tally[Number(k)]}`);
}
