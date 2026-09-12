import { AugmentedCurve } from "../src/curve.ts";
import type { Bid } from "../src/onesided.ts";
import { pivotsNaive, runOneSided, welfare } from "../src/onesided.ts";
import type { Pool, SellX, SellY, Flows } from "../src/otter.ts";
import { solve, utilitySellY } from "../src/otter.ts";

let rngState = 0x2545f491;
function rnd(): number {
  rngState ^= rngState << 13;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;
  rngState |= 0;
  return (rngState >>> 0) / 4294967296;
}
const uni = (a: number, b: number) => a + rnd() * (b - a);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}
const close = (a: number, b: number, tol = 1e-6) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function randomPool(): Pool {
  return { x0: uni(1e3, 1e6), y0: uni(1e3, 1e6) };
}
function randomBids(n: number, spot: number): Bid[] {
  return Array.from({ length: n }, () => ({
    // asks straddle the eligibility boundary so ineligible bids are exercised
    ask: uni(0, spot * 1.3),
    budget: uni(0, 400),
  }));
}

// --- 1. Layer-cake pivots must equal naive pivots exactly -------------------
console.log("1. Lemma-16 pivots vs naive leave-one-out");
let maxRelErr = 0;
for (let trial = 0; trial < 4000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const n = 1 + Math.floor(rnd() * 9);
  const bids = randomBids(n, sigma0);
  const M = rnd() < 0.4 ? 0 : uni(0, 300);
  const curve = new AugmentedCurve(pool.x0, pool.y0, M);

  const naive = pivotsNaive(curve, bids);
  const fast = runOneSided(curve, bids).pivot;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(naive[i] - fast[i]) / Math.max(1, Math.abs(naive[i]));
    maxRelErr = Math.max(maxRelErr, err);
    check("pivot mismatch", err < 1e-6, `naive=${naive[i]} fast=${fast[i]}`);
  }
}
console.log(`   max relative error over 4000 batches: ${maxRelErr.toExponential(3)}`);

// --- 2. Theorem 12(a)-(c) invariants ---------------------------------------
console.log("2. one-sided invariants (Thm 12 a-c)");
for (let trial = 0; trial < 4000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const bids = randomBids(1 + Math.floor(rnd() * 9), sigma0);
  const M = uni(0, 300);
  const curve = new AugmentedCurve(pool.x0, pool.y0, M);
  const r = runOneSided(curve, bids);
  let sumPay = 0;
  for (let i = 0; i < bids.length; i++) {
    sumPay += r.pay[i];
    check("0 <= y <= budget", r.alloc[i] >= -1e-9 && r.alloc[i] <= bids[i].budget + 1e-9);
    check("x >= 0", r.pay[i] >= -1e-9);
    const bound = curve.F(r.totalIn) - curve.F(r.totalIn - r.alloc[i]);
    check("x <= F(Y*) - F(Y*-y)", r.pay[i] <= bound + 1e-6);
    check("x <= sigma0*y", r.pay[i] <= sigma0 * r.alloc[i] + 1e-6);
    check("individual rationality", r.pay[i] - bids[i].ask * r.alloc[i] >= -1e-9);
  }
  check("sum x <= F(Y*)", sumPay <= curve.F(r.totalIn) + 1e-6);
}

// --- 3. Two-sided: feasibility, Fact 13/14, nonnegative burn ---------------
console.log("3. two-sided feasibility, Q >= M, burn >= 0");
for (let trial = 0; trial < 4000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const rho0 = 1 / sigma0;
  const ys: SellY[] = randomBids(Math.floor(rnd() * 7), sigma0);
  const xs: SellX[] = randomBids(Math.floor(rnd() * 7), rho0);
  const o = solve(pool, ys, xs);

  check("burn >= 0", o.burn >= -1e-6, `burn=${o.burn}`);
  const Qy = o.sellY.reduce((s, a) => s + a.y, 0);
  const Qx = o.sellX.reduce((s, a) => s + a.x, 0);
  if (o.dominant === "Y") {
    check("Q_Y >= M (Fact 13)", Qy >= o.M - 1e-6, `Qy=${Qy} M=${o.M}`);
    // Y in == Y out: minority receives exactly M, residual goes to the pool.
    const yToMinority = o.sellX.reduce((s, a) => s + a.y, 0);
    check("minority receives M", close(yToMinority, o.M), `${yToMinority} vs ${o.M}`);
  } else {
    check("Q_X >= M (Fact 14)", Qx >= o.M - 1e-6, `Qx=${Qx} M=${o.M}`);
    const xToMinority = o.sellY.reduce((s, a) => s + a.x, 0);
    check("minority receives M", close(xToMinority, o.M), `${xToMinority} vs ${o.M}`);
  }
  for (const b of o.sellY) check("sellY IR-ish: x >= 0", b.x >= -1e-9);
  for (const b of o.sellX) check("sellX y >= 0", b.y >= -1e-9);
}

// --- 4. Order insensitivity -------------------------------------------------
console.log("4. order insensitivity (builder cannot gain by reordering)");
for (let trial = 0; trial < 2000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const rho0 = 1 / sigma0;
  const ys = randomBids(1 + Math.floor(rnd() * 6), sigma0);
  const xs = randomBids(1 + Math.floor(rnd() * 6), rho0);
  const base = solve(pool, ys, xs);
  const perm = ys.map((_, i) => i).sort(() => rnd() - 0.5);
  const shuffled = solve(pool, perm.map((i) => ys[i]), xs);
  for (let i = 0; i < ys.length; i++) {
    check("alloc invariant under permutation", close(base.sellY[perm[i]].y, shuffled.sellY[i].y));
    check("pay invariant under permutation", close(base.sellY[perm[i]].x, shuffled.sellY[i].x));
  }
  check("burn invariant under permutation", close(base.burn, shuffled.burn));
}

// --- 5. Truthfulness: no single misreport beats truth -----------------------
console.log("5. truthfulness for a sell-Y user (single misreport)");
function flowsFor(o: ReturnType<typeof solve>, yIdx: number[], xIdx: number[]): Flows {
  let SY = 0, RX = 0, SX = 0, RY = 0;
  for (const i of yIdx) { SY += o.sellY[i].y; RX += o.sellY[i].x; }
  for (const j of xIdx) { SX += o.sellX[j].x; RY += o.sellX[j].y; }
  return { SY, RX, SX, RY };
}
let worstGain = 0;
for (let trial = 0; trial < 3000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const rho0 = 1 / sigma0;
  const others: SellY[] = randomBids(Math.floor(rnd() * 5), sigma0);
  const xs: SellX[] = randomBids(Math.floor(rnd() * 5), rho0);
  const v = uni(0, sigma0 * 1.2);
  const q = uni(1, 300);

  const truthful = solve(pool, [{ ask: v, budget: q }, ...others], xs);
  const uTruth = utilitySellY(flowsFor(truthful, [0], []), v, q);

  for (let m = 0; m < 12; m++) {
    const ask = rnd() < 0.5 ? uni(0, sigma0 * 1.2) : v * uni(0.2, 3);
    const budget = rnd() < 0.5 ? uni(0, 400) : q * uni(0.2, 3);
    const dev = solve(pool, [{ ask, budget }, ...others], xs);
    const uDev = utilitySellY(flowsFor(dev, [0], []), v, q);
    const gain = uDev - uTruth;
    if (Number.isFinite(gain)) worstGain = Math.max(worstGain, gain);
    check("misreport beats truth", gain <= 1e-6, `gain=${gain} v=${v} q=${q}`);
  }
}
console.log(`   worst finite deviation gain: ${worstGain.toExponential(3)}`);

// --- 6. Sybil-proofness: splitting into k identities ------------------------
console.log("6. sybil-proofness (same-direction split)");
let worstSybil = 0;
for (let trial = 0; trial < 2000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const rho0 = 1 / sigma0;
  const others: SellY[] = randomBids(Math.floor(rnd() * 5), sigma0);
  const xs: SellX[] = randomBids(Math.floor(rnd() * 5), rho0);
  const v = uni(0, sigma0);
  const q = uni(1, 300);

  const truthful = solve(pool, [{ ask: v, budget: q }, ...others], xs);
  const uTruth = utilitySellY(flowsFor(truthful, [0], []), v, q);

  const k = 2 + Math.floor(rnd() * 3);
  const sybils: SellY[] = [];
  for (let s = 0; s < k; s++) {
    sybils.push({ ask: rnd() < 0.5 ? uni(0, sigma0) : v * uni(0.3, 2), budget: uni(0, q) });
  }
  const dev = solve(pool, [...sybils, ...others], xs);
  const mine = sybils.map((_, i) => i);
  const uDev = utilitySellY(flowsFor(dev, mine, []), v, q);
  const gain = uDev - uTruth;
  if (Number.isFinite(gain)) worstSybil = Math.max(worstSybil, gain);
  check("sybil split beats truth", gain <= 1e-6, `gain=${gain}`);
}
console.log(`   worst finite sybil gain: ${worstSybil.toExponential(3)}`);

// --- 7. Cross-direction sybils ---------------------------------------------
console.log("7. cross-direction sybils (sell-Y user submitting sell-X bids)");
let worstCross = 0;
for (let trial = 0; trial < 2000; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const rho0 = 1 / sigma0;
  const others: SellY[] = randomBids(Math.floor(rnd() * 5), sigma0);
  const otherX: SellX[] = randomBids(Math.floor(rnd() * 5), rho0);
  const v = uni(0, sigma0);
  const q = uni(1, 300);

  const truthful = solve(pool, [{ ask: v, budget: q }, ...others], otherX);
  const uTruth = utilitySellY(flowsFor(truthful, [0], []), v, q);

  const myY: SellY[] = [{ ask: uni(0, sigma0), budget: uni(0, q * 2) }];
  const myX: SellX[] = [{ ask: uni(0, rho0), budget: uni(0, 300) }];
  const dev = solve(pool, [...myY, ...others], [...myX, ...otherX]);
  const uDev = utilitySellY(flowsFor(dev, [0], [0]), v, q);
  const gain = uDev - uTruth;
  if (Number.isFinite(gain)) worstCross = Math.max(worstCross, gain);
  check("cross-direction sybil beats truth", gain <= 1e-6, `gain=${gain} v=${v} q=${q}`);
}
console.log(`   worst finite cross-direction gain: ${worstCross.toExponential(3)}`);

// --- 8. allocate() is welfare-optimal, checked against an independent grid --
// Sections 1-7 all derive from `allocate` (directly, or through `runOneSided`
// and `solve`, which call it) -- so a bug that makes `allocate` pick a
// non-optimal fill would pass every check above, because the naive pivots and
// the two-sided invariants would simply agree with whatever `allocate` says.
// This section does not call `allocate` (or anything that calls it) as its
// oracle. It grid-searches the allocation space directly and independently
// recomputes welfare = F(sum y_i) - sum ask_i*y_i for every point on the grid,
// and checks nothing on the grid beats what `allocate` actually returned.
console.log("8. allocate() welfare vs an independent grid search (n<=4)");

/** Cartesian product of each bid's [0, budget] grid, evaluated in place so
 *  memory stays O(n) rather than materialising every combination up front. */
function gridBestWelfare(curve: AugmentedCurve, bids: Bid[], steps: number): number {
  const y = new Array(bids.length).fill(0);
  let best = -Infinity;
  function rec(i: number, total: number, cost: number): void {
    if (i === bids.length) {
      const w = curve.F(total) - cost;
      if (w > best) best = w;
      return;
    }
    const { ask, budget } = bids[i];
    for (let k = 0; k <= steps; k++) {
      const yi = (budget * k) / steps;
      y[i] = yi;
      rec(i + 1, total + yi, cost + ask * yi);
    }
  }
  rec(0, 0, 0);
  return best;
}

const GRID_STEPS = 20; // (GRID_STEPS+1)^n points; n<=4 keeps this at or under 21^4 ~= 194k
let worstGridGap = -Infinity; // algoWelfare - gridBest; should never be meaningfully negative
for (let trial = 0; trial < 300; trial++) {
  const pool = randomPool();
  const sigma0 = pool.x0 / pool.y0;
  const n = 1 + Math.floor(rnd() * 4); // 1..4
  // Budgets kept modest (grid resolution is budget/GRID_STEPS per bidder) and
  // asks straddle sigma0 so both eligible and ineligible bidders are covered.
  const bids: Bid[] = Array.from({ length: n }, () => ({
    ask: uni(0, sigma0 * 1.3),
    budget: uni(1, 200),
  }));
  const M = rnd() < 0.4 ? 0 : uni(0, 150);
  const curve = new AugmentedCurve(pool.x0, pool.y0, M);

  const algoWelfare = welfare(curve, bids);
  const gridBest = gridBestWelfare(curve, bids, GRID_STEPS);
  const gap = algoWelfare - gridBest;
  worstGridGap = Math.max(worstGridGap, -gap); // how much the grid beat the algorithm by, if at all

  // Quantisation slack: near the true optimum F is smooth and concave, so a
  // grid step of size d away from the continuous optimum costs O(d^2) in
  // welfare, not O(d) -- but at most one bidder sits exactly at the margin
  // (K(ask) generically lands between two grid points for that one bidder),
  // so the bound used here is deliberately loose: sigma0 * (largest step
  // size among the bidders), which dominates the true second-order error with
  // room to spare rather than trying to derive the tight constant.
  const maxStep = Math.max(...bids.map((b) => b.budget / GRID_STEPS));
  const tol = sigma0 * maxStep + 1e-6;
  check(
    "allocate() matches or beats every grid point",
    gap >= -tol,
    `gap=${gap.toExponential(3)} tol=${tol.toExponential(3)} n=${n} M=${M.toFixed(1)}`,
  );
}
console.log(`   worst (grid - algo) gap, i.e. how much the grid ever beat allocate(): ${worstGridGap.toExponential(3)}`);

console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
