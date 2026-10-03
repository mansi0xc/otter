# Checkpoint 4B — independent BigInt execution reference

Prepared 3 October 2026. Starting revision: user-created commit `051c11f`.
Status: committed by the user as `49586b3`; clean tree verified before 4C.
The user creates every commit. No deployment or live transaction is included.

## What was achieved

`solver/src/execution.ts` is an offline BigInt reference for the bounded
zero-fee exact-input oracle introduced in checkpoint 4A. It targets the pinned
v4.0.0 core at `e50237c43811bd9b526eff40f26772152a42daba`.

The amount calculation is independent of Solidity's implementation:

```text
amount0 = round(L * 2^96 * (highPrice - lowPrice) / (highPrice * lowPrice))
amount1 = round(L * (highPrice - lowPrice) / 2^96)
```

Both use exact nonnegative fractions with explicit floor/ceil rounding. The
direct amount0 fraction equals core's nested divisions, which is checked over
2,048 seeded cases. In the accepted input/price/liquidity domain, core's
currency0 next-price multiplication and denominator cannot overflow uint256;
the reference uses the precise fraction for that branch. It is not a port of
every out-of-domain core math fallback.

The tick inverse uses binary search for the largest tick whose quantized forward
price is at most the requested price, rather than core's logarithm approximation.
The forward tick multipliers and rounding remain the protocol's rules. Tick
inverse tests cover exact tick prices, adjacent raw units, random prices, and
core boundaries. Bitmap traversal scans set bits independently of `BitMath`,
while preserving core's empty-word endpoints and negative floor compression.

All amounts, prices, liquidity, bitmap words, and signed net liquidity remain
BigInt. Metadata numbers are small ABI-bounded integers, never raw token amounts.
The reference preserves snapshot tick, including `tickNext - 1` at a downward
boundary; normalizing it from price alone would lose the liquidity-side state.

## Matching the numerical contract

The reference matches the Solidity quote's fee policy, check order, status
ordinals, diagnostic prefixes, and every result field:

| Quantity | Accepted execution domain |
|---|---|
| Requested exact input | `0 .. 2^96 - 1`; larger ABI-representable input returns `UnsupportedAmount` |
| Output | `0 .. 2^120 - 1` |
| Initial/crossed active liquidity and crossed tick gross | `0 .. 2^88 - 1` |
| Starting price and nonzero-input limit | `2^64 <= sqrtPriceX96 < 2^128` |
| Tick spacing | `1 .. 32767` |
| Bitmap words / initialized crossings / completed steps | 16 / 64 / 80 |
| Fees | Zero key LP, stored LP, and both protocol directions; dynamic keys unsupported |

Only `Complete` and `PriceLimit` are usable. An unsupported traversal is not
converted to an accepted partial fill. Zero input is a model no-op; the public
manager call must still be skipped, because it rejects zero. Empty-liquidity
movement can reach the limit with zero consumption/output.

The model checks ABI representations separately from economic-domain policy.
Negative amounts, amounts above uint256, limits above uint160, fractional
metadata, and wrong-width liquidity are malformed off-chain inputs and throw.
Values representable in Solidity's ABI but outside the selected execution
domain return the specified status. This avoids silently accepting a large
value simply because BigInt arithmetic can represent its products.

Snapshot data is supplied explicitly through maps. Every visited bitmap word,
including an empty word, must be present. A reached initialized tick needs its
gross/net data. Missing state throws `IncompleteSnapshot`; it is not treated as
zero liquidity. The reference does not mutate or authenticate these maps.
Unused outside-trace state need not be supplied; global position and aggregate
liquidity restrictions remain the authenticated vault's responsibility.

## Independent comparisons with real core

`OtterExecutionReference.t.sol` captures slot0, active liquidity, 16 directional
bitmap words, and their initialized tick data directly from the actual local
PoolManager. It does not supply the Solidity oracle's output to the reference.
A dependency-free ABI codec passes that input to the local Node program and
returns the BigInt quote. The test compares all ten output fields, including
unsupported prefixes and traversal counters. In the three-way cases, usable
nonzero quotes also execute a real swap and check input/output deltas and final state.
Zero-input cases instead require the manager's documented rejection.

The bridge uses fixed local program arguments and reads no RPC, uses no secrets,
installs no dependencies, and writes no result fixtures. Its codec rejects
truncation, extra data, incorrect offsets, duplicate word/tick keys, invalid
booleans, and noncanonical signed/unsigned widths. It is **test-only FFI**, not
an on-chain verifier, outcome witness, or production state reader. Production
Solidity bytecode and execution dependencies are unchanged.

The prior oracle test's setup and real-swap assertions were moved unchanged
into `test/utils/OtterExecutionFixture.sol` for reuse. All prior oracle tests
remain active; the extraction introduces no new pool behavior.

The new comparison cases cover:

- Both directions, native input/output, complete and partial consumption,
  overlapping/disjoint ranges, empty words/gaps, and exact tick endings.
- The subsequent snapshot after a downward predecrement, where tick differs
  from the inverse of the exact boundary price.
- Starting price/liquidity/input boundaries, maximum spacing, nonzero/dynamic
  fees, uninitialized/invalid keys, and check precedence on multiply-invalid
  requests.
- Unsupported crossing liquidity, the seventeenth word, sixty-fifth crossing,
  and an unfinished trace at eighty steps, including complete prefix equality.
- **512 randomized comparisons** covering concentrated topology and raw
  price/liquidity/input domains, with both swap directions.

## A concrete mechanism-domain counterexample

With full-range liquidity **1,000**, starting raw price **1:1**, zero fees,
and a downward price limit at tick -100:

| Requested input | Raw output |
|---:|---:|
| 0 | 0 |
| 1 | 0 |
| 2 | 1 |

The BigInt reference and Solidity quote agree; an actual input-2 core swap
returns 1. The second marginal increment is 1 while the first is 0. These
samples violate the discrete concavity inequality, and no continuous concave
curve can match all three points literally. This is a reproducible reason
not to substitute the exact integer quote into the paper's continuous formula
and inherit its proof. It does **not** prove an adapted truthful mechanism is
impossible. G1/G2 still need a defined and evaluated integer payment/allocation
rule, with finite capacity, dust, both-side IR, and counterfactual semantics.

## Validation

Node **24.10.0** with TypeScript stripping; Forge **1.5.1**, solc **0.8.26**,
Cancun, via IR, optimizer 200 runs, pinned local dependencies:

- `npm test` in `solver/`: the existing eight property groups and **20 new execution groups passed**. New execution checks include 2,048 tick/inverse trials, 2,048 fraction-rounding trials, 4,096 seeded snapshot trials, and deterministic boundary/data/ABI cases.
- Deterministic smoke run of the new contract reference suite: **13 passed**.
- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness' -vv`: **245 passed, 0 failed, 23 suites**, including 17 fuzz tests with at least 512 runs each. The new reference suite has 14 tests, one of them the randomized comparison.
- `node --experimental-strip-types test/grant-review.ts`: passes its existing failure reproductions. Dust payment remains 6 versus required 9; equal-ask allocation still favors arrival order. Those are open findings, not fixes.
- `forge build --offline --sizes`: passed, including deployment/benchmark compilation; existing lint/style suggestions remain.
- `forge fmt --check` on all changed/new Solidity files and `git diff --check`: passed.

The production runtime/init sizes remain exactly checkpoint 4A's values:
oracle **6,882 / 7,057** bytes; hook **3,231 / 15,732**; vault
**11,688 / 12,023**; book **14,758 / 15,290**; settlement **11,233 / 11,752**.
The moved cold oracle fixtures still measure **599,783 / 600,847 gas** for their
two directions. FFI test gas is not a production verifier estimate; G3 must
measure the complete on-chain computation with counterfactuals and accounting.

`npm test` now includes the execution reference. `npm run test:execution`
runs it alone. The contract suite needs Node with TypeScript stripping on PATH;
the existing Foundry profile already enables FFI. A missing runtime fails the
comparison instead of silently skipping it. Saved legacy vectors and economic
benchmark artifacts were not regenerated.

## Remaining work and grant claims

Execution-domain correspondence is implemented; this does not make the legacy
auction reference canonical or fix its allocation/payment boundaries. R2, R6,
and R7 remain open. Opening pool/configuration/ownership snapshots, a block-pinned
production state reader, discrete mechanism gates G1/G2, full verifier resource
gate G3, actual-delta/partial-settlement integration, and historical reward claims
remain pending. Concentrated custody works; concentrated auctions remain gated.

Passing differential tests is evidence for the tested execution domain, not
an external audit, a proof of every state/input, a truthfulness proof, or grant
approval. Wallet migration, testnet demonstrations, economics, and independent
contract/mechanism reviews remain separate deliverables.

## User-created commit handoff

Include exactly these files:

```text
solver/src/execution.ts
solver/src/execution-abi.ts
solver/src/execution-cli.ts
solver/test/execution.ts
solver/package.json
contracts/test/OtterExecutionReference.t.sol
contracts/test/utils/OtterExecutionFixture.sol
contracts/test/OtterExecutionOracle.t.sol
reviews/CHECKPOINT_4B.md
reviews/CHECKPOINT_4A.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
fixtures/README.md
README.md
```

Suggested title:

```text
test: cross-check v4 execution with independent BigInt math
```

Suggested explanation:

> Add exact BigInt execution math with matching numerical limits, statuses, and explicit snapshot completeness. Compare every quote field with Solidity and real v4 swaps, including 512 randomized cases. Preserve the concentrated auction gate and document the integer concavity counterexample and remaining mechanism work.

The user created commit `49586b3`; the original handoff and validation above
are retained. The next implemented slice is [checkpoint 4C](./CHECKPOINT_4C.md).
