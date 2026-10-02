# Checkpoint 2A: authenticated LP custody

Baseline: user commit `a7637a9`. Prepared 2 October 2026. This is the first code slice of remediation step 2, not a production-readiness declaration.

## Implemented

- `OtterLiquidityVault` owns each underlying v4 position under its unique position ID/salt. Its nontransferable ledger records the beneficial owner, pool, range, and liquidity. Only that owner can add, remove, or collect. Arbitrary routers cannot enter the hook's liquidity callbacks, including zero-delta fee collection.
- The hook creates its immutable vault in its constructor. The existing two-argument hook constructor remains intact; pool registration now binds the order book to the real vault's liquidity guard.
- Support full-range, overlapping/concentrated, and one-sided LP ranges, with tick-spacing checks and bounded positions/aggregate liquidity. Native ETH funding requires exactly the actual native debt and explicitly syncs before settling. ERC20 deposits support optional returns and verify that PoolManager received the principal owed; taxed or false-return funding reverts atomically.
- Removal and fee collection create owner claims backed by PoolManager ERC6909 credits. They perform no transfer to the beneficiary. Claims are isolated per owner/currency, can choose an owner-authorized recipient, and restore accounting if delivery fails. No broad credit operator approval is granted.
- Deposit maxima and withdrawal minima apply to principal separately from accrued fees, so a large fee credit cannot hide an excessive deposit cost or falsely satisfy a withdrawal minimum.
- A first order's escrow callback cannot withdraw liquidity before the order count is stored. Once settlement consumes a batch, a separate execution flag keeps the economic lock active until payouts and surplus accounting finish. Settlement and surplus flushes have reentrancy guards.
- The deployment script seeds the vault directly for the deployer and reports the vault address, LP position ID, and owner. It no longer deploys or funds `PoolModifyLiquidityTest` for Otter liquidity.
- Existing integration fixtures use authenticated custody. R1's active regression now asserts that the theft is rejected, while the remaining attack reproductions stay active and explicitly remain open.

## Boundaries and unfinished work

**Native LP custody is implemented; native trader orders are not yet implemented.** The order book/settlement still reject native order-pool registration. Checkpoint 2B handles native escrow, optional-return trader deposits, and receipt accounting. Do not describe this checkpoint as complete ETH trading support.

**Concentrated LP custody is implemented; concentrated batch execution is deliberately blocked.** The vault rejects legacy batch admission before nonce use/escrow while any funded non-full-range position exists, and the hook rejects a settlement swap using that unsupported curve. Removing all such liquidity restores full-range admission. Step 4 supplies the tick-aware execution/auction model before that guard can change.

This interim guard includes inactive concentrated ranges because a future swap could enter them. Opening a concentrated position temporarily disables trading on that pool; that is visible prototype behavior, not a hidden quote fallback.

Queued exits, stored trader recovery, batch caps, signed execution expiry, canonical payments, and historical LP rewards are subsequent checkpoints. The original R2–R9 reproductions still demonstrate open issues. The vault's per-owner principal/fee claims do not fix the order book's atomic batch refund or the old surplus donation policy. R1 is addressed in the new source/deployment path; existing deployments retain their old contracts and router risk until separately migrated.

Prototype limits are 32 funded position records per pool, total liquidity below `2^88`, and the supported sqrt-price domain in the specification. These are engineering bounds rather than measured production capacities. Scarce LP slots can be occupied by one actor; this version does not claim permissionless participation without capacity constraints. External fee donations can create credits above the ordinary `2^120 - 1` operation cap: preserve them and allow bounded claims rather than letting another owner's outstanding claims or a large donation block exits.

The vault is new security-sensitive code. Local tests are evidence for the listed regressions, not an independent audit or mechanism proof. No live deployment/broadcast was performed.

## LP integration API

1. Read `hook.liquidityVault()`; approve that vault for each nonzero currency.
2. Call `createPosition(key, tickLower, tickUpper, liquidity, amount0Max, amount1Max)`. For native currency0, attach the exact native amount required by the position at the current price. The caller becomes the owner; another caller cannot select their position's salt.
3. Increase with `increaseLiquidity(id, liquidity, max0, max1)`. Between batches, remove with `removeLiquidity(id, liquidity, min0, min1)` or collect with `collectFees(id)`.
4. Read `claims(owner, currency)` and call `claim(currency, amount, recipient)` as that owner. Removal/collection does not imply assets already arrived at the wallet. An amount exceeding the individual operation cap can be claimed in multiple transactions.

Position IDs persist after exit. Re-adding to the same owner's empty position preserves its identity; IDs are never assigned to another owner. Historical batch reward snapshots will bind that owner separately in step 6.

The order-book registration ABI changes to `registerPoolCurrencies(poolId, currency0, currency1, liquidityGuard)`, callable only by the configured settlement. Real pool registration obtains the immutable guard from the approved hook. Tests without a real pool use an explicitly test-only no-op guard.

## Validation

- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'`: **134 tests passed, zero failures**, including eight fuzz tests with at least 512 cases each. The remaining unsafe-behavior reproductions passing does not close their findings.
- The 14 vault tests cover ownership, two independent owners, separate principal/fee slippage bounds, backed claims, failed recipients, native debt/value isolation, optional/taxed/false-return funding, position/liquidity caps, first-escrow callbacks, deposit reentrancy, and large external fee credits. The 13 hook tests cover sender gates, freeze/completion, range custody, unsupported admission/swaps, and restoration after a concentrated exit.
- Production runtime sizes from compiled artifacts: hook 2,406 bytes; vault 8,937 bytes; order book 7,086 bytes; settlement 9,688 bytes. Hook init code is 12,128 bytes, including the vault deployment. These fit ordinary EVM code-size bounds; size is not a gas-capacity or security proof.
- `forge build --offline`: successful, including the deployment script. Forge emits style notes and existing arithmetic/cast warnings; this is not a clean-lint claim. The new scripted liquidity cast is guarded by the vault's `2^88 - 1` limit.
- `git diff --check` and local documentation links passed. No saved benchmark result was rewritten.

Benchmark suites that write saved result artifacts are excluded from the ordinary regression run; their liquidity fixtures are migrated and compiled. No web/solver code changed in this slice, so their baseline checks were not repeated. Deployment code was compiled locally; it was not broadcast.

## User-created commit handoff

Include these 24 changed/new files (all were created or changed in this checkpoint). Do not include ignored build/cache output or rewrite saved benchmark results.

```text
contracts/script/Deploy.s.sol
contracts/src/OtterHook.sol
contracts/src/OtterLiquidityVault.sol
contracts/src/OtterOrderBook.sol
contracts/src/OtterSettlement.sol
contracts/src/interfaces/IOtterLiquidityGuard.sol
contracts/test/GasCurve.t.sol
contracts/test/GrantReview.t.sol
contracts/test/OtterHook.t.sol
contracts/test/OtterLiquidityVault.t.sol
contracts/test/OtterMargin.t.sol
contracts/test/OtterOrderBook.t.sol
contracts/test/OtterOrderBookView.t.sol
contracts/test/OtterSettlement.t.sol
contracts/test/OtterSettlementSellX.t.sol
contracts/test/OtterSurplusToLPs.t.sol
contracts/test/SandwichHarness.t.sol
contracts/test/SolverEndToEnd.t.sol
contracts/test/utils/MockLiquidityGuard.sol
contracts/test/utils/OtterHookFixture.sol
contracts/test/utils/OtterTestDeployers.sol
reviews/CHECKPOINT_2A.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
```

Suggested title: `fix: replace shared LP router with authenticated vault custody`

Suggested explanation:

> Add owner-authenticated range positions with native/ERC20 funding and isolated LP claims. Gate all liquidity callbacks to the vault, preserve the freeze through escrow/settlement callbacks, seed deployment through authenticated custody, and reject concentrated batches until tick-aware settlement is ready.

The assistant makes no Git commit. Await the user's commit confirmation before checkpoint 2B.
