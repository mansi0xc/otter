# Otter v2 implementation specification

Prepared 2 October 2026. Baseline: user-created commit `63ec94e`.
Sources: [grant readiness review](./GRANT_READINESS_REVIEW_2026-10-02.md), [remediation plan](./REMEDIATION_PLAN.md), the pinned v4 core, and [the paper](https://arxiv.org/html/2609.03474v1).

**Status: implementation contract for the remediation; no production fixes have landed at this checkpoint.** Safety and integration decisions below are selected. The discrete mechanism and its incentive guarantees have explicit research gates in section 7. Those gates must be resolved with evidence before canonical settlement is implemented or advertised as proven.

The user has selected **native ETH and concentrated liquidity support now**. These belong to this remediation, including contracts, the integer solver, recovery, deployment, and wallet flows. Supporting WETH alone or removing the full-range check alone does not meet this scope.

## 1. Scope, trust, and dependency decisions

1. Use a dedicated authenticated LP vault compatible with the currently pinned core. Each position has a unique, non-reused ID, an owner, pool, ticks, salt, and liquidity balance. Position receipts initially remain nontransferable; delegated withdrawal and collection require explicit owner authorization. Different ranges must not be represented by interchangeable liquidity shares.
2. Replace batch-wide recipient transfers with individual claims. Store admitted order records so recovery does not require a solver's full order array or an indexer's reconstruction of internal-call calldata.
3. Settlement correctness is independent of caller identity. Remove solver exclusivity in v2. A keeper may propose or compute an outcome; the contract accepts only the prescribed outcome. A keeper reward, if needed, requires a separately specified funding source and cannot be deducted arbitrarily from traders.
4. Maintain zero LP swap fees. Support pools with zero protocol swap fees initially, checking the actual slot0 fee fields. A protocol-fee change invalidates that batch's execution configuration and permits recovery; it must never trap escrow. Modeling nonzero execution fees is a subsequent mechanism change, not implicit in this version.
5. Native ETH is v4's zero-address currency, distinct from WETH. Registration uses an explicit `registered` flag; currency0 cannot also serve as an unregistered sentinel.
6. A bounded research prototype is the initial target. Mainnet use requires the numerical gates, measured resource bounds, economic evidence, and independent Solidity and mechanism reviews. No exact DSIC, sybil resistance, censorship resistance, or best-price guarantee is established by this specification alone.

The pinned core is `e50237c43811bd9b526eff40f26772152a42daba` (`v4.0.0`). The inspected [periphery PositionManager revision](https://github.com/Uniswap/v4-periphery/blob/dce236d4e2057422d0791d9a973a58765eb46f65/src/PositionManager.sol) imports `types/PoolOperation.sol`, while this core defines the operation structs in [IPoolManager](../contracts/lib/v4-core/src/interfaces/IPoolManager.sol) and has no such file. Do not silently combine these revisions or upgrade core while fixing custody. The dedicated vault adds audit surface; using core's math and accounting does not make the vault independently audited.

Deploy v2 with a new order-signature domain/version and an explicit manifest. Existing contracts are not upgraded by editing this checkout. Do not present the current test-router deployment as remediated.

## 2. Asset semantics and numerical domain

### Assets and custody

- Register sorted, distinct currencies. At most currency0 can be native ETH. Nonzero currencies must contain contract code and meet the declared ERC20 support policy.
- Support standard balance-conserving ERC20s with either a true return value or no return data. Compare the custodian's balance before and after every escrow deposit; credit exactly the signed budget only if the increase matches it.
- Exclude transfer-tax, rebasing, and arbitrary callback accounting semantics. A registration check cannot prove immutable behavior. If an otherwise supported token later blocks a recipient, their delivery may fail, but finalization and unrelated claims must remain possible. A token blocking Otter or PoolManager can still prevent delivery of that currency; do not claim otherwise.
- For a payable submission, `msg.value` must equal the sum of native budgets in that call. Reject excess or missing value. A relayer can fund a trader's signed native order; the claim belongs to the signed trader, not the payer. ETH orders have no ERC20 approval step.
- Forced ETH or unsolicited ERC20 transfers create no order, ownership, or claim. They cannot be swept from amounts reserved for escrow or claims.
- Use PoolManager's ERC6909 currency claims to hold positive swap/withdrawal deltas where needed. Minting a credit avoids a recipient transfer during batch or exit finalization. Burning that credit and transferring the underlying asset happens during the owner's isolated claim. Never burn another account's credits through an unrestricted allowance or operator permission.

For each currency and custodian, the accounting invariant is:

`cash/native balance + owned PoolManager credits >= unsettled escrow + finalized claims + reserved LP rewards`.

Track liabilities across all pools using that currency. Classify movements between cash and credits as backing changes, not new revenue. Assign each liability once; principal, refund, output, and reward labels must not count the same asset twice. Inside an unlock, reconcile temporary deltas separately; the persisted invariant applies at transaction boundaries. Every unlock must end with all PoolManager deltas settled.

### Proposed engineering limits

These are conservative starting limits to implement and benchmark, **not measured deployment limits**. Reducing them after measurements is acceptable; increasing them requires new worst-case evidence. All are part of a versioned pool configuration and immutable for an outstanding batch.

| Quantity | Initial limit/rule | Purpose |
|---|---|---|
| Orders per batch | 32 | Bound outcome verification and state updates |
| Open vault position records per pool | 32 | Bound snapshots, tick endpoints, and exit work; explicitly limits prototype participation |
| Individual budget | Positive `uint96` | Reject zero budgets and prevent unconstrained amount products |
| Sum of admitted budgets per currency per batch | At most `2^96 - 1` | Bound aggregate input, independent of order count |
| Ask | `uint128`, scaled by `10^18` in raw output/raw input units | Bound representation; an unfillable high ask is ineligible, not a batch poison |
| Sum of all position liquidity in a pool | At most `2^88 - 1`, including inactive ranges | Bound liquidity and signed crossing arithmetic |
| Executable sqrt price | `2^64 <= sqrtPriceX96 < 2^128`, also strictly inside core's legal swap limits | Give an explicit supported raw price interval, including ordinary 6/18 decimal pairs |
| Bitmap words visited by a swap trace | At most 16; count empty words too | Bound traversal, including liquidity gaps |
| Currency amount credited/debited in a successful operation | At most `2^120 - 1` and representable by the relevant core signed delta | Keep transfers, payouts, and casts within a checked domain |
| Signature byte length | Bounded at admission; initial cap 512 bytes | Bound smart-wallet validation input |

Do not cast first and validate later. Check aggregate amounts, quote outputs, netting, reward weights, and manager deltas before narrowing. A pool outside the price/liquidity domain cannot open a batch. Configured price limits constrain execution; full-range positions may extend beyond those execution limits. The exact quote defines the available capacity before a price or traversal limit. Amounts above that capacity are not assumed consumed.

Use the pinned core's full-precision arithmetic where appropriate. FullMath handles a 512-bit product but can still reject a zero denominator or an unrepresentable quotient. Eligibility comparisons must classify mathematically unfillable asks without evaluating an overflowing quotient. The BigInt implementation must enforce the same accepted domain, casts, and failure behavior as Solidity.

Decimals are display metadata. `ask = minimum raw output per raw input * 10^18`; signing and UI conversion must account for both token scales. Do not assume equal decimals. The supported domain is narrower than all possible ERC20 amounts/prices, and must be displayed/documented as such.

## 3. Stored orders, epochs, and recovery

### Signed order and admission

The v2 typed order includes trader, pool ID, pool-configuration version, epoch ID, selling direction, ask, budget, admission deadline, maximum execution time, and unordered nonce. The EIP-712 domain includes chain ID, order-book address, and version. Use EOA signature validation and EIP-1271 validation for contract traders at admission. A later signature revocation does not revoke already committed escrow.

Expose a preview of the next/current epoch and its configuration. The first accepted order fixes the epoch's pool snapshot and clock. Initial clock parameters are a 60-second collection interval and a further 300-second execution interval, replacing the current 300-second exclusive solver period. These are prototype parameters to evaluate, not latency claims.

Admission requires all of:

- The signed epoch is current, collecting, and has capacity; the config version matches.
- `block.timestamp < closesAt` and `block.timestamp <= admissionDeadline`.
- The order's maximum execution time is at least the epoch's fixed `executeUntil`. An order with insufficient validity is rejected before escrow, rather than later vetoing a batch.
- The nonce is unused and all asset, amount, and signature checks pass. Record and consume the nonce atomically with escrow.

For a not-yet-open epoch, calculate its fixed clock from the actual admission timestamp; a stale preview may cause rejection rather than extending the trader's signed exposure. Store each admitted order under `(poolId, epochId, index)`, together with its hash. Emit the complete admitted fields and stable index. Keep a digest for outcome binding, but do not require its replay for refunds.

Set the economic lock before the first external escrow call, reverting it if admission fails. Count or token callbacks must not expose a transient state in which the epoch exists but LP changes are allowed.

Unused signatures can be invalidated through nonce bitmap words. Cancellation of a used nonce does not release or alter an outstanding order; its signed epoch follows settlement or timeout rules.

### State transitions

| State | Allowed transition/action | Economic lock |
|---|---|---|
| Idle | Authorized LP changes; open next epoch if no exit barrier | Off |
| Collecting | Admit bounded orders; queue exits; close by time | On |
| Closed | Permissionless valid settlement while `now < executeUntil`; queue exits | On |
| Executing | Transaction-local canonical verification, swap, and claim/reward accounting | On until the complete operation succeeds |
| Settled | Claim outputs/refunds/rewards; process queued exits | Off; queued exits precede new admission |
| Refundable | Claim each stored order's full budget; process queued exits | Off; queued exits precede new admission |

At `now >= executeUntil`, settlement is forbidden and any caller can mark the epoch Refundable in constant work. Expiry performs no token transfers and does not enumerate orders. An unsupported fee configuration may also terminate the epoch into Refundable after an authenticated state check. There is exactly one terminal economic outcome, even at the boundary timestamp.

Every refund is derived from its stored record and terminal epoch state. Every successful settlement records complete filled amounts and output claims, including zero fills and unspent budget claims. Validate the entire result, update accounting atomically, and publish the terminal state only after the swap and reward reservation are complete. A reverting settlement leaves the epoch and its escrow intact.

Claims use checks-effects-interactions with reentrancy guards; a failed transfer rolls back only that claim. Default delivery is to the signed trader/position owner. Another recipient requires that owner's direct call or a separately replay-protected authorization. A third-party keeper may trigger delivery to the fixed owner but cannot redirect it. Claims can be split by currency so a blocked token does not block the owner's other currency. No claim or expiry depends on a working solver, an owner key, or other recipients accepting funds.

Outstanding claims from a terminal epoch do not block a later epoch. Claim IDs, order indices, and position IDs are never reused. Recovery must work after admission is paused.

## 4. Authenticated LP custody and bounded exits

Only the selected vault can add, remove, or collect a position in an Otter pool, including zero-liquidity-delta collection. Only the selected settlement contract can swap. Enforce both gates in the hook using the sender passed by PoolManager. Test calls through arbitrary routers and alternate salts, not just direct calls.

The vault owns the underlying v4 positions; its ledger identifies the beneficial owner of each unique salt. Adding to an existing position, removing liquidity, and collecting require ownership or an explicit bounded delegation. Deposits use explicit liquidity and caller-provided maximum input/slippage bounds; do not use an unprotected balance-derived mint. Currency/native funding must satisfy actual manager deltas. Position IDs remain allocated after exit for historical claims.

Concentrated positions use valid ordered, tick-spacing-aligned bounds and checked aggregate liquidity. Overlapping ranges are allowed. Full-range positions remain supported. The active-liquidity sum and every crossed `liquidityNet` must match the real pool; range endpoints and bitmap contents cannot be supplied unauthenticated by a keeper.

During an outstanding epoch, freeze deposit, withdrawal, ownership changes, and fee collection. Accept a withdrawal request without modifying the pool: the owner reserves a specified amount of their unreserved liquidity, once per open position. No outsider can queue someone else's withdrawal or reserve more than they own.

After settlement or expiry, a permissionless processor removes each queued position's reserved liquidity using bounded per-position work, records the actual returned amounts, and backs the owner's claims with manager credits. It does not push ERC20/ETH to the owner. Claims for prior LP rewards remain separate from principal. Empty positions can free a participation slot without recycling their ID.

New admission is blocked while queued exits remain to process. This establishes a finite opportunity to exit before another attacker-created batch starts. It does **not** promise wall-clock inclusion without anyone submitting the processing transactions. The UI must distinguish waiting for epoch resolution, permissionless exit processing, and delivery of assets. A recovery/keeper service must demonstrate all three.

Queued exits execute at the epoch boundary's resulting state. The withdrawal request is authorization to remove that liquidity at that state; an owner-supplied impossible output minimum must not veto every other exit or next-epoch admission. Immediate withdrawals while Idle can use ordinary transaction slippage bounds. Pause-admission powers cannot pause claims or authenticated exit processing.

## 5. Tick-aware pool model and actual settlement

### Snapshot and quote

At epoch opening, record the pool key/configuration, sqrt price, tick, active liquidity, zero fee fields, and the vault's position schedule/ownership version. Authenticate the bounded tick/bitmap state from PoolManager. LP mutations and swaps remain gated throughout the outstanding epoch, so its pricing state cannot drift through another router. Direct donations may change fee-growth accounting; they are not Otter batch surplus and cannot change the pricing model or create vault ownership.

Implement a read-only quote matching the pinned [Pool.swap source](../contracts/lib/v4-core/src/libraries/Pool.sol) using core `SwapMath`, `SqrtPriceMath`, `TickMath`, and bitmap traversal. The trace must reproduce:

- Both directions and exact-input negative `amountSpecified` semantics.
- Initialized ticks, signed liquidity changes, and empty bitmap-word boundaries.
- The core's price movement through zero-liquidity gaps; do not invent output while no liquidity is active.
- Per-step input/output rounding, price limits, partial consumption, final price/tick/liquidity, and all applicable fee checks.
- The configured traversal/capacity bounds without assuming a constant-product reserve pair remains valid after a tick crossing.

A sorted list of initialized ticks alone is insufficient for exactness: the actual pool also traverses uninitialized word boundaries, whose step rounding must be reproduced. Global virtual reserves derived from current active liquidity do not describe the entire concentrated pool.

The quote returns requested input, actual consumed input, output, final state, and traversal usage. Outside the supported domain it returns a specified unsupported result rather than an arbitrary arithmetic panic. This exact execution oracle is separate from the discrete auction optimizer. A correct quote does not establish the auction's incentive theorem.

### Execution and accounting

Verify the complete stored batch, canonical direction/allocation/payments, snapshot, capacity, and claim amounts before executing. No keeper-controlled payment interval or alternative feasible vector is accepted. Re-read execution-critical pool state and fee fields before the actual swap. A mismatch produces no economic completion and retains timeout recovery.

Net the accepted opposing fills using the mechanism's prescribed integer rules. Pay and account using actual `BalanceDelta` input/output, including any unconsumed input. Check the executed trace/result against the expected quote; a mismatch reverts the complete settlement. Never debit traders for a requested input that the pool did not consume. Do not route unexplained shortfall into their minimum payments or recovery balances.

For native debt, explicitly `sync(nativeCurrency)` before `settle{value: owed}()`, following the [pinned manager's recommendation](../contracts/lib/v4-core/src/PoolManager.sol). For ERC20 debt, sync that currency, transfer the checked debt, and settle. Clear every transient delta; reserve native cash for other orders/claims. Positive deltas can be minted as credits to the correct custodian and assigned to individual claims without recipient calls.

Use settlement and custody reentrancy guards plus authenticated unlock callbacks. A callback must match an in-flight operation, authorized manager, pool, and purpose. Keep the economic lock through accounting, not merely until an early `consume` sets a boolean. Test callbacks attempting same-pool and cross-pool operations.

## 6. Historical rewards and LP policy

Do not donate Otter's residual batch assets to whoever is LP at a later `flushSurplus` call. Record the eligible owners and weights at epoch opening and credit the terminal residual to those identities. New deposits after settlement have no claim on that epoch. Exiting owners retain their claims. There is no unrestricted flush path.

For this expanded prototype, choose an explicit **capital-weighted policy**, not raw liquidity units across different ranges:

1. Compute each position's underlying principal amounts at the opening sqrt price with core amount math, excluding already accrued rewards/fees and queued-out liquidity only after it has actually been removed.
2. Value that principal in currency1 raw units at the opening spot: `weight = principal1 + floor(principal0 * sqrtPriceX96^2 / 2^192)`, using full precision and checked representation. Weights are independent of the subsequent reported asks/fills. A position whose value rounds to zero has no surplus weight, while keeping its principal ownership.
3. Snapshot the eligible position owner and weight. Divide each residual currency pot by these frozen weights, rounding individual entitlements down. Track the exact remainder separately as an epoch rounding reserve; no solver or new LP receives it. A fixed community destination for that dust must be declared in pool configuration, with no ability to spend backing for other liabilities.
4. Allocate rewards with bounded work and store independent claims, backed by cash or manager credits. Do not wait for the owner to claim before completing the epoch.

Zero active liquidity at opening is unsupported. Reject opening before escrow if there is no eligible positive weight. Under this policy, inactive ranges with capital also receive weight; raw liquidity alone is inappropriate because range width changes the capital backing it. This is a selected prototype distribution policy, **not a proof of risk-fair LP compensation or an inheritance of the paper's incentive result**. Evaluate out-of-range capital, narrow ranges, bidder-as-LP, first-order timing, and repeated epochs. An LP arriving before the snapshot remains eligible; this specification fixes post-trade historical capture, not every possible pre-batch JIT strategy.

External donations and ordinary position fee growth must be accounted separately. Their collection requires vault ownership and cannot reassign a prior Otter reward. The reward policy is versioned; changes affect future epochs only and require new mechanism/economic analysis.

## 7. Discrete mechanism: required contract and unresolved gates

The current solver's clamp, marginal bounds, and constant-product `F` are not the v2 canonical mechanism. Preserve them as historical/research references, not production correctness checks. Do not replace an empty payment interval with a below-minimum output or silently omit a stored order.

The mechanism must be a versioned deterministic function of the complete admitted batch, authenticated pool snapshot, exact execution oracle, and declared policy. It produces direction, integer fills, both sides' outputs, unspent budgets, actual AMM consumption, residual assets, and a unique outcome commitment. A caller provides no additional economic discretion.

Minimum enforceable postconditions are:

- For **every** order on either side, `0 <= spent <= budget`; if `spent > 0`, `output >= ceil(ask * spent / 10^18)`. An unfilled order spends zero and retains its full refund claim.
- All amounts are raw nonnegative integers in the declared domain. No unexplained negative pot, unavailable output, or unsafe signed conversion is permitted.
- Every admitted record appears exactly once in the result. Unfilled/ineligible records are represented explicitly.
- Input conservation uses actual consumption and opposing transfers; output, unspent input, rewards, and dust exhaust the assets available to the epoch without using another epoch's backing.
- Equal economic solutions use a declared total ordering. Initial tie key: `(ask, hash(v2 signed order fields))`, independent of submission index. Hash ties do not establish sybil resistance: traders can choose nonces/identities and grind order hashes. Test and disclose that limit.
- Direction selection, allocation, payment rounding, and every leave-one-out/counterfactual calculation follow the **same published function** on chain and in the reference implementation. Fallback callers follow identical rules.

Three gates remain. These are technical acceptance gates, not requests for another user permission.

**G1 — Complete the discrete allocation/payment definition.** Derive a rule with a nonempty integer payment interval, both-side IR, deterministic side selection/ties, and an explicit treatment of dust and finite capacity. State the objective in common units and define leave-one-out outcomes, rounding order, and zero allocation. Use independent exhaustive rational/integer optimization on small domains to find counterexamples before selecting the scalable implementation. Define any deviation from continuous pivot payments and quantify an incentive error only if supported. Postconditions alone are not an algorithm or a truthfulness proof.

**G2 — Establish the concentrated-liquidity mechanism's domain.** The paper assumes an increasing concave continuous curve with an unbounded nonnegative input domain and stated inverse/differentiability behavior. A real tick-aware integer pool has finite usable capacity, zero-liquidity gaps, staircase output, and price limits. Document which assumptions hold on each supported domain and prove or qualify the extended rule. Matching v4's execution is necessary but insufficient. Do not carry over a full-range theorem merely because a within-tick segment is constant-product.

**G3 — Choose enforceable verification within measured resources.** Begin by benchmarking direct recomputation on bounded batches and traces, including counterfactuals. If it cannot fit, lower measured limits or specify a complete authenticated witness/proof design. The witness must bind G1's full computation and G2's real curve, not just feasibility or welfare. Do not introduce a TEE, bond, or optimistic dispute period and call it equivalent to immediate trustless verification. Any changed trust/delivery model requires a revised specification and disclosed funding scope.

Custody, independent recovery, and the exact quote can proceed while these gates are researched. Step 5 cannot be considered complete until G1–G3 have an implementation-ready rule and acceptance evidence. If the extension fails a claimed incentive property, report that result and adjust the claim; do not hide it with more randomized passing tests.

## 8. Regression ownership and acceptance evidence

Each original unsafe-behavior reproduction stays in Git history. When its fix lands, change the active regression to assert rejection/prevention or corrected accounting. A passing exploit reproduction is not a closed finding.

| Finding/scope | Owning component(s) | Required regression/acceptance |
|---|---|---|
| R1: test-router theft/collection | Vault, hook, deployment | Outsider cannot remove/collect or select another salt; owner can exit/claim; deployment seeds only through authenticated vault |
| R2: arbitrary allocation/payment and zero-fill griefing | Mechanism, settlement, solver | Reject underpaying feasible vectors and noncanonical zero fills; accept only the complete prescribed output; caller/LP overlap grants no discretion |
| R3: oversized batch/recovery | Order book, configuration | Reject order 33 and aggregate-budget overflow; constant-work expiry at maximum size; one-record recovery without full replay |
| R4: recipient veto/asset semantics | Custody and claim paths | False/optional returns, taxes, token blocklist, rejecting native receiver; unrelated claims and economic completion remain independent; double claim fails |
| R5: extreme ask/overflow mismatch | Admission, math, BigInt reference | Reject out-of-domain asks before escrow; classify accepted unfillable asks safely; boundaries/denominator/casts agree across implementations |
| R6: dust IR, empty intervals, arrival ties | G1, mechanism, reference tests | Both-side integer IR at dust scale; independent small-domain optimizer; permutations preserve per-record results under declared ties; grinding limits measured |
| R7: historical reward capture | Vault snapshots, reward ledger | Post-settlement deposit gets none of old pot; exit retains old reward; same-transaction claim cannot bypass snapshot; repeated-epoch accounting conserves assets |
| R8: execution after deadline | Order schema, state machine, UI | Exact close/expiry boundaries; settlement forbidden at/after `executeUntil`; no settlement/refund race or individual expiry veto; stale signatures cannot join another epoch |
| R9: fee and actual-input mismatch | Pool registration, quote, settlement | Changed protocol fee yields independent recovery; price-limit partial fill credits actual unspent input; no unchecked signed deltas |
| Exit starvation | Vault queue, admission gate | Queue during batch; settle or expire; process without recipient transfer; next order cannot front-run the exit barrier |
| Callback/state risks | Hook, all custodians, settlement | Stateful same-pool/cross-pool callbacks cannot bypass freeze, claim twice, spend another pool's backing, or leave unlock deltas unsettled |
| Native ETH | Book, vault, settlement, UI | Correct zero currency registration, mixed ETH/ERC20 submit, exact value, native sync/settle, reverting receiver, unauthorized redirection, forced ETH, ETH versus WETH |
| Concentrated liquidity | Vault, hook, quote, G2 | Overlapping/disjoint ranges; both crossing directions; tick/word boundaries; zero-L gaps; capacity/price limits; unequal decimals; exact real-PoolManager differential execution |
| Data availability/nonces/wallets | Book, indexer, wallet | Stored independent claims after relayed submission/reorg; EIP-1271; used and unused nonce words; receipts, failed txs, account/chain changes, correct epoch display |
| Production/grant evidence | Deployment, operations, benchmark docs | Pinned artifacts and bytecode/config manifest; real testnet solving/recovery/exit demonstration; complete costs and revised limited claims |

Contract invariants must cover many users, pools sharing currencies, failed claims, repeated epochs, and LP entry/exit. Quote differential tests must compare actual consumed input/output and final pool state; comparing two copies of the same shortcut is insufficient. Measure first admission with its LP snapshot, worst-case settlement/counterfactual work, cold claims, native/ERC20 paths, and exits separately. Include transaction/calldata costs and specify the target chain/transaction budget when setting deployable caps.

## 9. Checkpoint and next implementation

Checkpoint 1 delivers this specification and the expanded remediation plan. Verification at this checkpoint is source/dependency inspection and documentation/traceability checks; contract tests have not been rerun because production source is unchanged. All findings remain open until their regression and implementation acceptance evidence pass.

After the user's checkpoint 1 commit, begin step 2 with the authenticated range-position vault, hook authorization, native/optional-return escrow semantics, and deployment integration. Preserve existing user changes. Split that work into smaller user-created commit checkpoints if necessary. Do not start settlement payment changes by patching a clamp before G1–G3 are resolved.
