# Otter v2 implementation specification

Prepared 2 October 2026. Baseline: user-created commit `63ec94e`.
Sources: [grant readiness review](./GRANT_READINESS_REVIEW_2026-10-02.md), [remediation plan](./REMEDIATION_PLAN.md), the pinned v4 core, and [the paper](https://arxiv.org/html/2609.03474v1).

**Status: target implementation contract. Checkpoints [2A](./CHECKPOINT_2A.md) and [2B](./CHECKPOINT_2B.md) implement custody and asset handling; [3A](./CHECKPOINT_3A.md) implements bounded epochs and independent recovery locally. [3B](./CHECKPOINT_3B.md) implements queued exit priority and bounded donation accrual. [4A](./CHECKPOINT_4A.md) adds a bounded read-only exact execution quote; [4B](./CHECKPOINT_4B.md) adds an independent BigInt execution reference with matched domains and real-core comparisons. [4C](./CHECKPOINT_4C.md) records and revalidates opening pool state and LP ownership for the admitted full-range model. [4D](./CHECKPOINT_4D.md) adds bounded one-sided discrete allocation/payment research and counterexamples. [4E](./CHECKPOINT_4E.md) adds two-sided exact-lot candidate calculations and net-flow testing. [4F](./CHECKPOINT_4F.md) diagnoses compensation precision, fractional redemption/backing and actual-input gaps. [4G](./CHECKPOINT_4G.md) investigates exact integer cost grids, a finite one-sided argument and post-swap lot limits. [4H](./CHECKPOINT_4H.md) checks exact truthful whole-payment constraints and changed partial-fill limits. [6A](./CHECKPOINT_6A.md) implements funded historical rewards for admitted full-range pools. The research checkpoints select no auction mechanism. Concentrated snapshot/reward integration, canonical settlement, and the discrete mechanism remain pending.** Safety and integration decisions below are selected. The discrete mechanism and its incentive guarantees have explicit research gates in section 7. Those gates must be resolved with evidence before canonical settlement is implemented or advertised as proven.

The user has selected **native ETH and concentrated liquidity support now**. These belong to this remediation, including contracts, the integer solver, recovery, deployment, and wallet flows. Supporting WETH alone or removing the full-range check alone does not meet this scope.

On 4 October the user selected **preserve the paper's guarantees; keep testing
before selecting a rule**. A funded mechanism with weaker incentives is not
the default implementation. Trade sizes and payment/asset representation may
be researched, but a different valuation/redemption contract cannot silently
replace the current per-order whole-token IR requirement.

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
- Support standard balance-conserving ERC20s with either a true return value or no return data. Compare both sender debit and custodian receipt before and after every escrow deposit; credit exactly the signed budget only if both match it. Also check ERC20 debits/receipts at custodian withdrawals and PoolManager payments/takes. Native receivers may spend ETH within their receive function, so successful value delivery is the native withdrawal condition.
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
| Bitmap words visited by a swap trace | At most 16 distinct words; count empty words too | Bound traversal, including liquidity gaps |
| Initialized tick crossings / total swap steps | At most 64 crossings and 80 steps; an unfinished trace at a cap is unsupported | Bound endpoints for 32 positions and per-word rounding work |
| Quote exact input | At most `2^96 - 1`, including zero as a model no-op | Match the admitted aggregate budget domain without narrowing first |
| Deposit principal, quote output, or individual claim delivery | At most `2^120 - 1` and representable by the relevant core signed delta; withdrawal principal/fee credits retain all core-representable amounts and can be claimed in chunks | Keep transfers and casts bounded without letting external donations or accumulated claims veto exits |
| Signature byte length | Bounded at admission; initial cap 512 bytes | Bound smart-wallet validation input |
| Uncollected donations per pool/currency | At most `2^120 - 1`; cumulative donations minus fee-only credits harvested from core | Prevent accrued fees from overflowing core deltas while allowing capacity after collection |

Do not cast first and validate later. Check aggregate amounts, quote outputs, netting, reward weights, and manager deltas before narrowing. A pool outside the price/liquidity domain cannot open a batch. Configured price limits constrain execution; full-range positions may extend beyond those execution limits. The exact quote defines the available capacity before a price or traversal limit. Amounts above that capacity are not assumed consumed.

Use the pinned core's full-precision arithmetic where appropriate. FullMath handles a 512-bit product but can still reject a zero denominator or an unrepresentable quotient. Eligibility comparisons must classify mathematically unfillable asks without evaluating an overflowing quotient. The BigInt implementation must enforce the same accepted domain, casts, and failure behavior as Solidity.

Decimals are display metadata. `ask = minimum raw output per raw input * 10^18`; signing and UI conversion must account for both token scales. Do not assume equal decimals. The supported domain is narrower than all possible ERC20 amounts/prices, and must be displayed/documented as such.

## 3. Stored orders, epochs, and recovery

### Signed order and admission

The v2 typed order includes trader, pool ID, pool-configuration version, epoch ID, selling direction, ask, budget, admission deadline, maximum execution time, and unordered nonce. The EIP-712 domain includes chain ID, order-book address, and version. Use EOA signature validation and EIP-1271 validation for contract traders at admission. A later signature revocation does not revoke already committed escrow.

Expose a preview of the next/current epoch and its configuration. The first accepted order fixes the epoch's pool snapshot and clock. Initial clock parameters are a 60-second collection interval and a further 300-second execution interval. These are prototype parameters to evaluate, not latency claims. Checkpoint 3A uses those deployment defaults and temporarily retains the legacy feasible-outcome solver with a 60-second exclusive period; its constructor requires exclusivity to end strictly before expiry. Step 5 removes exclusivity together with enforcing canonical results.

Admission requires all of:

- The signed epoch is current, collecting, and has capacity; the config version matches.
- `block.timestamp < closesAt` and `block.timestamp <= admissionDeadline`.
- The order's maximum execution time is at least the epoch's fixed `executeUntil`. An order with insufficient validity is rejected before escrow, rather than later vetoing a batch.
- The nonce is unused and all asset, amount, and signature checks pass. Record and consume the nonce atomically with escrow.

For a not-yet-open epoch, calculate its fixed clock from the actual admission timestamp; a stale preview may cause rejection rather than extending the trader's signed exposure. Store each admitted order under `(poolId, epochId, index)`; expose its reconstructable hash and emit that hash. Emit the complete admitted fields and stable index. Keep a digest for outcome binding, but do not require its replay for refunds.

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

During an outstanding epoch, freeze deposit, withdrawal, ownership changes, and fee collection. Accept a withdrawal request without modifying the pool: the owner reserves a specified amount of their unreserved liquidity, with at most one pending request per funded position. No outsider can queue someone else's withdrawal or reserve more than they own. Requests are irrevocable authorizations; they are also allowed while Idle and can then be processed immediately. An Idle owner can still directly withdraw unreserved liquidity using ordinary slippage bounds.

After settlement or expiry, a permissionless processor removes each queued position's reserved liquidity using bounded per-position work, records the actual returned amounts, and backs the owner's claims with manager credits. It does not push ERC20/ETH to the owner. Claims for prior LP rewards remain separate from principal. Empty positions can free a participation slot without recycling their ID.

Opening the next epoch and adding LP capital are blocked while queued exits remain to process. Appending orders during the current collection window and settling that epoch remain allowed; an LP exit request cannot truncate the current auction. This establishes a finite opportunity to exit before another attacker-created batch starts. It does **not** promise wall-clock inclusion without anyone submitting the processing transactions. The UI must distinguish waiting for epoch resolution, permissionless exit processing, and delivery of assets. A recovery/keeper service must demonstrate all three.

Queued exits execute at the idle pool state after economic completion. Exits can be processed in any order; removal preserves pricing state for the other positions. The withdrawal request is authorization to remove that liquidity at that state; an owner-supplied impossible output minimum must not veto every other exit or next-epoch admission. Immediate withdrawals while Idle can use ordinary transaction slippage bounds. Pause-admission powers cannot pause claims or authenticated exit processing.

## 5. Tick-aware pool model and actual settlement

### Snapshot and quote

At epoch opening, record the pool key/configuration, sqrt price, tick, active liquidity, zero fee fields, and the vault's position schedule/ownership version. Authenticate the bounded tick/bitmap state from PoolManager. LP mutations and swaps remain gated throughout the outstanding epoch, so its pricing state cannot drift through another router. Direct donations may change fee-growth accounting; they are not Otter batch surplus and cannot change the pricing model or create vault ownership. The hook's before-donate gate bounds aggregate uncollected inflows. The vault records fee-only credits actually harvested from core, which release capacity without waiting for delivery. Principal never releases fee capacity. Rounding dust remains in that aggregate; exceeding capacity rejects a donation atomically.

Implement a read-only quote matching the pinned [Pool.swap source](../contracts/lib/v4-core/src/libraries/Pool.sol) using core `SwapMath`, `SqrtPriceMath`, `TickMath`, and bitmap traversal. The trace must reproduce:

- Both directions and exact-input negative `amountSpecified` semantics.
- Initialized ticks, signed liquidity changes, and empty bitmap-word boundaries.
- The core's price movement through zero-liquidity gaps; do not invent output while no liquidity is active.
- Per-step input/output rounding, price limits, partial consumption, final price/tick/liquidity, and all applicable fee checks.
- The configured traversal/capacity bounds without assuming a constant-product reserve pair remains valid after a tick crossing.

A sorted list of initialized ticks alone is insufficient for exactness: the actual pool also traverses uninitialized word boundaries, whose step rounding must be reproduced. Global virtual reserves derived from current active liquidity do not describe the entire concentrated pool.

The quote returns requested input, actual consumed input, output, final state, and traversal usage. Outside the supported domain it returns a specified unsupported result rather than an arbitrary arithmetic panic. This exact execution oracle is separate from the discrete auction optimizer. A correct quote does not establish the auction's incentive theorem.

Checkpoint 4A implements this as the standalone `OtterExecutionOracle`, bound to
one trusted manager using the pinned core storage layout. It reads live slot0,
active liquidity, cached bitmap words, and crossed tick gross/net liquidity.
It accepts no keeper-provided tick list. `Complete` means all requested input
was consumed; `PriceLimit` means execution reached the valid configured limit
with some input unconsumed. Both include the exact final core state. Every
other status is unsupported: any returned amounts/state are a diagnostic
prefix and must not be accepted as a complete or partial execution quote.
The quote bounds active liquidity and each crossed tick's gross/post-crossing
liquidity. It does not scan all inactive ranges to prove aggregate liquidity or
the position count; the authenticated vault enforces those separate limits.

The read-only model permits zero active liquidity and faithfully traverses
empty gaps; this does not relax the nonzero-liquidity epoch-opening policy.
Zero input returns an unchanged model state without validating the price limit,
as `Pool.swap` does. The public `PoolManager.swap` rejects zero input, so a
settlement with no residual input must skip that swap. Pool/key LP and protocol
fees must all be zero; dynamic-fee keys remain unsupported even with zero stored
fee. Both the starting price and nonzero-input limit must be in the selected
price domain, and the limit must lie strictly in the requested direction.

The oracle models core math only. It does not predict arbitrary hook accounting,
fee overrides, token transfers, or callback side effects, reserve a historical
snapshot, or prove that a later transaction can execute. Otter's configured hook
has no swap-return delta and does not modify the fee/amount, but concentrated
execution is still prohibited while the legacy auction remains. Integration
must bind and revalidate the opening snapshot, enforce the configured hook,
accept only supported statuses, skip zero swaps, and reconcile actual signed
manager deltas. Read-only quoting does not implement those settlement changes.

Checkpoint 4B implements the independent execution reference in
`solver/src/execution.ts`. It uses exact BigInt amount fractions and a
binary-search inverse of the protocol's quantized tick prices. It models the
same fee policy, uint96 input, uint120 output, uint88 liquidity, price interval,
16 words, 64 crossings, 80 steps, check order, statuses, and diagnostic prefixes.
Raw amounts/prices never pass through floating point. Metadata integers are
checked for their ABI widths; negative or too-wide amounts are malformed
off-chain inputs, distinct from ABI-representable requests that return an
unsupported economic-domain status.

An offline snapshot must explicitly supply every visited bitmap word, including
zero words, and every reached initialized tick. Missing data fails explicitly;
it must not be interpreted as absent liquidity. Snapshot tick is preserved,
including core's downward predecrement; replacing it with inverse(price) can
choose the wrong liquidity side. The reference neither mutates nor authenticates
its supplied maps. Test snapshots come from actual PoolManager reads, but a
production RPC reader and concentrated snapshot integration remain to implement.
Checkpoint 4C records the opening configuration and ownership version and
revalidates the admitted full-range epoch before execution. The local ABI/FFI
bridge is test-only and is not an on-chain witness or verification mechanism.

Checkpoint 4C stores `PoolSnapshot` and `PositionSnapshot[]` in the order book
once on first successful admission. The pool record includes its full key,
manager, opening price/tick, active/aggregate liquidity, zero fees, ownership
version and roster hash. The vault checks every funded position's core
liquidity, the roster sum, active liquidity, and both full-range endpoints'
gross/net liquidity and initialized bitmap bits. At most 32 records are read.
The roster order is the vault's current array order, retained exactly, not an
economic ranking. Changes to funded membership or liquidity increment a
pool-specific version; exit reservations, donations, fee collection and claims
do not. Fee growth and already accrued fee claims are excluded from the record.

`snapshotHash` now commits to the v2 opening-snapshot domain tag, chain ID, order-book address, pool,
epoch, configuration, fixed clocks, opening block number, guard and complete
pool record (which includes the roster hash), plus the registered reward policy
hash, total opening capital weight and hash of the frozen weight vector.
Checkpoint 6A extends 4C’s earlier v1 record with these reward commitments. `EpochOpened` exposes that
commitment. This is not an EIP-712 order field: existing v2 signatures authorize
their epoch/ask/budget/time bounds, and its first admission selects the actual
opening state. The block number identifies the opening transaction's block,
not a block hash, finality proof or an RPC authentication mechanism.

The hook's exclusive vault custody and epoch lock preserve the full-range tick
schedule; cheap revalidation checks live slot0/active liquidity and funded
version/total. It does not recopy all bitmap words or authenticate arbitrary
keeper-supplied maps. Concentrated endpoint/tick commitments must be designed
and tested before that gate is removed. Admission validates again after escrow
callbacks; settlement prices from the stored opening state, validates after
escrow release even for zero residual input, and checks again at the swap
boundary. Failure rolls back economic execution. Expiry and individual recovery
remain independent of pool reads and roster scans. Snapshots remain available
after settlement, exits and later epochs; a pre-swap check is not expected to
match the changed price after a successful swap.

Checkpoint 6A computes each opening position's rounded-down removable principal
and values it using the exact squared opening sqrt price with full-precision
multiplication/division. It freezes weights beside the authenticated roster and
rejects a zero-total-weight opening before escrow. The ledger distributes the
actual residual only to those recorded owners. This implements the admitted
full-range historical policy in section 6. General range-value math is checked
independently, but authenticated concentrated reward/auction integration remains
gated; raw liquidity is not a substitute for capital weights.

### Execution and accounting

Verify the complete stored batch, canonical direction/allocation/payments, snapshot, capacity, and claim amounts before executing. No keeper-controlled payment interval or alternative feasible vector is accepted. Re-read execution-critical pool state and fee fields before the actual swap. A mismatch produces no economic completion and retains timeout recovery.

Net the accepted opposing fills using the mechanism's prescribed integer rules. Pay and account using actual `BalanceDelta` input/output, including any unconsumed input. Check the executed trace/result against the expected quote; a mismatch reverts the complete settlement. Never debit traders for a requested input that the pool did not consume. Do not route unexplained shortfall into their minimum payments or recovery balances.

For native debt, explicitly `sync(nativeCurrency)` before `settle{value: owed}()`, following the [pinned manager's recommendation](../contracts/lib/v4-core/src/PoolManager.sol). For ERC20 debt, sync that currency, transfer the checked debt, and settle. Clear every transient delta; reserve native cash for other orders/claims. Positive deltas can be minted as credits to the correct custodian and assigned to individual claims without recipient calls.

Use settlement and custody reentrancy guards plus authenticated unlock callbacks. A callback must match an in-flight operation, authorized manager, pool, and purpose. Keep the economic lock through accounting, not merely until an early `consume` sets a boolean. Test callbacks attempting same-pool and cross-pool operations.

## 6. Historical rewards and LP policy

Checkpoint 6A removes the delayed-donation `flushSurplus` path. Do not donate Otter's residual batch assets to whoever is LP later. Record the eligible owners and weights at epoch opening and credit the terminal residual to those identities. New deposits after settlement have no claim on that epoch. Exiting owners retain their claims. There is no unrestricted flush path.

For this expanded prototype, choose an explicit **capital-weighted policy**, not raw liquidity units across different ranges:

1. Compute each position's underlying principal amounts at the opening sqrt price with core amount math, excluding already accrued rewards/fees and queued-out liquidity only after it has actually been removed.
2. Value that principal in currency1 raw units at the opening spot: `weight = principal1 + floor(principal0 * sqrtPriceX96^2 / 2^192)`, using full precision and checked representation. Weights are independent of the subsequent reported asks/fills. A position whose value rounds to zero has no surplus weight, while keeping its principal ownership.
3. Snapshot the eligible position owner and weight. Divide each residual currency pot by these frozen weights, rounding individual entitlements down. Track the exact remainder separately as an epoch rounding reserve; no solver or new LP receives it. A fixed community destination for that dust must be declared in pool configuration, with no ability to spend backing for other liabilities.
4. Allocate rewards with bounded work and store independent claims, backed by cash or manager credits. Do not wait for the owner to claim before completing the epoch.

Zero active liquidity at opening is unsupported. Reject opening before escrow if there is no eligible positive weight. Under this policy, inactive ranges with capital also receive weight; raw liquidity alone is inappropriate because range width changes the capital backing it. This is a selected prototype distribution policy, **not a proof of risk-fair LP compensation or an inheritance of the paper's incentive result**. Evaluate out-of-range capital, narrow ranges, bidder-as-LP, first-order timing, and repeated epochs. An LP arriving before the snapshot remains eligible; this specification fixes post-trade historical capture, not every possible pre-batch JIT strategy.

**Checkpoint 6B identifies a failed composition property of this selected prototype policy.**
A trader with opening LP weight can lower its ask and increase its funded LP
reward while its own pivotal payment, input and the AMM end state stay identical.
This holds in the exact, funded, one-sided candidate case; canonical trader
payments alone do not resolve it. Fixed weights do not imply a fixed reward
amount. See [the 6B counterexample and conditional split proof](./CHECKPOINT_6B.md).
The policy remains implemented for historical accounting, but G4 below blocks
representing it as a guarantee-preserving redistribution design.

External donations and ordinary position fee growth must be accounted separately. Their collection requires vault ownership and cannot reassign a prior Otter reward. The reward policy is versioned and immutable for each registered pool in this
prototype; a new policy requires a new deployment/configuration and economic
analysis. `OtterRewardLedger` is deployed by settlement and accepts funding only
from that settlement during the current executing epoch, after trader payouts.
It pulls exact ERC20 cash or exact native value, then credits owner claims and
the community dust claim without recipient calls. It records even zero-pot
settlements once. Expired epochs create no reward. Failed funding rolls back
the complete settlement; timeout recovery remains independent of reward delivery.

Initial pool registration is owner-only for both overloads. The one-argument
form declares that immutable settlement owner as the community dust recipient;
the owner can supply a different recipient on first registration. No caller or
later owner can replace it. Zero/ledger/settlement/order-book destinations are
rejected. The deployment script exposes `REWARD_COMMUNITY`, defaulting to the
deployer. These are local source changes; no deployment has occurred.

Rewards use `rewardLedger.claim(currency, amount, recipient)` separately from
order-book trader claims and vault principal/fee claims. Failed or taxed delivery
rolls back that owner's withdrawal only. Cash is reserved against aggregate
claims for every pool sharing a currency, with no administrative sweep or
unsolicited-funds claim path. Retained `epochSurplus` and `epochDust` are immutable
history, not amounts awaiting donation. Removing the old getters/flush and adding
the registry policy field changes the local ABI; the earlier dashboard requires
migration before it can operate this stack.

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

**G1 — Complete the discrete allocation/payment definition.** Derive a rule with a nonempty integer payment interval, both-side IR, deterministic side selection/ties, and an explicit treatment of dust and finite capacity. State the objective and its units for each side; if introducing a cross-side welfare comparison, define and justify its common units rather than attributing that additional rule to the paper. Define leave-one-out outcomes, rounding order, and zero allocation. Use independent exhaustive rational/integer optimization on small domains to find counterexamples before selecting the scalable implementation. Define any deviation from continuous pivot payments and quantify an incentive error only if supported. Postconditions alone are not an algorithm or a truthfulness proof.

**G2 — Establish the concentrated-liquidity mechanism's domain.** The paper assumes an increasing concave continuous curve with an unbounded nonnegative input domain and stated inverse/differentiability behavior. A real tick-aware integer pool has finite usable capacity, zero-liquidity gaps, staircase output, and price limits. Document which assumptions hold on each supported domain and prove or qualify the extended rule. Matching v4's execution is necessary but insufficient. Do not carry over a full-range theorem merely because a within-tick segment is constant-product.

Checkpoint 4B reproduces a concrete integer concavity failure: at 1:1 raw price
with full-range liquidity 1,000, inputs `0, 1, 2` produce outputs `0, 0, 1`.
The second marginal increment exceeds the first; no concave real curve can
match all three points literally. BigInt, the on-chain quote, and a real core
swap for input 2 agree. This falsifies literal substitution of integer output
into the continuous assumption, not the existence of an adapted truthful rule.
G1/G2 must select and evaluate that adaptation, including finite capacity,
integer payments, unspent input, both-side IR, and dust.

Checkpoint 4D supplies a one-sided finite-domain exact welfare/pivot laboratory
and independent exhaustive comparison. It shows a raw pivot funding deficit
on that same v4 staircase, as well as particular optimal fills for which both
whole-unit IR payments cannot fit the available output. Ceil/floor rounding
introduces further funding or IR failures, and refunding every insolvent batch
creates a profitable ask misreport in the tested candidate policy. Even on
funded finite concave tables, ceil payments can reward an ask misreport or
identity splitting. These are open candidate failures, not deployed policies,
proof counterexamples under the paper's assumptions, or an impossibility result
for all adapted mechanisms.

The report proves funding/IR for ceil pivots only on a fixed one-sided finite
integer-concave prefix, and a less-than-one-raw-output-unit incentive error
only for a single identity's feasible ask/budget deviation under fixed direction,
domain, linear utility and other reports. The latter excludes false names,
LP rewards, two-sided selection and the refund fallback; for unfunded outcomes
it is only algebraic. No complete adaptation is selected. A coarse lot or
fractional claim would change the mechanism contract and needs its own analysis.
G1/G2 remain open; preserve whole-unit per-order IR until an explicit revised
policy is selected and its tradeoffs are recorded.

Checkpoint 4E defines and tests a two-sided candidate using exact reciprocal
spot lots, rounded-down lot budgets, fully paid minority lots, finite residual
AMM tables and unrounded dominant compensation. The local certificate supports
its scoped funding/raw-IR argument. Net-flow deviation tests include both
directions, side changes, false names and feasible strategies whose gross sale
exceeds their true budget but whose opposite trades buy input back. No profitable
nominal-claim deviation appears in the declared grid; a full UIC/efficiency/builder
proof and independent review are still absent.

This candidate does not resolve G1/G2. Minimum exact spot lots exceed the
accepted input domain at most sampled quantized tick prices. Fractional output
claims are not implemented, and immediate whole-token redemption can fall below
integer IR. Ceiling still creates profitable deviations. The report records
these representation/domain failures; no lot setting, fractional asset, revised
signature or weaker mechanism is selected. Further work must fit ordinary
prices and specify backing, ownership, redemption, dust and actual pool input
before any change to the accepted payment contract or canonical settlement.

Checkpoint 4F establishes a scoped two-report conflict: with its published
winning fill and zero losing compensation unchanged, winning-type whole-token
IR requires payment at least one while losing-type truthfulness requires at
most 3/4. No payment rounding or additional backing can preserve both premises.
This does not rule out every revised allocation or asset system. Its offline
fractional ledger retains exact trader/community dust and reserves escrow and
cross-pool liabilities, but nominal backing does not establish immediate whole
redemption or exact claim valuation. No fractional claim contract is implemented.

At general prices exact spot compensation may exceed a fixed credit scale's
precision. Even any power-of-ten precision cannot express one unit's reciprocal
4/9 spot payment. With whole dominant input and fractional minority compensation,
the prescribed residual pool input is fractional. Floor/ceil diagnostics retain
actual core consumption: ceil leaves input-backing deficits, while floor needs
new output, reserve ownership and liability rules. Straight quote interpolation
is diagnostic only, not an executable or certified compensation curve. A complete
allocation redesign or asset/curve adapter must supply analytical incentive,
backing and redemption arguments before a rule is selected. More passing finite
nominal-claim grids alone cannot close G1/G2 or revise the existing IR contract.

Checkpoint 4G supplies exact integer-per-lot pivots, independent finite layer-cake
welfare and a scoped one-sided analytical argument for funded integer IR and
feasible same-direction value/budget/false-name resistance. It assumes true
integer costs, a fixed concave lot table and unchanged included other reports;
it proves neither majority/opposite-direction behavior nor the full paper theorem.
Original asks are not automatically converted: ceiling fractional costs permits
a profitable misreport and flooring can violate the original signed minimum.

Every original WAD ask has integer cost on a lot iff the lot is a WAD multiple.
The smallest reciprocal spot pair preserving that property in both directions
is WAD times the coprime primitive pair. At special raw spot 9/4 it fits uint96,
but a real scaled residual swap moves the pool to a price where even primitive
lots exceed uint96. The candidate can therefore lose next-batch admissibility
after a valid trade. Larger lots do not fix generic price support. Preserve the
original valuation/IR contract; G1/G2 require a broader-domain redesign covering
finite capacity and changing v4 prices, not just valuation quantization or more
passing restricted grids. No production cost field or lot policy is selected.

Checkpoint 4H supplies exact original-WAD transfer constraints with independently
verifiable negative-cycle certificates. With other reports and a true budget C
fixed, deterministic whole-output payments force equal input fills and payments
across any positive asks a<b with b*C<WAD. The necessary truthful-report
inequalities put any positive fill change's integer payment difference strictly
between zero and one. This constraint does not rely on Groves payments, zero
loser compensation, IR or a funding deficit. Its underlying-token/net-input
premises are explicit; it is not a universal impossibility theorem for redesigned
asset/curve systems or the continuous paper.

In the real-v4 capacity-four case, every raw partial fill is available, yet all
125 response vectors at three original WAD asks reduce to five constant truthful
responses. Even the best loses at least 1/8 output raw unit of allocation welfare
in one profile, including when unused capacity is permitted. Conditional menus
are not full mechanisms: rival, budget, false-name, opposite-side and builder
incentives remain unproved. G1/G2 require a complete design escaping the stated
premises with explicit efficiency/incentive and actual backing/redemption rules;
extra whole reserves or more restricted passing grids are insufficient. No
weaker efficiency, signature, allocation, asset or IR policy is selected.

**G3 — Choose enforceable verification within measured resources.** Begin by benchmarking direct recomputation on bounded batches and traces, including counterfactuals. If it cannot fit, lower measured limits or specify a complete authenticated witness/proof design. The witness must bind G1's full computation and G2's real curve, not just feasibility or welfare. Do not introduce a TEE, bond, or optimistic dispute period and call it equivalent to immediate trustless verification. Any changed trust/delivery model requires a revised specification and disclosed funding scope.

**G4 — Preserve incentives across trader, builder and LP roles.** Include all
economically controlled identities, opening LP claims and community benefits in
combined utility. The 6B unchanged-swap deviation must fail under the final rule.
A current-pot share remains report-dependent even if ownership predates admission.
Address exclusions, vesting and an earlier cutoff alone do not fix that dependency.
For unchanged allocation and trader payments, require the appropriate report
independence of supplemental benefits; otherwise provide a complete revised
mechanism with joint incentive, funding and repeated-epoch arguments. Research
pre-fixed exogenous benefits or another rigorously defined redistribution model
without selecting a weaker guarantee. Specify entry-history authentication and
clock/inclusion assumptions separately. An independent mechanism review must
assess the full policy. Historical cash accounting can proceed, but canonical
settlement cannot be called guarantee-preserving before G4 is satisfied.

Custody, independent recovery, the exact quote and historical-surplus accounting using the recorded admitted LP ownership can proceed while these gates are researched. Historical accounting does not make the legacy allocation/payment rule canonical or establish concentrated capital weights. During their implementation, concentrated positions may be custodied, but admission and swaps must reject concentrated pools before escrow until their execution model is supported. Step 5 cannot be considered complete until G1–G4 have an implementation-ready rule and acceptance evidence. If the extension fails a claimed incentive property, report that result and adjust the claim; do not hide it with more randomized passing tests.

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
| Joint trader/builder/LP incentives | G4, mechanism, reward policy | Exact-pivot unchanged-AMM deviation cannot gain combined utility; beneficial control, entry timing, rounding, community benefits and repeated epochs are modeled |
| Production/grant evidence | Deployment, operations, benchmark docs | Pinned artifacts and bytecode/config manifest; real testnet solving/recovery/exit demonstration; complete costs and revised limited claims |

Contract invariants must cover many users, pools sharing currencies, failed claims, repeated epochs, and LP entry/exit. Quote differential tests must compare actual consumed input/output and final pool state; comparing two copies of the same shortcut is insufficient. Measure first admission with its LP snapshot, worst-case settlement/counterfactual work, cold claims, native/ERC20 paths, and exits separately. Include transaction/calldata costs and specify the target chain/transaction budget when setting deployable caps.

## 9. Checkpoint and next implementation

The user committed the specification as `a7637a9`, authenticated LP custody
as `bc79d64`, and native/ERC20 custody as `57bdd33`. Checkpoint 3A supplies bounded
v2 signatures, stored records, explicit execution deadlines, constant-work
expiry, independently credited refunds, and bounded EIP-1271 validation.
Its report records validation and the user-created commit. The old
order ABI/domain is incompatible; the dashboard and published contracts are
still the earlier prototype.

Checkpoint 3A was committed as `3518355`. Checkpoint 3B was committed as `eee2aeb` and implements queued LP
exits, priority before the next epoch, bounded uncollected donations, and full
core-representable withdrawal credits. Its report records validation and the
user-created commit. Checkpoint 4A was committed as `051c11f` and implements
authenticated bounded read-only quotes and differential execution evidence.
Checkpoint 4B was committed as `49586b3` and supplies the independent BigInt
execution reference, matched execution domains, and further real-core comparisons.
Checkpoint 4C was committed as `caca1bd` and supplies opening full-range
pool/ownership records and execution revalidation. Checkpoint 4D was committed
as `e156b91` and supplies bounded discrete allocation/payment/capacity research.
Checkpoint 4E was committed as `5d6415e` and supplies two-sided exact-lot
candidate and net-flow evidence. Checkpoint 4F was committed as `d37d48b` and
supplies representation/backing, redemption and actual-input diagnostics.
Checkpoint 4G was committed as `5841493` and supplies exact integer-cost
research, the finite one-sided argument and post-swap lot failure. Checkpoint 4H
supplies exact original-WAD truthful-payment constraints and changed partial-fill
limits and was committed as `ed69b3e`. Step 4 remains
incomplete. A compatible design must address original valuations, whole-token
IR, finite capacity and changing prices with explicit efficiency/incentive and
backing/redemption arguments under G1/G2, then measured full verification for G3.
The legacy auction retains its known boundary/payment failures.

Checkpoint 4H was committed as `ed69b3e`. Checkpoint 6A implements the admitted
full-range historical reward path, frozen opening capital weights, exact funded
claims/dust and a local R7 prevention regression. The user committed it as
`ebfea3e`; the tree was clean before 6B. Different-width/inactive-range arithmetic
is checked, but
concentrated ownership/execution integration and LP economic guarantees remain
unfinished. The complete step 6 scope is not closed, and R2/R6 remain active.
Checkpoint 6B proves a conditional same-range split bound and identifies an
exact-pivot profitable deviation for an opening LP trader. Its report records
the evidence, limits and pending user-created commit. Resolve the resulting
joint redistribution gate G4 together with G1–G3 before claiming the selected
policy preserves the paper's guarantees. Canonical settlement and expanded
concentrated execution still require sections 5–7; historical accounting,
claims and exits do not resolve the discrete mechanism's incompatibilities.
