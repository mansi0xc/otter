/**
 * Emits fixtures/demo-batch.json — a batch with real reservation values, solved by
 * the exact solver, for contracts/test/SolverEndToEnd.t.sol to settle on-chain.
 *
 *   npm run demo
 *
 * Why this exists: every other settlement test builds its outcome in Solidity with
 * every bidder at ask = 0, which makes the allocation trivial and collapses the
 * Clarke pivot to a closed form. That tests the contracts but never exercises the
 * solver — the sorted-ask walk, partial fills, eligibility filtering, leave-one-out
 * pivots. Until this fixture existed, the two halves of the project had no code
 * path connecting them.
 *
 * The pool is pinned to a 1:1 price so the virtual reserves are exactly the
 * liquidity, and the Foundry test can reproduce the solver's view of the curve
 * without an oracle.
 */

import { solveExact, selfCheck, type Order } from "./exact.ts";
import { OK } from "./fixed.ts";

const WAD = 10n ** 18n;

/** at SQRT_PRICE_1_1 the virtual reserves both equal the liquidity */
const LIQUIDITY = 10n ** 21n;
const R0 = LIQUIDITY;
const R1 = LIQUIDITY;

/**
 * Asks are WAD-scaled prices of the token being sold, in the token received. Spot
 * is 1.0 here, so anything above 1e18 is ineligible and must go unfilled — the
 * paper's Theorem 24 rules out Pareto-optimality across ineligible bidders, so
 * this is a rule, not a heuristic, and the batch should exercise it.
 */
const ORDERS: Order[] = [
  { trader: "0", sellingCurrency0: true, ask: 880_000_000_000_000_000n, budget: 30n * 10n ** 18n },
  { trader: "1", sellingCurrency0: true, ask: 930_000_000_000_000_000n, budget: 25n * 10n ** 18n },
  { trader: "2", sellingCurrency0: true, ask: 975_000_000_000_000_000n, budget: 40n * 10n ** 18n },
  { trader: "3", sellingCurrency0: true, ask: 1_040_000_000_000_000_000n, budget: 20n * 10n ** 18n },
  { trader: "4", sellingCurrency0: false, ask: 910_000_000_000_000_000n, budget: 12n * 10n ** 18n },
  { trader: "5", sellingCurrency0: false, ask: 1_150_000_000_000_000_000n, budget: 15n * 10n ** 18n },
];

const out = solveExact(R0, R1, ORDERS);
const verdict = selfCheck(R0, R1, ORDERS, out);
if (verdict.code !== OK) {
  console.error(`solver produced an outcome its own verifier rejects: code ${verdict.code} at ${verdict.index}`);
  process.exit(1);
}

const hex = (v: bigint) => "0x" + v.toString(16);

const fixture = {
  generatedBy: "solver/src/demo-cli.ts",
  note: "Batch with real reservation values, solved exactly. Pool is 1:1 so virtual reserves equal liquidity.",
  liquidity: hex(LIQUIDITY),
  r0: hex(R0),
  r1: hex(R1),
  orderCount: ORDERS.length,
  // 0/1 rather than booleans: forge-std's bool-array JSON helpers are a thinner
  // API surface than the uint ones, and this fixture is read by Solidity.
  sellingCurrency0: ORDERS.map((o) => (o.sellingCurrency0 ? "0x1" : "0x0")),
  ask: ORDERS.map((o) => hex(o.ask)),
  budget: ORDERS.map((o) => hex(o.budget)),
  dominantSellsCurrency0: out.dominantSellsCurrency0 ? "0x1" : "0x0",
  y: out.y.map(hex),
  x: out.x.map(hex),
  burn: hex(out.burn),
  M: hex(out.diagnostics.M),
  totalIn: hex(out.diagnostics.totalIn),
  totalPaid: hex(out.diagnostics.totalPaid),
};

const path = process.argv[2] ?? "../fixtures/demo-batch.json";
const fs = await import("node:fs");
fs.writeFileSync(path, JSON.stringify(fixture, null, 2) + "\n");

const e18 = (v: bigint) => (Number(v) / 1e18).toFixed(6);
console.log(`wrote ${path}\n`);
console.log(`dominant side: ${out.dominantSellsCurrency0 ? "currency0 sellers" : "currency1 sellers"}`);
console.log(`  D_dominant ${e18(out.diagnostics.dDominant)}   D_minority ${e18(out.diagnostics.dMinority)}`);
console.log(`  M          ${e18(out.diagnostics.M)}`);
console.log(`  total in   ${e18(out.diagnostics.totalIn)}   total paid ${e18(out.diagnostics.totalPaid)}`);
console.log(`  burn       ${e18(out.burn)}\n`);
console.log(" # side  ask       budget      filled      paid        clamp");
ORDERS.forEach((o, i) => {
  const side = o.sellingCurrency0 ? "c0" : "c1";
  const dom = o.sellingCurrency0 === out.dominantSellsCurrency0 ? "D" : "m";
  console.log(
    ` ${i} ${side}${dom}  ${e18(o.ask)} ${e18(o.budget).padStart(11)} ` +
      `${e18(out.y[i]).padStart(11)} ${e18(out.x[i]).padStart(11)} ${out.clampDisplacement[i]}`,
  );
});
