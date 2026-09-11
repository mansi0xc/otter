/**
 * Fuzzes the exact solver against its own verifier. The claim being tested is the
 * one the whole solver-to-contract bridge rests on: an outcome produced by
 * solveExact passes the same checks OtterMath.verify performs, with no repair step
 * on the Solidity side.
 */
import { solveExact, selfCheck, type Order } from "../src/exact.ts";
import { OK } from "../src/fixed.ts";

const WAD = 10n ** 18n;
let s = 1234;
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s |= 0; return (s >>> 0) / 4294967296; };
const rb = (lo: bigint, hi: bigint) => lo + BigInt(Math.floor(rnd() * Number(hi - lo)));

let fails = 0, maxClamp = 0n, withBurn = 0, partials = 0, batchesWithPartial = 0;
const N = 3000;
for (let t = 0; t < N; t++) {
  // Reserves deliberately kept CLOSE to the budget scale below. An earlier version
  // used 1e21..1e24 reserves against 1e20 budgets, so the crossing point almost
  // never bound inside a bidder's budget: 2 partial fills in 3000 batches, meaning
  // the allocation walk — the most interesting part of the mechanism — went
  // essentially untested while the fuzz reported all green.
  const r0 = rb(10n ** 20n, 10n ** 21n);
  const r1 = rb(10n ** 20n, 10n ** 21n);
  const n = 1 + Math.floor(rnd() * 6);
  const orders: Order[] = [];
  for (let i = 0; i < n; i++) {
    const c0 = rnd() < 0.6;
    const spot = c0 ? (r1 * WAD) / r0 : (r0 * WAD) / r1;
    orders.push({
      trader: String(i),
      sellingCurrency0: c0,
      ask: rb(0n, (spot * 13n) / 10n),   // straddles the eligibility boundary
      budget: rb(10n ** 17n, 10n ** 20n),
    });
  }
  const out = solveExact(r0, r1, orders);
  const v = selfCheck(r0, r1, orders, out);
  if (v.code !== OK) { fails++; if (fails < 4) console.log("FAIL code", v.code, "index", v.index); }
  let sawPartial = false;
  for (let i = 0; i < orders.length; i++) {
    const d = out.clampDisplacement[i];
    const a = d < 0n ? -d : d;
    if (a > maxClamp) maxClamp = a;
    if (out.y[i] > 0n && out.y[i] < orders[i].budget) { partials++; sawPartial = true; }
  }
  if (sawPartial) batchesWithPartial++;
  if (out.burn > 0n) withBurn++;
}

console.log(`batches solved    ${N}`);
console.log(`verify failures   ${fails}`);
console.log(`max clamp (wei)   ${maxClamp}`);
console.log(`batches with burn ${withBurn}`);
console.log(`partial fills     ${partials}  (in ${batchesWithPartial} batches)`);

// A fuzz that never partially fills is not testing the allocation walk. Guard the
// parameter choice, not just the outcome.
const partialCoverage = (batchesWithPartial / N) * 100;
console.log(`partial coverage  ${partialCoverage.toFixed(1)}% of batches`);
if (partialCoverage < 5) {
  console.log("\nFAIL: fewer than 5% of batches exercise a partial fill.");
  console.log("The crossing-point walk is going untested. Widen budgets relative to reserves.");
  process.exit(1);
}

console.log(fails === 0 ? "\nALL GREEN" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
