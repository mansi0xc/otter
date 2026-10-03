# Checkpoint 4A — bounded exact core execution quote

Prepared 3 October 2026. Starting revision: user-created commit `eee2aeb`.
Status: committed by the user as `051c11f`; clean tree inspected before checkpoint 4B.
The user creates every commit. No deployment or live transaction is included.

## What was achieved

`OtterExecutionOracle` provides a bounded, read-only simulation of zero-fee
exact-input `Pool.swap` for the pinned v4.0.0 core at
`e50237c43811bd9b526eff40f26772152a42daba`. Its manager address is immutable.
It hashes the complete pool key and reads slot0, active liquidity, bitmap words,
and crossed tick liquidity using the pinned `StateLibrary` storage layout.
No caller supplies prices, liquidity, ticks, or bitmap contents.

The model uses core `SwapMath`/`SqrtPriceMath`/`TickMath` and reproduces
`TickBitmap` masks and word endpoints. Empty words are real swap steps, not
skipped tick-list entries: their rounding can change consumed input and output.
The oracle caches the current authenticated word; monotone traversal never
revisits a word after leaving it. Signed liquidity crossings, negative floor
compression, zero-liquidity gaps, and the downward `tickNext - 1` transition
match core. Reaching an initialized tick crosses it even when the final input
is exhausted exactly there.

The quote reads only its trusted manager. It never unlocks, swaps, collects fees,
calls tokens/recipients, or writes to pool/oracle storage. Tests record storage
accesses and require no writes, then compare real swaps' signed deltas and
final price, tick, and liquidity. Native and unequal-decimal amounts remain
raw units; display conversion is outside the oracle.

## API and usable results

```solidity
constructor(IPoolManager manager)
quoteExactInput(PoolKey key, bool zeroForOne, uint256 amountIn, uint160 sqrtPriceLimitX96)
    external view returns (Quote)
```

`Quote` includes status, requested and consumed input, output, final sqrt price,
tick and active liquidity, distinct bitmap words read, initialized ticks crossed,
and completed swap steps. Direction `true` means currency0 input/currency1 output.

| Status | Meaning |
|---|---|
| `Complete` | Supported model result; all requested input consumed |
| `PriceLimit` | Supported model result; reached the valid configured limit with input remaining, possibly consuming/outputting zero |
| `UnsupportedPool` | Invalid tick spacing or no initialized pool under that complete key |
| `UnsupportedFees` | Nonzero key/stored LP fee, any protocol fee, or dynamic-fee key |
| `UnsupportedPrice` | Starting price or nonzero-input limit outside the selected interval |
| `UnsupportedAmount` | Requested input above the uint96 budget domain |
| `InvalidPriceLimit` | Nonzero-input limit is equal to, or on the wrong side of, the starting price |
| `LiquidityLimit` | Initial active liquidity, crossed tick gross liquidity, or resulting active liquidity outside the supported domain |
| `OutputLimit` | Adding this step would exceed the output representation cap |
| `WordLimit` / `TickLimit` / `StepLimit` | The unfinished trace would exceed a traversal cap |

**Only `Complete` and `PriceLimit` are usable quotes.** For every other status,
returned amounts/final state describe at most a diagnostic prefix. They are
not execution capacity to accept silently as a partial fill. The counters bound
work and can include a word read while validating a subsequently rejected step;
`steps` counts completed steps only. The oracle stops before committing a step
that fails a crossing/output check.

Zero input is a useful model no-op, returning unchanged state and ignoring the
limit just as `Pool.swap` does. The public **`PoolManager.swap` rejects zero**;
the optimizer/settlement must skip that call when residual input is zero.
Pool initialization, numerical domain, and the zero-fee policy are still checked
before returning this no-op. A nonzero input can traverse empty liquidity and
reach a price limit with zero consumption/output; this does not relax Otter's
nonzero-active-liquidity admission requirement.

## Domain and bounded work

| Quantity | Implemented cap |
|---|---|
| Exact input | `0 .. 2^96 - 1` |
| Output | `0 .. 2^120 - 1`, below core's positive int128 limit |
| Initial/post-crossing active liquidity and crossed tick gross liquidity | `0 .. 2^88 - 1` |
| Starting sqrt price and nonzero-input limit | `2^64 <= price < 2^128` |
| Tick spacing | `1 .. 32767`, the pinned manager's range |
| Distinct bitmap words read | 16, including empty words |
| Initialized tick crossings | 64 |
| Completed swap steps | 80 |
| Fee policy | Zero key LP fee, stored LP fee, and both protocol fee directions; no dynamic-fee key |

The authenticated vault separately bounds 32 funded positions and aggregate
liquidity across all ranges, including inactive ranges. The standalone oracle
does not scan untouched positions/ticks to establish those global conditions.
Its visible-liquidity and traversal checks also bound queries on other pools.
Starting and target prices imply every monotone intermediate price stays in
the selected interval. Amount casts follow their checks; tick-crossing signed
arithmetic uses int256 before validating/narrowing the result.

The cold fixture has 32 disjoint positions, 64 initialized crossings, 16 words,
and 80 steps. `vm.cool` marks the oracle/manager addresses and storage cold
before each direction; setup and actual swaps are outside the measured quote.
It uses zero-liquidity gaps between ranges and a partially consumed uint96-max
request. The same quote/result is then checked against a real swap.

| Direction | Measured caller gas around one quote |
|---|---:|
| Currency1 to currency0 | 599,783 |
| Currency0 to currency1 | 600,847 |

Both run with a **750,000-gas call budget** under local Cancun/optimizer settings.
This is evidence for those cold fixtures, not a proof that every possible trace
is gas-maximal or a target-chain transaction limit. It excludes calldata/intrinsic
transaction gas and the auction, counterfactuals, custody, and reward work.
G3 must measure the complete verifier; repeated quotes can dominate its cost.

## Validation

Forge 1.5.1, solc 0.8.26, Cancun, via IR, optimizer 200 runs, pinned dependencies:

- `forge test --offline --match-contract 'OtterExecutionOracle' -vv`: **32 passed**, including four new fuzz tests with at least 512 runs each.
- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness' -vv`: **231 passed, 0 failed, 22 suites**, including 16 fuzz tests with at least 512 runs each.
- `forge build --offline --sizes`: passed, including deployment/benchmark compilation; existing lint/style suggestions remain.
- `forge fmt --check` on both new Solidity files and `git diff --check`: passed.

Optimized runtime/init bytecode sizes in bytes:

| Contract | Runtime | Init |
|---|---:|---:|
| OtterExecutionOracle | 6,882 | 7,057 |
| OtterHook | 3,231 | 15,732 |
| OtterLiquidityVault | 11,688 | 12,023 |
| OtterOrderBook | 14,758 | 15,290 |
| OtterSettlement | 11,233 | 11,752 |

The new tests cover both directions, full and partial consumption, exact tick
endings, overlapping and disjoint ranges, empty words with detectable rounding
differences from a one-step shortcut, negative unaligned ticks, maximum spacing,
native assets, 6/18 decimals, dust, and price/liquidity/input boundaries.
They require unsupported results for invalid limits, fees/dynamic keys,
uninitialized keys, excessive liquidity, the seventeenth word, sixty-fifth
crossing, and an unfinished trace at eighty steps. An actual Otter full-range
settlement matches the quote. A live concentrated-vault quote succeeds while
its order admission still rejects before escrow. Neither case makes the
legacy allocation or payment rule canonical.

Saved gas/sandwich benchmark artifacts were not regenerated. No solver,
dashboard, deployment script, hook permission, signature schema, or existing
settlement logic changed in this checkpoint.

## What remains

This quotes **core execution**, not arbitrary hook accounting/fee overrides,
token delivery, or transaction inclusion. Constructor code presence is a basic
check, not proof of a manager's identity/layout; deployment must pin the trusted
manager and core revision. A quote is a live-state observation, not a reserved
epoch snapshot or a promise that a later transaction can execute unchanged.
An arbitrary hook can alter manager deltas/state; only the configured Otter
hook is within the intended eventual integration.

Concentrated batch admission/swaps remain gated. Settlement still uses the
legacy full-range model and rejects incomplete input consumption; this
checkpoint does not fix the legacy swap's unconstrained price limit or enable
partial settlement. Explicit opening snapshots, the independent BigInt
execution model and matched domains, actual-delta integration, discrete
allocation/payments (G1/G2), and full verifier resources (G3) are still pending.
R2, R6, and R7 remain open. Historical reward snapshots, wallet migration,
testnet demonstrations, economics, and external reviews remain separate work.

## User-created commit handoff

Include exactly these files:

```text
contracts/src/OtterExecutionOracle.sol
contracts/test/OtterExecutionOracle.t.sol
reviews/CHECKPOINT_4A.md
reviews/CHECKPOINT_3B.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
README.md
```

Suggested title:

```text
feat: add bounded exact v4 execution quotes
```

Suggested explanation:

> Authenticate live pool, tick, and bitmap state for read-only zero-fee exact-input quotes. Match real v4 deltas and final state through crossings, gaps, and price limits; bound traversal and document unsupported results. Add differential/boundary tests while retaining the concentrated auction gate.

Create the commit and confirm completion before the next implementation slice.
