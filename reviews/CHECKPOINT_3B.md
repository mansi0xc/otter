# Checkpoint 3B — queued LP exits before the next epoch

Prepared 2 October 2026. Starting revision: user-created commit `3518355`.
Status: committed by the user as `eee2aeb`; clean tree inspected before checkpoint 4A.
The user creates every commit. No deployment or live transaction is included.

## Exit authorization and processing

Owners call `requestExit(positionId, liquidity)` to reserve a positive amount
of their position. Requests are **irrevocable**, have no arbitrary output minimum
or receiver, and do not alter the underlying liquidity, price, tick, or current
batch membership. There is at most one pending request per funded position,
so the pool's 32-position limit also bounds its queue to 32 entries. Requests
are allowed during a batch or while Idle; an Idle request can be processed
immediately. An outsider cannot request someone else's withdrawal.

After complete settlement, explicit timeout expiry, or authenticated fee
invalidation, anyone can call `processExit(positionId)`. It processes one
record, removes the reserved liquidity, and credits the unchanged beneficial
owner with actual returned principal and all core fees harvested by that
operation. It mints PoolManager ERC6909 backing and calls no token or recipient.
The caller receives no credit and cannot supply a destination or minimum.
The owner subsequently claims each currency independently to their chosen
recipient, in chunks if needed.

Processing can select any queued ID; a failed entry does not force every other
entry to fail in the same transaction. Queue deletion is constant-work swap/pop,
not a shifting array. A reverting manager call restores the request, position,
queue, credits, and lock. Empty positions free participation slots while retaining
their original owner and ID. Partial exits retain the owner's remaining position.

An Idle owner can directly remove unreserved liquidity with ordinary slippage
bounds and collect fees. Direct removal cannot spend reserved liquidity.
Position creation/increases wait for the queue to empty. Claims remain available.

## Admission and economic freeze

Opening a **new epoch** is blocked while the pool has queued exits. This applies
to both the initial epoch and a subsequent terminal-epoch rollover. It cannot
be bypassed by supplying another signer/nonce, pausing/unpausing admission,
or leaving trader refund/claim balances outstanding.

An exit request cannot truncate the current collection window or veto the
current batch's swap. The order book uses the full opening guard only when
opening an epoch; it uses the existing supported-pool guard when appending to
an already collecting epoch. The hook's swap guard deliberately ignores the
exit barrier. Requests affect only future capital removal, not the current
pricing liquidity. Settlement and all claim funding must complete before exit
processing is allowed. The book's callback lock also preserves this freeze.

This provides exit priority against repeated trader-created epochs. It does
not promise transaction inclusion, automated processing, or a wall-clock exit
without anyone submitting transactions. Owners can request further withdrawals
from remaining liquidity after a previous request is processed. The queue limits
pending work, not the lifetime number of requests. An application/keeper must
present the distinction between waiting, processing, and claiming assets.

## Donation accrual and withdrawal-domain fixes

Inspection of the pinned `Pool.modifyLiquidity` found an additional exit hazard:
it converts accrued fees with `toInt128()`. Unbounded external donations can
make that conversion revert before any LP can collect or withdraw. The regression
explicitly bypasses the new guard in a local test, reproduces the failure with
three individually core-representable donations, then restores normal operation
and requires the current hook to reject them and permit an exit.

The hook now carries **BEFORE_DONATE** in addition to before-swap/add/remove.
All deployment and test mining flags are updated. It limits aggregate
uncollected donations per pool/currency to `2^120 - 1`:

```text
uncollected = cumulative accepted donations - cumulative core fee credits harvested
```

The vault records **fees only** from the authenticated core modification result.
Harvesting into manager-backed claims releases capacity even if token delivery
has not occurred. Principal never releases capacity; old claims cannot be counted
as a second harvest. Donation/fee counters roll back with failed transactions.
Rounding dust stays in the aggregate, so it is not assigned arbitrarily to a new LP.
Capacity is bounded rather than a lifetime donation ceiling; valid collection
permits more donations. The zero-LP-fee policy is necessary to this accounting.
Any future nonzero-fee support must revise it, not reuse this relation unchanged.

A donation exceeding capacity rejects atomically. The legacy settlement also
uses donations for delayed surplus, so an attempted donation above remaining
capacity can cause that settlement to revert; stored timeout refunds and LP
exits remain available. This guard does not fix historical surplus eligibility.

The legacy swap can also finish outside the price domain checked at admission.
A real-core regression starts near the upper supported price, trades a valid
uint96 budget, and obtains principal above the ordinary `2^120 - 1` operation
cap. The vault now preserves every withdrawal credit representable by core
instead of applying a deposit cap to it. Deposit principal and individual
claim delivery retain their limits; large credits can be claimed in chunks.
This avoids a new admission barrier being held hostage by a representable
withdrawal. Exact quote/price/capacity enforcement is still step 4.

## API and deployment impact

| API | Behavior |
|---|---|
| `requestExit(id, liquidity)` | Owner-only, irrevocable positive reservation; one pending request per funded position |
| `queuedLiquidity(id)` | The reserved amount, zero after successful processing |
| `queuedExitIds(poolId)` | At most 32 IDs; order is not stable after processing |
| `pendingExitCount(poolId)` | Remaining entries, independent of outstanding claim delivery |
| `processExit(id)` | Permissionless per-entry removal after economic completion; returns credited currency0/currency1 amounts including harvested fees |
| `ExitRequested` / `ExitProcessed` | Position, pool, owner, reserved amount; processed event includes actual credited amounts |
| `assertAdmissionSupported(poolId)` | Supported pool state plus empty exit queue; used for opening an epoch |
| `assertBatchSupported(poolId)` | Supported pool state without exit priority; used for current collection and swaps |
| `totalDonated0/1(poolId)` | Hook's cumulative accepted donation amounts |
| `totalFeesCollected0/1(poolId)` | Vault's cumulative actual fee-only credits harvested from core |
| `MAX_UNCOLLECTED_DONATIONS()` | Hook's per-pool/currency aggregate accrual cap |

The extra hook address permission requires newly mined deployment addresses.
This checkout does not upgrade the existing Sepolia contracts, dashboard, or
wallet. The deployment script compiles with all four permissions. Trader
signature schema/domain remains the v2 schema introduced in 3A, with a new
order-book address for a new deployment.

## Validation

Validation completed with Forge 1.5.1 and the pinned local dependencies:

- `forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness' -vv`: **199 passed, 0 failed, 20 suites**, including 12 fuzz tests with at least 512 runs each.
- After a second formatter pass corrected formatting in the new exit test file, its **14 tests passed again**.
- `forge build --offline --sizes`: passed, including the deployment script and benchmark fixtures. Existing lint/style suggestions are not audit clearance.
- `forge fmt --check` on all changed/new Solidity files and `git diff --check`: passed.

Optimized runtime/init bytecode sizes in bytes:

| Contract | Runtime | Init |
|---|---:|---:|
| OtterHook | 3,231 | 15,732 |
| OtterLiquidityVault | 11,688 | 12,023 |
| OtterOrderBook | 14,758 | 15,290 |
| OtterSettlement | 11,233 | 11,752 |

The new tests cover:

- Owner authorization, zero/excess/repeated reservations, unchanged pricing
  liquidity, and no early fee invalidation solely because an exit is queued.
- New-epoch priority, continued current collection, nonce/escrow rollback on
  rejected admission, settlement with a real swap, and core-calculated principal
  at its resulting state.
- Executing-state freeze, paused admission, unsupported protocol fees, old
  trader refunds after LP processing/new admission, and independent pools.
- Reserved versus immediate withdrawals, retained IDs, partial/full positions,
  concentrated/one-sided custody, and re-requesting remaining owned liquidity.
- Blocked ERC20 balance queries/transfers, rejecting native recipients,
  recipient reentrancy, isolated other-currency claims, and manager-backed totals.
- Reverting manager modifications with complete rollback and processing another
  queued entry independently.
- Fuzzed queue sizes 1–32 and arbitrary processing permutations, with cold calls
  bounded to 500,000 gas each and owner/backing/queue conservation checks.
- Core fee-overflow prevention, donation accounting rollback, capacity restored
  by fee harvesting, and principal excluded from that accounting.
- Withdrawal after a real legacy swap crosses the supported deposit-price bound.

Resource measurements use the pinned core, Cancun, Solidity 0.8.26,
via-IR/optimizer 200, and explicit cold book/vault/manager/hook storage. The
maximum-queue fixture processes 32 owners' full-range positions separately,
including removing the last position/tick endpoints. Each call has a 500k
budget. The maximum measured execution cost across those 32 calls was
**285,182 gas**. Reported execution includes external-call harness overhead and excludes
transaction intrinsic costs/refunds; it is a scoped regression, not a target-chain
worst-case guarantee for every concentrated tick topology.

Routine validation excludes the saved gas-curve/sandwich generators because
running them rewrites published results. Their updated hook flags compile;
existing saved benchmarks remain historical. No solver/web changes are in this
checkpoint, and their existing economics/client limitations remain documented.

## Remaining grant-readiness work

Step 3's local recovery/exit acceptance is complete after validation. It is
not an independent audit, economic proof, deployment, or grant-ready system.
R2 (noncanonical solver outcomes), R6 (minority dust IR), and R7 (historical
surplus capture) still have active unsafe-behavior reproductions. Queued exits
credit principal and fees already accrued in core; they do not yet reserve an
exiting owner's entitlement to unflushed historical Otter surplus.

Next, step 4 must implement exact tick-aware quotes, matched integer domains,
and resolve or qualify G1–G3 before canonical settlement/concentrated execution
is claimed. Historical rewards, wallet/keeper flows, comparative economics,
and independent Solidity/mechanism reviews remain necessary. Concentrated
positions can exit now; their batch execution remains blocked.

## User-created commit handoff

Suggested title: `fix: prioritize queued LP exits and bound donation accrual`

Suggested explanation:

> Reserve owner-authorized LP exits and process each into backed claims before
> the next epoch opens. Preserve current collection and settlement, isolate exits
> from token delivery, bound uncollected donations, and retain all core-representable
> withdrawal credits. Add real-core, callback, failure, and resource regressions.

Include these 22 changed/new files:

```text
README.md
contracts/script/Deploy.s.sol
contracts/src/OtterHook.sol
contracts/src/OtterLiquidityVault.sol
contracts/src/OtterOrderBook.sol
contracts/src/interfaces/IOtterLiquidityGuard.sol
contracts/test/GasCurve.t.sol
contracts/test/OtterDonationBounds.t.sol
contracts/test/OtterExits.t.sol
contracts/test/OtterHook.t.sol
contracts/test/OtterLiquidityVault.t.sol
contracts/test/OtterMargin.t.sol
contracts/test/OtterSettlement.t.sol
contracts/test/OtterSettlementSellX.t.sol
contracts/test/OtterSurplusToLPs.t.sol
contracts/test/SandwichHarness.t.sol
contracts/test/SolverEndToEnd.t.sol
contracts/test/utils/MockLiquidityGuard.sol
contracts/test/utils/OtterHookFixture.sol
reviews/CHECKPOINT_3B.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
```

Stop at this handoff and begin step 4 only after the user confirms the commit.
