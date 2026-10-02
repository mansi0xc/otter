# Otter remediation plan

Prepared 2 October 2026 from [the grant readiness review](./GRANT_READINESS_REVIEW_2026-10-02.md).
Starting revision: `6c54695e1c7a534afa9f69ba8f08705a2a8a4830`.

The review supplies the findings and reproductions needed to begin. This plan supplies the implementation order, design gates, acceptance evidence, and user-created commit checkpoints. A separate full project-planning workflow is unnecessary at this stage.

User-selected scope: **expand asset and liquidity support now**, including direct native ETH and concentrated liquidity. These are part of the remediation rather than deferred follow-ups. [The v2 implementation specification](./IMPLEMENTATION_SPEC.md) records the selected custody, recovery, liquidity, and execution rules, together with the numerical research gates.

## Commit protocol

The user creates every commit. The assistant must not create or amend a commit.

At each checkpoint:

1. Complete the scoped changes and appropriate validation.
2. Report the files to include, what was achieved, test results, and material limitations; provide a short suggested commit title/body.
3. Ask the user to create the commit and stop work at that checkpoint. Do not begin the next step or perform further edits while the commit is pending.
4. After the user confirms completion, inspect Git status and HEAD to establish the new baseline, then continue. Preserve unrelated changes.

Checkpoint 0 is complete in the user's commit `63ec94e`. The user's commit also includes their corrections document; preserve it. Checkpoint 1 is complete in the user's commit `a7637a9`, and checkpoint 2A in `bc79d64`. Step 2 is split into reviewable code checkpoints: 2A for LP custody/integration, then 2B for trader native/ERC20 escrow. Do not proceed past either pending user commit.

## Implementation sequence

Each numbered step ends in a user-created commit. If a step grows too large to review coherently, divide it into smaller validated checkpoints using the same protocol.

| Step | Scope and purpose | Acceptance evidence |
|---|---|---|
| 0 | Preserve the review and reproducible counterexamples | Existing review records 80 passing baseline contract tests, nine Solidity reproductions, solver checks, and successful web build; clearly label reproductions whose passing assertions demonstrate unsafe behavior |
| 1 | Define the implementation contract: native/ERC20 semantics, concentrated execution, numeric limits, expiry, ties, recovery, historical rewards, and discrete mechanism gates | A precise specification identifies enforceable guarantees and unresolved research questions; every review finding and expanded support requirement has regression ownership |
| 2 | Replace unsafe deployment custody with an authenticated range-position vault and native/ERC20 escrow | An outsider cannot remove or collect another user's position; full-range and concentrated deposits enforce ownership/slippage; ETH value and received ERC20 escrow match credited amounts; optional-return tokens work |
| 3 | Bound admission and deliver independent recovery with explicit expiry and queued LP exits | An oversized batch cannot be admitted; blocked ERC20/ETH recipients do not veto finalization or unrelated claims; no double claim or settlement/refund overlap; exits precede next admission after settlement or expiry |
| 4 | Implement the exact tick-aware execution oracle and correct arithmetic in Solidity/BigInt; resolve the discrete rule | Match real PoolManager input/output and final state through ticks, empty words, gaps, and price limits; domain boundaries agree; both-side integer IR, empty intervals, ties, and finite capacity have a complete tested rule |
| 5 | Enforce canonical allocation and payments after specification gates G1–G3 pass | Reject incorrect feasible vectors, noncanonical zero fills, and solver underpayment; settle both directions and native pairs with actual deltas; callers have identical checks; fee drift retains recovery |
| 6 | Replace captureable donations with snapshot ownership and capital-weighted historical rewards | New liquidity gets no past surplus; prior owners retain claims after exit; different ranges use specified weights; same-transaction claims cannot bypass eligibility; strategic LP overlap and rounding are evaluated |
| 7 | Make expanded testnet and wallet flows usable | Live native/ERC20 and concentrated batches, independent recovery, and LP exit processing are demonstrated; receipt-based wallet state, EIP-1271, multiword nonces, epoch/claim display, outages, and reorgs work |
| 8 | Produce reproducible economic evidence and a grant application package | Compare all-in costs, execution, fills, latency, and LP returns across ranges; accurately distinguish proof/test assumptions and demo data; estimate expanded engineering/review costs rather than reuse the original timing guess |

## Design gates before implementation

Step 1 should resolve implementation choices using the codebase and documented tradeoffs. Ask the user only for decisions that change the intended product, asset support, or funding scope; routine engineering choices can be made within the authorized scope.

That product-scope decision is now recorded: native ETH and concentrated liquidity are included. The implementation specification selects a dedicated vault compatible with the pinned core, stored independent claims, a fixed execution window, permissionless canonical settlement, and capital-weighted historical LP rewards. Its engineering limits are provisional until measured. Its G1–G3 gates distinguish the unresolved discrete mechanism, concentrated-curve assumptions, and affordable verification. Safety work may proceed while those are researched; canonical settlement cannot be declared finished without resolving them.

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
no deployment has been performed.

R4's recipient veto regression now asserts independent claims. R9's zero-fee
policy and complete-input rejection are tested, but supported partial execution
and the exact tick-aware quote remain pending. R3 still reproduces oversized
atomic timeout replay. Step 3 begins only after the user commits 2B.
