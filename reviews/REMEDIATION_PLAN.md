# Otter remediation plan

Prepared 2 October 2026 from [the grant readiness review](./GRANT_READINESS_REVIEW_2026-10-02.md).
Starting revision: `6c54695e1c7a534afa9f69ba8f08705a2a8a4830`.

The review supplies the findings and reproductions needed to begin. This plan supplies the implementation order, design gates, acceptance evidence, and user-created commit checkpoints. A separate full project-planning workflow is unnecessary at this stage.

User-selected scope: **expand asset and liquidity support now**, including direct native ETH and concentrated liquidity. These are part of the remediation rather than deferred follow-ups. [The v2 implementation specification](./IMPLEMENTATION_SPEC.md) records the selected custody, recovery, liquidity, and execution rules, together with the numerical research gates.

User-selected mechanism priority on 4 October: **preserve the paper's guarantees;
keep testing before selecting a rule**. Do not substitute a funded prototype with
weaker incentives. Payment/asset and trade-size changes remain research candidates
until their complete rules, practical support and guarantees are established.

## Commit protocol

The user creates every commit. The assistant must not create or amend a commit.

At each checkpoint:

1. Complete the scoped changes and appropriate validation.
2. Report the files to include, what was achieved, test results, and material limitations; provide a short suggested commit title/body.
3. Ask the user to create the commit and stop work at that checkpoint. Do not begin the next step or perform further edits while the commit is pending.
4. After the user confirms completion, inspect Git status and HEAD to establish the new baseline, then continue. Preserve unrelated changes.

Checkpoint 0 is complete in the user's commit `63ec94e`. The user's commit also includes their corrections document; preserve it. Checkpoint 1 is complete in the user's commit `a7637a9`, checkpoint 2A in `bc79d64`, and checkpoint 2B in `57bdd33`. Step 2 is split into reviewable code checkpoints: 2A for LP custody/integration, then 2B for trader native/ERC20 escrow. Do not proceed past either pending user commit.

## Implementation sequence

Each numbered step ends in a user-created commit. If a step grows too large to review coherently, divide it into smaller validated checkpoints using the same protocol.

| Step | Scope and purpose | Acceptance evidence |
|---|---|---|
| 0 | Preserve the review and reproducible counterexamples | Existing review records 80 passing baseline contract tests, nine Solidity reproductions, solver checks, and successful web build; clearly label reproductions whose passing assertions demonstrate unsafe behavior |
| 1 | Define the implementation contract: native/ERC20 semantics, concentrated execution, numeric limits, expiry, ties, recovery, historical rewards, and discrete mechanism gates | A precise specification identifies enforceable guarantees and unresolved research questions; every review finding and expanded support requirement has regression ownership |
| 2 | Replace unsafe deployment custody with an authenticated range-position vault and native/ERC20 escrow | An outsider cannot remove or collect another user's position; full-range and concentrated deposits enforce ownership/slippage; ETH value and received ERC20 escrow match credited amounts; optional-return tokens work |
| 3 | Bound admission and deliver independent recovery with explicit expiry and queued LP exits | An oversized batch cannot be admitted; blocked ERC20/ETH recipients do not veto finalization or unrelated claims; no double claim or settlement/refund overlap; exits precede next admission after settlement or expiry |
| 4 | Implement the exact tick-aware execution oracle and correct arithmetic in Solidity/BigInt; resolve the discrete rule | Match real PoolManager input/output and final state through ticks, empty words, gaps, and price limits; domain boundaries agree; both-side integer IR, empty intervals, ties, and finite capacity have a complete tested rule |
| 5 | Enforce canonical allocation and payments after specification gates G1–G4 pass | Reject incorrect feasible vectors, noncanonical zero fills, and solver underpayment; settle both directions and native pairs with actual deltas; callers have identical checks; fee drift retains recovery |
| 6 | Replace captureable donations with snapshot ownership and capital-weighted historical rewards | New liquidity gets no past surplus; prior owners retain claims after exit; different ranges use specified weights; same-transaction claims cannot bypass eligibility; strategic LP overlap and rounding are evaluated; G4 requires joint incentive compatibility |
| 7 | Make expanded testnet and wallet flows usable | Live native/ERC20 and concentrated batches, independent recovery, and LP exit processing are demonstrated; receipt-based wallet state, EIP-1271, multiword nonces, epoch/claim display, outages, and reorgs work |
| 8 | Produce reproducible economic evidence and a grant application package | Compare all-in costs, execution, fills, latency, and LP returns across ranges; accurately distinguish proof/test assumptions and demo data; estimate expanded engineering/review costs rather than reuse the original timing guess |

## Design gates before implementation

Step 1 should resolve implementation choices using the codebase and documented tradeoffs. Ask the user only for decisions that change the intended product, asset support, or funding scope; routine engineering choices can be made within the authorized scope.

That product-scope decision is now recorded: native ETH and concentrated liquidity are included. The implementation specification selects a dedicated vault compatible with the pinned core, stored independent claims, a fixed execution window, permissionless canonical settlement, and capital-weighted historical LP rewards. Its engineering limits are provisional until measured. Its G1–G3 gates distinguish the unresolved discrete mechanism, concentrated-curve assumptions, and affordable verification. Checkpoint 6B adds G4 for joint trader/builder/LP redistribution incentives. Safety work may proceed while those are researched; canonical settlement cannot be declared finished without resolving them.

### Canonical settlement and the discrete mechanism

Prefer the smallest independently verifiable version that implements the specified mechanism for a bounded batch. Measure whether direct computation or an allocation/payment witness is practical before choosing a proof-system dependency. The maximum batch size is an output of worst-case measurements, not an assumed universal number.

Verifying welfare optimality alone is insufficient: the payment rule, side selection, tie policy, and rounding must also be bound to the committed batch and pool state. A fixed solver address, multiple solvers, or a bond does not make an incorrect outcome correct.

Do not claim exact dominant-strategy truthfulness for the integer version merely because the continuous mechanism has a proof. Specify and validate the discrete rule; quantify an approximation if one is required. Tie-breaking choices need consideration of identity grinding and sybil behavior.

### Recovery and data availability

Choose an authenticated representation permitting independent claims, such as stored order identities or a commitment with practical inclusion proofs. Retaining the existing rolling digest is acceptable only if independent recovery is demonstrated within the specified bounds.

Define all states and transitions: collecting, closed, executing, completed, expired/refundable, and individually claimed. Freeze economic decisions separately from recipient transfers. A failed claim must not prevent other claims or leave the pool permanently frozen.

Specify signature admission validity, batch binding, execution validity, and unused-signature invalidation. Avoid introducing an execution-time expiry revert that vetoes the entire batch. Require independently recoverable order data and replay protection.

### Liquidity ownership and rewards

Select a production periphery integration after verifying its current pinned source and hook compatibility. If a dedicated LP vault is needed for historical reward accounting, specify ownership, shares, reward checkpoints, and withdrawal behavior together; avoid building two incompatible ownership models in successive steps.

Record reward eligibility before the trading interval being rewarded. A delay or vesting period alone does not prevent historical-surplus capture. Include pre-existing LPs, exiting LPs, new LPs, transferred ownership, donations, and repeated batches in the model.

### Supported assets, fees, and arithmetic

Define supported ERC20 semantics explicitly. Safe token calls handle optional return data; they do not validate transfer taxes, rebasing, or later transfer restrictions. Account for received amounts and shared-token liabilities across pools.

Specify the supported price, liquidity, amount, and decimal ranges. Use overflow-safe comparisons and full-precision arithmetic where appropriate, with explicit behavior when results cannot be represented. Make the BigInt reference model those limits.

Define protocol-fee handling separately from LP fees and account for the PoolManager's actual returned deltas. Test finite full-range endpoints and partial input consumption. A fee change during an active batch must have a specified safe outcome.

The expanded version must reproduce actual v4 tick traversal and step rounding, including empty bitmap words and zero-liquidity gaps. Full-range constant-product virtual reserves cannot be reused as the global concentrated curve. Native settlement must explicitly sync the native currency and settle with the actual debt as value. Supported zero-fee execution is checked against both LP and protocol fee fields.

## Validation and regression discipline

- For each finding, retain the original reproduction in history and change the active regression to require the corrected behavior once its fix lands. A test that continues asserting an exploit succeeds is not evidence of a fix.
- Preserve the existing functional tests and add meaningful boundary and state-transition tests. Use independent small-domain optimization and exact arithmetic where it can detect shared mistakes between implementations.
- Test full sequences: submit, solve, settle, claim, expire, recover, liquidity exit, reward claim, and next batch. Include both trade directions, token callbacks, failed transfers, repeated calls, and cross-pool liabilities.
- Measure worst-case transaction resources under target-chain assumptions. Separate admission, settlement, claims, and approvals; include calldata and cold transaction behavior. Run benchmark generators deliberately because existing harness tests overwrite saved result files.
- Apply checks appropriate to each checkpoint. Do not repeatedly run broad suites without a change or unresolved concern that justifies them.
- Publish what is proven, what is tested, and what remains an assumption. An external contract review and a mechanism/economic review are separate deliverables.

## Completed checkpoint 0

Include exactly these newly created review artifacts:

```text
reviews/GRANT_READINESS_REVIEW_2026-10-02.md
reviews/REMEDIATION_PLAN.md
contracts/test/GrantReview.t.sol
solver/test/grant-review.ts
```

Suggested title: `test: establish Otter security review baseline`

Suggested explanation:

> Document grant readiness and a staged remediation plan. Add nine contract reproductions and solver boundary counterexamples covering liquidity ownership, settlement discretion, refunds, arithmetic, expiry, fees, ties, and surplus capture.

Status: committed by the user as `63ec94e`; inspected clean working tree before checkpoint 1.

## Checkpoint 1 commit handoff

Include these documentation changes:

```text
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
```

Suggested title: `docs: specify Otter v2 safety and expanded pool support`

Suggested explanation:

> Define native ETH escrow, tick-aware execution, authenticated LP custody, independent claims, queued exits, and historical reward accounting. Map findings to regression requirements and identify the discrete-mechanism and verification gates before canonical settlement changes.

Status: committed by the user as `a7637a9`. The working tree was clean before starting checkpoint 2A.

## Checkpoint 2A: authenticated LP custody

See [the code checkpoint report](./CHECKPOINT_2A.md) for scope, acceptance evidence, limitations, and the user-created commit handoff. This slice replaces the shared test-router position with an owner-authenticated vault, credits LP exits/fees without recipient transfers, and protects the economic freeze during callbacks. Status: committed by the user as `bc79d64`; clean tree inspected before 2B. Native and concentrated LP custody is implemented. Concentrated batch execution remains blocked pending step 4.


## Checkpoint 2B: trader assets and isolated claims

See [the asset checkpoint report](./CHECKPOINT_2B.md) for implementation, API,
validation, limits, and the user-created commit handoff. Native trader escrow,
standard/no-return ERC20 custody, isolated refund/output claims, shared-currency
backing, and exact PoolManager transfers are implemented locally. Nonzero
protocol fees and incomplete input consumption explicitly reject settlement
and preserve timeout recovery. Step 2's custody/asset acceptance is complete;
no deployment has been performed. Status: committed by the user as `57bdd33`;
clean tree inspected before checkpoint 3A.

R4's recipient veto regression now asserts independent claims. R9's zero-fee
policy and complete-input rejection are tested, but supported partial execution
and the exact tick-aware quote remain pending. The original oversized timeout replay
reproduction remains in that commit's history; checkpoint 3A replaces it with
admission and independent-recovery prevention regressions.

## Checkpoint 3A: bounded epochs and stored recovery

See [the epoch checkpoint report](./CHECKPOINT_3A.md) for the v2 signature schema,
clock/state transitions, numeric and wallet limits, recovery API, tests, and
user-created commit handoff. This slice bounds each batch to 32 orders, binds
signatures to a configuration/epoch/execution limit, and separates constant-work
expiry from independent stored refunds and asset delivery. Pause affects only
admission. An authenticated fee change can expire a batch early.

Step 3 is split into two code checkpoints. **3A was committed by the user as `3518355`; clean tree inspected before 3B.**
3B implements owner-authorized queued LP exits and blocks the next epoch
until reserved exits have been processed. The committed 3A snapshot still lacks
this barrier; its constant-work expiry alone does not fix exit starvation.

The remaining active exploit reproductions are R2 (solver discretion), R6
(minority dust IR), and R7 (historical surplus capture). R5's extreme-ask
admission poison and R8's unbounded execution exposure are prevented locally;
these changes do not resolve the remaining arithmetic/curve/mechanism work.

## Checkpoint 3B: queued LP exit priority

See [the exit checkpoint report](./CHECKPOINT_3B.md) for owner reservations,
permissionless per-position processing, current-versus-next-epoch admission,
donation accounting, tests, and the user-created commit. An active
exit request does not change pricing liquidity, truncate current collection,
or prevent the current batch's swap. It blocks the next epoch until processing
credits the owner's actual principal and accrued core fees.

This checkpoint also bounds uncollected donations to prevent accrued fees
from overflowing core's signed returned delta and blocking exits. Only actual
core fee harvesting releases that capacity; principal is not a fee offset.
Withdrawal credits retain all amounts representable by core even after a final
legacy swap moves beyond the deposit-price domain. Those credits can be claimed
in chunks. The before-donate permission requires newly mined hook addresses.

Step 3's local custody/recovery/exit acceptance is complete after validation.
**3B was committed by the user as `eee2aeb`; clean tree inspected before 4A.**
Canonical payments, minority dust IR, historical rewards, concentrated batch
execution, wallet migration, and independent reviews remain.

## Checkpoint 4A: bounded exact execution quote

See [the oracle checkpoint report](./CHECKPOINT_4A.md) for the read-only API,
supported statuses/domain, real-core differential tests, cold gas measurements,
limitations, and the user-created commit. This slice authenticates live
PoolManager state and models zero-fee exact-input execution through initialized
ticks, empty bitmap boundaries, zero-liquidity gaps, and finite price limits.
It reports actual consumption, output, final state, and bounded traversal usage.

Only `Complete` and `PriceLimit` are usable quote statuses. A traversal/domain
failure is explicitly unsupported; its prefix is not an executable quote.
Zero input is a model no-op and requires skipping the public manager swap.
The oracle neither reserves a snapshot nor changes settlement or admission.
Concentrated custody remains available and concentrated batches remain gated.

**4A was committed by the user as `051c11f`; clean tree inspected before 4B.**
One bounded quote's cost is not a bound for an auction with counterfactual
quotes. Do not integrate the oracle by merely replacing the old constant-product
formula or lifting the concentrated execution gate.

## Checkpoint 4B: independent execution reference and matched domains

See [the reference checkpoint report](./CHECKPOINT_4B.md) for exact BigInt
fraction math, binary-search tick inversion, snapshot completeness rules,
domain/status correspondence, the local ABI test bridge, and validation.
The new model agrees with the Solidity oracle and actual PoolManager execution
in deterministic cases and 512 randomized comparisons. Unsupported results
also agree field-for-field, including diagnostic prefixes and traversal usage.
It is an offline reference, not an authenticated live-state reader or a solver.

A real-core-backed reproduction with liquidity 1,000 and price 1:1 gives raw
outputs `0, 0, 1` for inputs `0, 1, 2`. The increasing marginal increment shows
why the exact integer quote cannot be substituted literally for the continuous
concave curve in the proof. This is not an impossibility result for an adapted
mechanism. The existing dust IR, arrival-tie, and allocation/reward failures
remain visible and unresolved.

**4B was committed by the user as `49586b3`; clean tree inspected before 4C.**
Step 4 remains incomplete. Continue with the explicit opening pool/ownership
snapshot and independent small-domain allocation/payment/capacity research
under G1–G3. The
reference supplies executable curve evidence for that research; it supplies no
canonical auction rule. Canonical verification, partial-settlement accounting,
historical rewards, and concentrated execution require their remaining gates.

## Checkpoint 4C: opening pool state and LP ownership records

See [the snapshot checkpoint report](./CHECKPOINT_4C.md) for immutable epoch
history, authenticated bounded LP/core reads, the configuration commitment,
callback and execution revalidation, resource evidence, and remaining limits.
Failed first admission leaves no snapshot, clock, nonce or escrow. Later orders
cannot overwrite the opening record; exits/new deposits cannot overwrite older
ownership history. Queued exits and donations remain compatible with the
current epoch, and timeout recovery does not read the pool or scan the roster.

This slice binds the currently admitted full-range state only. It does not
authenticate arbitrary off-chain maps, enable concentrated auctions, implement
capital weights or reward claims, remove legacy solver discretion, or resolve
integer IR. Those remain explicit deliverables, not implied by storing a roster.

**4C was committed by the user as `caca1bd`; clean tree inspected before 4D.**
Continue G1/G2 small-domain research using the exact execution reference, including
finite capacity, dust, both-side IR, ties and counterfactual semantics. Measure
the complete candidate computation for G3 before committing to canonical
settlement. Concentrated snapshot integration and historical rewards still
require their implementation and validation; do not lift the auction gate
merely because the full-range snapshot tests pass.

## Checkpoint 4D: discrete allocation/payment counterexamples

See [the research checkpoint report](./CHECKPOINT_4D.md) for the bounded exact
quantity scan, independent Cartesian optimizer, fixed counterfactual domain,
finite capacity/lot behavior and real-core-backed tables. Published negative
controls expose raw pivot deficits, a whole-unit IR/funding conflict at specific
welfare-optimal fills, rounding-only deficits, a profitable refund-fallback
misreport, funded ceil-payment manipulation and false-name rounding profit.
Minority floor payments fail integer IR in both price orientations.

The local concavity certificate and limited single-identity sub-unit rounding
bound have explicit assumptions and exclusions; neither establishes the full
incentive theorem or complete two-sided settlement. G1/G2 remain open. No
production contract, legacy solver, deployment or concentrated gate changes.

**4D was committed by the user as `e156b91`; clean tree inspected before 4E.**
Develop and compare
complete candidate adaptations with explicit allocation/payment/lot/dust and
identity tradeoffs, including both sides' IR and finite capacity. Then measure
the selected full algorithm and authenticated counterfactual verification for
G3. Do not advance to step 5 merely because the research optimizer and its
negative controls pass. Historical LP rewards and concentrated integration
remain separate implementation work.

## Checkpoint 4E: two-sided exact exchange lot candidate

See [the candidate checkpoint report](./CHECKPOINT_4E.md) for minority/AMM funding,
dominant pivot counterfactuals, signed residuals, the local concavity certificate,
full net-flow utility and independent enumeration. The candidate's nominal
fractional claims show no profitable deviation in the declared 30,940-feasible
strategy grid. That is not a complete UIC proof or an implemented claim asset.
Ceil rounding still gives profitable ask/split deviations. Immediate floor
redemption fails the existing whole-token IR postcondition in published cases.

Minimum exact reciprocal spot lots exceed the uint96 input bound at 2,000 of
2,001 sampled tick prices. The candidate is therefore not a general price-support
solution. Rounded spot ratios or changed input/payment assets require explicit
new execution, backing and incentive analysis. No weaker production mechanism,
fractional token, deployment or concentrated-gate change is selected.

**4E was committed by the user as `5d6415e`; clean tree inspected before 4F.** Investigate a
proof-compatible compensation/asset representation that fits ordinary quantized
prices. Define the complete redemption/backing/dust/actual-input rules and
evaluate whole-token IR and full net-flow incentives before any product-contract
revision. Retain the user's original guarantee priority. G1/G2 and independent
mechanism review remain open; G3 must measure the selected full computation
before canonical settlement and concentrated auctions can proceed.

## Checkpoint 4F: compensation representation and actual input

See [the representation checkpoint report](./CHECKPOINT_4F.md) for exact rational
spot diagnostics, retained fractional debt, immutable backing/redemption models
and real-core neighboring swaps. For the two published allocation outcomes,
every whole payment satisfying the winning type's IR creates a profitable
misreport by the losing type. This is a scoped unchanged-allocation conflict,
not a universal impossibility theorem for revised mechanisms.

Output credits alone neither meet immediate underlying-token IR nor make a
fractional residual input executable in v4. Increasing decimal precision cannot
express every reciprocal spot payment; ceil residual swaps expose input-backing
deficits, while floor swaps require explicit output, reserve and liability rules.
The ledger retains all dust and rejects spending other claims/escrow as surplus.
It is offline arithmetic, not an implemented fractional asset or selected rule.

**4F was committed by the user as `d37d48b`; clean tree inspected before 4G.** The next design work must address the
allocation outcomes or a complete asset/curve adapter with analytical incentive,
backing and redemption arguments. More passing nominal grids alone cannot close
the demonstrated gaps. Retain the user's original guarantee and minimum-output
priority; do not advance to canonical settlement or concentrated execution before
G1–G3 and independent mechanism review are resolved.

## Checkpoint 4G: integer cost grids and repeat-batch lot limits

See [the cost-grid checkpoint report](./CHECKPOINT_4G.md) for exact integer pivots,
independent layer-cake calculations and a finite one-sided analytical argument
under explicit assumptions. It supports funded reported IR and feasible
same-direction value/budget/false-name resistance for true integer per-lot costs.
Two-sided grid tests do not establish the full theorem. Automatically ceiling
original costs permits a profitable misreport; flooring can violate original IR.
No valuation restriction or rounding policy is selected for production.

The smallest exact exchange lots preserving every original WAD ask in both
directions are primitive lots multiplied by WAD. A real v4 swap from special
spot 9/4 moves to a price where even the primitive lots exceed uint96. Thus the
candidate can lose next-batch admissibility immediately after a valid trade.
Larger value-preserving lots cannot repair generic or repeat-batch price support.

**4G was committed by the user as `5841493`; clean tree inspected before 4H.** Continue a broader-domain redesign that
addresses original WAD valuations, whole-token IR, finite capacity and changing
v4 prices together. Require explicit efficiency and analytical incentive/backing
arguments for changed allocations or a report-independent curve/asset adapter.
Do not substitute the restricted grid for the user's original guarantee target.
G1/G2 and independent review remain open; G3 must measure the selected full
authenticated algorithm before canonical settlement or concentrated admission.

## Checkpoint 4H: truthful whole payments and changed partial fills

See [the transfer checkpoint report](./CHECKPOINT_4H.md) for exact original-WAD
truthful-payment constraints, verifiable negative-cycle certificates and a
necessary allocation-indifference argument under stated deterministic integer
payment/fixed-budget assumptions. All 125 raw fill responses at three low-cost
types in a real-v4 capacity-four case are checked. Only constant responses admit
truthful integer payments; even the best incurs at least 1/8 output raw unit of
allocation-welfare regret in one profile. This is scoped one-sided research,
not a universal impossibility theorem for the paper or all redesigned assets.

No weaker mechanism, signature, rounding or IR policy is selected. G1/G2 require
a complete model that explicitly escapes the incompatible premises, plus its
full incentive/efficiency and actual backing/redemption arguments. More passing
restricted grids cannot settle that design choice; G3 and independent review
remain prerequisites for canonical settlement.

**4H was committed by the user as `ed69b3e`; clean tree inspected before 6A.** Address R7 independently through
bounded historical reward accounting using recorded opening LP ownership in the
admitted full-range model. New liquidity must receive no past surplus; opening
owners retain claims after exit. Preserve shared-currency backing, independent
claims, callback guards and exit priority. Concentrated capital weights and
auction admission remain pending; this safety slice does not complete step 6
or authorize noncanonical legacy allocations. Keep the original mechanism
guarantee priority while that separate design requires a compatible basis.


## Checkpoint 6A: funded historical rewards for admitted pools

See [the reward checkpoint report](./CHECKPOINT_6A.md) for opening capital weights,
versioned snapshot/policy commitments and the separately funded reward ledger.
The admitted full-range path assigns every residual pot to opening owners during
settlement, records and credits exact rounding dust to a fixed community recipient,
and retains independent claims after exits. There is no delayed donation or flush.
The R7 regression now asserts that later LPs get no prior rewards. External
position fees remain separate. Owner-only initial pool registration prevents a
caller from front-running the immutable treasury choice. Owners still claim
independently, and settlement remains permissionless after exclusivity.

**6A was committed by the user as `ebfea3e`; the tree was clean before 6B.**
This fixes post-settlement historical capture locally, not the complete LP incentive problem, canonical allocations or expanded
concentrated auctions. R2 and R6 remain active findings. Keep the mechanism's
G1–G3 gates and independent review. Next validate capital rounding, owner splitting,
LP/bidder overlap and opening timing as an economic policy, including the boundary
for concentrated integration; do not enable concentrated auctions merely because
range-value arithmetic passes. Wallet/ABI migration, resource limits, testnet
execution and grant evidence remain unfinished.

## Checkpoint 6B: joint LP and trader incentive gap

See [the reward-composition checkpoint report](./CHECKPOINT_6B.md) for exact
pivots, unchanged real v4 swaps and a funded LP-claim gain from an ask misreport.
A fixed opening stake in a variable current-epoch surplus is not a fixed payment.
This differs from R2's arbitrary solver outcomes and R7's corrected later-LP
capture. The current historical cash ledger remains implemented, but canonical
trader payments alone do not make the redistribution policy truthful for an LP
trader or builder. Gate G4 now requires the complete combined-role design.

The same-range fixed-state arithmetic proof shows splitting cannot inflate
owner cash, including owner plus controlled community dust. It does not cover
range changes, principal/fee/gas flows, entry timing or sequential epochs.
The first-order cutoff still admits LPs added just before opening.

**6B was committed by the user as `2f12631`; the tree was clean before 6C.**
Its report records the files and suggested title/body. No production rule, order ABI or selected guarantee changes.
After the commit, continue a complete redistribution/asset/curve design with
explicit joint utility, backing and repeated-epoch requirements. Earlier cutoff,
address exclusion, vesting and a capped current-pot fraction do not alone repair
the existing-stake counterexample. Preserve the user's guarantee priority;
G1–G4, independent mechanism review and concentrated integration remain open.


## Checkpoint 6C: concrete redistribution candidate and required assumptions

See [the checkpoint report](./CHECKPOINT_6C.md) and
[redistribution design proposal](./REDISTRIBUTION_DESIGN.md). The offline
pre-funded calendar commits fixed whole entitlements before a cutoff, reserves
shared-currency cash and future account capacity, releases at the clock boundary
without a batch-result condition and supports independent modeled claims.
A constant auxiliary benefit preserves a truthful base rule only with fixed
history, unchanged feasible utility and deviation-independent benefits across
controlled identities. This does not establish the base integer/two-sided rule.

The proposal rejects interpreting vesting, cap plateaus, earlier ownership or
fixed bonuses per caller-started batch as a complete fix. Earlier surplus can
alter later funding; gifts included inside net-wallet gates can change admissible
opposite-side strategies. These are explicit limits, not a selected weaker
utility, budget, allocation or IR policy. Current-pot destination, full utility,
authentication, repeated epochs and LP principal/range behavior need the complete
mechanism proposal. Fixed external rewards added alongside variable LP surplus
would leave 6B's incentive failure intact.

**6C was committed by the user as `8517538`; the tree was clean before 7A.** The report lists the twelve files and short
commit title/body. After confirmation, use this proposal to define the complete
asset/curve/utility and redistribution contract, and narrow adoption decisions
with the user when they change support or funding scope. Keep the original
paper-guarantee priority, G1–G4, measured verification, independent review and
concentrated integration requirements. Do not deploy a calendar or mark step 6
complete from its conditional arithmetic evidence.

## Checkpoint 7A: safe wallet binding, signing and individual recovery

See [the wallet checkpoint report](./CHECKPOINT_7A.md). This independent safety
slice proceeds while G1–G4 remain unresolved. It replaces stale v1 signing with
the actual v2 schema, checks deployment fingerprints/wiring/domain/asset metadata,
reads real nonce words, confirms receipts and admission events, and exposes stored
epoch recovery and separate funded claims. Historical deployment references and
fixtures are labeled accordingly; overclaimed truthfulness/IR and legacy capacity
figures are corrected in the source dashboard.

**7A was committed by the user as `2c24344`; the tree was clean before 8A.**
The report retains its files and suggested title/body. No new mechanism, treasury,
calendar, fractional asset, deployment or
contract policy was selected. The default manifest is null, so the wallet cannot
write to the old stack. Step 7 still requires real contract-wallet flows, persistent
transaction/indexer/reorg handling, LP exit UX and end-to-end testnet execution
after the relevant mechanism/concentrated gates. Continue guarantee-preserving
asset/curve/utility design and independent review; do not treat UI migration as
evidence that G1–G4 or concentrated trading are resolved.

## Checkpoint 8A: independent review packet and research grant scope

The [review brief](./MECHANISM_REVIEW_BRIEF.md) turns the existing evidence into
specific G1–G4 questions and requested review deliverables. The selected baseline
is the user-created wallet commit `2c24344`; 212 evidence files include all seven
research fixtures and 85 imported vendor Solidity sources. A read-only SHA256
verifier works on the repository or an equivalent archive without Git metadata.
Hashes identify content; they do not certify a theorem, audit or deployment.

The [research grant draft](./GRANT_RESEARCH_SCOPE.md) defines a provisional
eight-week research sequence, measurable artifacts, go/no-go criteria and a budget
worksheet. Team capacity, reviewer quotes, requested amount and program terms need
factual confirmation before submission. A qualified negative result is a useful
research outcome; it is not permission to ship a weaker rule. No funding agreement,
independent review, external contact, upload or application occurred.

Fresh checks reproduce the existing solver/fixture evidence and targeted real-core,
cash and authentic historical ownership tests. No contract, solver, wallet,
dependency, saved economic fixture, deployment or benchmark changed.
**8A was committed by the user as `149db34`; the tree was clean before 4I.**
[Its report](./CHECKPOINT_8A.md) lists the
exact files, validation and suggested message. Step 8 remains incomplete, as do
G1–G4 and the gated concentrated/canonical integrations.

After the commit, continue the complete asset/curve/utility design against the
review questions. Do not contact a reviewer or submit/share this packet without
the user's explicit authorization for that external action. An eventual proposal
must identify any incompatible product requirements and their consequences before
requesting a change to the user's selected guarantee priority.

## Checkpoint 4I: enforce both-side signed minima without choosing a new rule

The legacy minority spot floor could be below an order's signed whole-output
minimum. [The safety patch](./CHECKPOINT_4I.md) rejects that outcome before any
escrow release/swap/payout, preserving the stored order, opening snapshot and
independent timeout refunds. It neither tops up the minority payment nor changes
its eligibility/allocation. Valid floors still settle, including the raw zero-ask
domain. Broader R6 interval/tie/liveness questions, R2 and G1–G4 remain unresolved.

This bounded safety work is authorized independently of adopting a mechanism.
Actual book/vault/hook/settlement regressions cover both directions, native ETH,
18/6-decimal ERC20s, zero/nonzero underpayments, signed-price boundaries, original
record indices and full uint96 budgets. The original grant-review reproduction
now asserts rejection and stored recovery. Dashboard/review claims distinguish
the local minimum-output check from complete integer incentive guarantees.

The 8A evidence manifest is unchanged and still identifies its original baseline.
A separate 4I content snapshot covers the post-patch sources and tests; a changed
hash against the old manifest is expected, not hidden. **4I was committed by the
user as `6cf5348`; the tree was clean before 4J.** Its report lists the exact files,
fresh validation and suggested message.
After the commit, continue the complete asset/curve/utility design and canonical
verification; do not treat safe rejection/refunds as a guarantee of useful fills.

## Checkpoint 4J: reject unsafe legacy candidates in the offline preflight

[The checker checkpoint](./CHECKPOINT_4J.md) removes the solver's false-positive
acceptance of minority underpayment and forged crossing diagnostics. `selfCheck`
delegates to a bounded current-rule arithmetic check over the actual order and
outcome arrays. It validates full minority fills, exact spot floors, both-side
signed minima, zero ineligible minority fills, and dominant feasibility. It
ignores diagnostic metadata and rejects unsupported unsigned/count/aggregate
inputs before arithmetic. Real settlement comparisons retain original record
indices and independent full-budget recovery.

This does not change production Solidity, the legacy generator's allocation or
payments, eligibility, direction policy, ties, assets, rewards or useful-fill
guarantees. An OK arithmetic verdict is not order/snapshot authentication,
actual-swap fundability, canonicality, or a proof under G1–G4. Feasible zero
proposals and the generator's known dust/tie failures remain explicit.

The old manifests remain frozen. A separate 4J snapshot identifies the new
selected bytes and local reference bridge. **4J was committed by the user as
`2404cce`; the tree was clean before 7B.**
Its report contains the exact handoff and fresh checks. Continue the complete
asset/curve/utility and canonical-verification work only after confirmation;
do not treat this preflight as a selected mechanism or deployment readiness.

## Checkpoint 7B: owner LP exits and independent vault-credit withdrawals

[The wallet exit checkpoint](./CHECKPOINT_7B.md) adds manual position-ID inspection,
irrevocable owner exit requests, idle-pool processing and separate principal/core
fee credit withdrawals. Current pool activity comes from `isBatchActive`, not an
expired local timer. Each action rechecks ownership, pool, reservation and wallet
session; request/processing confirmations require a matching vault event. Related
position reads share the deployment-check block. The manifest also checks the
vault's immutable book wiring before any wallet action.

The existing contract policy remains: a queued request cannot be cancelled or
specify token-output minima; current settlement can change the withdrawn principal.
The UI makes that decision explicit. Processing credits the owner, and asset
withdrawal is separate, with uint120 chunks for large vault balances. Native/ERC20
claims are distinct from trader and Otter reward claims. The default manifest is
still null. No Solidity, mechanism rule, fixture, deployment or dependency changed.

This completes a bounded local LP exit interface, not step 7. Deposits, automated
position discovery/queue processing, persistent transaction recovery/indexing,
reorg handling, actual contract-wallet flows, concentrated auction execution and
end-to-end testnet evidence remain. G1–G4 and the guarantee priority are unchanged.
**7B was committed by the user as `d76b12c`; the tree was clean before 7C.** Its report gives the exact files, fresh tests,
synthetic interface checks and handoff. The new evidence selection includes the
wallet source/config/test closure; earlier manifests remain immutable.

## Checkpoint 7C: local transaction history and read-only receipt recovery

[The history checkpoint](./CHECKPOINT_7C.md) preserves returned broadcast hashes
and expected intent hashes across browser reloads. History is bounded, separated
by wallet/deployment, and never saves reusable signatures. Unavailable, corrupt
or full storage blocks new broadcasts; a failure after sending exposes the hash
without retrying. Receipt inspection has no wallet write methods. It distinguishes
unresolved receipts, reverts and changed intents, checks current returned block
metadata, and recovers admission IDs only from one matching event. Account or
history changes invalidate outstanding displayed inspection results.

This completes a bounded local recovery slice, not a durable indexer or step 7.
RPC trust, later reorgs, replacement discovery after interruption, broadcasts
interrupted before returning their hash, browser storage loss, cross-tab action
coordination and actual connector/testnet evidence remain. LP deposits/discovery
and concentrated auction execution remain open. G1–G4 and the priority to preserve
the paper's guarantees are unchanged; no new rule, utility or asset is selected.
**7C was committed by the user as `0e5b727`; the tree was clean before 4K.** Its report contains fresh wallet/build/browser
checks and the handoff. A new selected snapshot covers the history code; earlier
manifests retain their recorded bytes.

## Checkpoint 4K: bounded raw-core state collection at one block hash

[The reader checkpoint](./CHECKPOINT_4K.md) removes manual bitmap/tick-map assembly
for a single exact-input quote. A read-only RPC callback selects one block and
checks chain and caller-configured manager bytecode. Code and storage queries
require that block hash and canonicality; missing/malformed data or a detected
chain/block change fails. Header, signed bitmap/tick keys, liquidity and stored
boundary ticks match the pinned core layout. Collection is demand-driven and
bounded to 82 storage calls. Numerical quote math and supported statuses are
unchanged; unsupported prefixes do not become usable output budgets.

Fresh mocked-RPC and real local-core comparisons cover native ETH, concentrated
gaps, exact boundaries, empty words, domain/traversal limits and failure paths.
This is a state-preparation slice, not a production provider/indexer, ownership
proof, complete counterfactual curve or authenticated concentrated epoch. Actual
provider and testnet evidence remain; concentrated auction gates remain closed.
The legacy allocation/payment rule, G1–G4 and the priority to preserve the paper's
guarantees are unchanged. No new asset, utility, subsidy or weaker rule is selected.

**4K was committed by the user as `71504c7`; the tree was clean before 4L.** Its report lists fresh checks and the exact
handoff. A new selected-content snapshot adds reader/test sources; old manifests
remain frozen and identify their earlier bytes. Next, bind a complete supported
finite execution domain to the opening ownership/epoch records under G2/G3,
together with a compatible mechanism under G1/G4; do not infer auction correctness
from a correct isolated quote.

## Checkpoint 4L: exhaustive small execution prefixes from one shared state

[The curve checkpoint](./CHECKPOINT_4L.md) collects every integer raw input in
one or both declared 0–64 prefixes, retaining the opening state for every
alternative. Both directions share one block/code check and demand-driven
storage cache. Up to 130 points and 162 storage reads are allowed; per-quote
word/crossing/step bounds and statuses remain unchanged. Partial consumption and
unsupported rows stay explicit rather than becoming interpolated output budgets.
A missing record or detected block change aborts the whole collection.

Fresh mocked-RPC and actual local-core tests compare every point, including native
ETH, concentrated gaps, exact boundaries, opposite-direction cache limits and
the existing transfer witness's full raw fill menu. Foundry restores opening
state before each alternative. This supplies bounded research data, not a
production trade-size policy or a canonical outcome. Larger original budgets,
complete counterfactual/ownership/epoch binding and the mechanism remain open.
The current allocation/payment rule, asset/utility, concentrated gate and G1–G4
are unchanged. No weaker guarantee or replacement rule is selected.

**4L was committed by the user as `e4cdfb1`; the tree was clean before 4M.** Its report contains the exact handoff and
fresh tests. A new 278-file snapshot records the changed reader/test closure;
older manifests stay frozen. Next specify complete original-domain/epoch
authentication and verifier obligations under G2/G3 together with a compatible
G1/G4 mechanism, rather than using these small tables to declare the auction
or grant qualification complete.

## Checkpoint 4M: full-range opening-record content and curve binding

[The binding checkpoint](./CHECKPOINT_4M.md) adds a pure validator, without a
network adapter or wallet integration. It compares a caller-authenticated anchor
with the book's exact v2 commitment, complete bounded roster and capital weights.
It checks the execution header, deterministic full-range sparse tick schedule and
every field of every bounded curve row, then returns frozen primitive metadata
and a normalized curve-content hash. A self-invented anchor supplies no proof of
ownership or runtime authenticity; an old valid binding supplies no permission
to execute today. Partial/unsupported quotes remain explicit.

Fresh evidence: 88 Node groups, TypeScript/production build, six real book/vault/
core binding tests with 64 fuzz cases, and 30 snapshot/reward regressions with
64 snapshot-drift fuzz cases. Local tests compare exact commitments and oracle
curves, including native epochs, the 32-position bound, repeated owners,
zero-weight positions, queued exits and changed live state after expiry/exit.
Transport/block metadata are synthetic; this slice runs no alternative swaps.
No production Solidity, rule, asset/utility, saved economic evidence or gate
changes. G1–G4 and concentrated epoch integration remain open.

**4M was committed by the user as `c3cccc6`; the tree was clean before 4N.** Its report lists the exact 14-file handoff.
The separate 282-file manifest adds four binding/test files; older manifests
remain frozen. Next define and test authenticated same-block book/guard/hook
collection and current lifecycle checks, then complete original-domain verifier
and mechanism obligations. Content equality does not establish grant readiness.

## Checkpoint 4N: pinned full-range epoch collection and current eligibility

[The collector checkpoint](./CHECKPOINT_4N.md) obtains the stored opening record,
its commitment and bounded curves through a caller-supplied read-only RPC at one
block hash. It checks five configured runtime fingerprints, contract wiring,
registration/version/policy, book/vault assertions and current epoch lifecycle.
Collection requires a nonterminal, unconsumed closed window and the intended
caller's eligibility under existing solver exclusivity. All state queries use
canonical hash selectors; detected block/timestamp/chain drift aborts, without
fallback/retry. Roster arrays and the fixed 36-view plan are bounded. Existing
curve bounds supply a 212-RPC-operation upper bound, not a latency/cost benchmark.

Fresh validation: 101 Node groups, TypeScript/production build and 13 local
book/core tests with two 64-case fuzz groups. Seven new contract tests export
actual staticcall replies and runtimes, including native/public-window boundaries,
queued exits, 32 positions and collecting/expired/refundable/live-drift rejection.
The transport/block hash are synthetic. Epoch timing and content validation are
not complete order authentication, canonical allocation/payments or future
settlement guarantees. Source UI/wallet ABI/manifest, production Solidity,
assets/utility/rules, saved research and G1–G4 remain unchanged.

**4N was committed by the user as `e9eecb5`; the tree was clean before 4O.** Its report lists the exact historical 14-file handoff.
The separate 285-file manifest adds the collector, Node tests and bridge; earlier
manifests stay frozen. Next bind complete stored orders/digest/escrow obligations
and original counterfactual domains to this context, then meet G1–G4's mechanism
and verifier requirements. Concentrated epoch integration and independent review
remain necessary; no grant qualification or live deployment is claimed.

## Checkpoint 4O: complete stored-batch binding and shared custody coverage

[The batch checkpoint](./CHECKPOINT_4O.md) extends pinned full-range epoch
collection with the complete stored order sequence, original side budgets,
rolling digest and v2 signing domain/type. It checks admitted bounds, identities,
unique trader/nonces, execution validity, unrecovered flags and nonce bits, then
requires actual book replay. Expired admission deadlines do not invalidate an
admitted batch. Each native/ERC20 book balance must cover shared global escrow
plus claims; escrow must cover this batch rather than equal it. Every added read
uses the same canonical hash selector, with a final metadata recheck. The bound
is 288 operations, not a latency or capacity benchmark.

Configured code/RPC remain trusted. Historical signatures are not retained or
revalidated, and current balance coverage does not prove future token behavior.
Immutable normalized orders and batch metadata do not freeze existing frames.
Original uint96 budgets remain intact; the unchanged 0–64 prefixes provide no
complete original-budget/counterfactual proof. Production Solidity, numerical
rules, wallet UI/ABI/configuration, asset/utility and G1–G4 remain unchanged.

Fresh validation: 114 Node groups, TypeScript/production build and 20 actual
local book/core tests with three 64-case fuzz groups. Added contract cases cover
mixed/native orders, expired admission deadlines, 32 orders, maximum fields,
shared-pool escrow plus prior claims and a custody shortfall. Transport/block
hash remain synthetic. No new full solver, broad contract suite, economic
benchmark, live provider or wallet evidence is claimed.

**4O was committed by the user as `c644c32`; the tree was clean before 4P.** Its report records fresh validation and the
exact 16-file handoff. The separate 288-file content snapshot retains the 4N
selection plus three batch/test/fixture files; earlier manifests stay frozen.
Next specify full original-domain coverage and canonical witness obligations
alongside a compatible G1/G4 mechanism. Concentrated integration, independent
review and grant evidence remain necessary; no replacement rule is selected.

## Checkpoint 4P: original-prefix coverage and explicit removal inventories

[The coverage checkpoint](./CHECKPOINT_4P.md) revalidates opening/batch content
against the 4O binding before comparing complete original summed side budgets
with the captured tables. It distinguishes missing inputs, unsupported rows and
supported partial consumption, preserving original signed quantities. The
original batch and every record/address omission have exact retained-order hashes
and remaining budget inventories; these are hypotheses, not a participant policy
or computed pivots. A pure guard refuses incomplete data for whole-input research
and evaluates the content again rather than trusting a saved report flag.

Fresh validation: 126 Node groups including 64 seeded independent inventories,
TypeScript/production build and 27 local contract tests with four 64-case fuzz
groups. Seven new contract tests compare actual order/removal/budget inventories
and unsupported/partial/missing classifications with the independent oracle.
They include native custody, maximum original budgets and incomplete aggregates
whose individual records fit the prefix. Transport/block hashes remain synthetic.
No new solver/broad contract/benchmark/provider/wallet run is claimed.

**4P was committed by the user as `14044fe`; the tree was clean before 4Q.**
Its report lists the exact historical 15-file handoff.
A separate 291-file snapshot retains 4O evidence and adds the inspector, tests and
[original-domain requirements](./ORIGINAL_DOMAIN_REQUIREMENTS.md). Earlier
manifests remain frozen. Complete scalable original-domain computation, a selected
participant/utility model, canonical allocation/payments, measured accepted
verification and G1–G4 remain unresolved. Next use these explicit obligations
to test a compatible mechanism rather than equating complete small prefixes
with economic correctness. Concentrated auction integration and independent
review remain necessary; no rule, asset/valuation or weaker guarantee is selected.

## Checkpoint 4Q: stored-batch original-domain pivot diagnostics

[The bound research checkpoint](./CHECKPOINT_4Q.md) requires complete original
prefixes before evaluating the existing one-sided linear-welfare hypothesis on
actual stored quantities. Every original/record/address removal uses the same
original table and agrees between independent scan and Cartesian optimizers.
Mixed batches, excess records, incomplete/unsupported/partial prefixes and excess
exhaustive work fail without narrowing inputs. Exact pivot numerators, whole-unit
floor/ceil/minimum checks, unspent inputs and signed deficits remain explicit.

Actual book/core outputs expose a split-record funding deficit. Grouping addresses
changes that result, but distinct traders still have a deficit. A second actual
witness shows that a funded grouped payment cannot cover the sum of original
signed per-record minima. No group-payment distribution or replacement participant
policy is selected; aggregate IR cannot silently replace original delivery checks.
The bounded hypothesis leaves the user's requested guarantees as open research.

Fresh validation: 137 Node groups with 64 seeded independent bound cases,
TypeScript/production build, 17 existing discrete research groups, and 34 local
contract tests with five 64-case fuzz groups. Solidity independently enumerates
every retained vector and derives all payments and diagnostics from actual
orders/oracle outputs. Transport/block hashes remain synthetic. No fresh broad
contract suite, benchmark, provider, wallet or production mechanism is claimed.

**4Q was committed by the user as `ff2718d`; the tree was clean before 4R.**
Its report lists the exact historical 16-file handoff.
The separate 293-file snapshot adds the bound adapter and Node tests while
retaining the frozen 4P selection. Earlier manifests stay byte-for-byte frozen.
Next investigate conditions that preserve original per-record delivery, useful
integer allocations, funding and the requested incentives together; do not
promote address grouping or restrict reports just because a small witness fits.
Complete scalable original-domain/two-sided verification, combined trader/LP
incentives, concentrated auction integration and independent review remain open.

## Checkpoint 4R: complete small-domain signed-minimum feasibility

[The minimum checkpoint](./CHECKPOINT_4R.md) distinguishes whether a fill can
receive any integer output payments meeting every original signed minimum from
whether a particular pivot rule is funded. For every original/removal input
quantity, dynamic programming and independent Cartesian enumeration agree on
the least sum of whole-unit per-record minima, preserving original quantities
and the full opening table. No grouped delivery or constrained welfare rule is
selected. A versioned hash binds the frozen calculation to fresh 4Q research.

Actual cases show no positive-output feasible vector for the positive-ask split
witness; merging changes delivery semantics. Zero-ask split fills remain feasible
despite pivot deficits. A native/core opening at tick -6000 shows that a feasible
vector at the same input can require higher exact report cost and lower welfare.
This exposes an allocation/delivery problem that payment rounding alone cannot
fix. Choosing report-dependent feasibility or a new optimization target would
still require its own incentive proof and user-approved mechanism decision.

Fresh validation: 148 Node groups with 64 independent seeded frontier cases,
TypeScript/production build and 41 local contract tests with six 64-case fuzz
groups. Every actual retained budget vector is checked against independent
oracle outputs. The exact handoff is recorded in the checkpoint report.
**4R is pending the user's commit.** Its 14-file handoff includes a separate
295-file snapshot adding the frontier inspector and Node tests; previous
manifests remain frozen. Next test the interaction between signed deliverability
and report-response incentives on authenticated complete small domains, while
retaining the paper's requested guarantees. Do not equate a funded fill or a
minimum-payout frontier with a compatible mechanism. Large original domains,
canonical two-sided verification, combined trader/LP incentives, concentrated
auction integration and independent review remain open under G1–G4.
