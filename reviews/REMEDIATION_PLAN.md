# Otter remediation plan

Prepared 2 October 2026 from [the grant readiness review](./GRANT_READINESS_REVIEW_2026-10-02.md).
Starting revision: `6c54695e1c7a534afa9f69ba8f08705a2a8a4830`.

The review supplies the findings and reproductions needed to begin. This plan supplies the implementation order, design gates, acceptance evidence, and user-created commit checkpoints. A separate full project-planning workflow is unnecessary at this stage.

## Commit protocol

The user creates every commit. The assistant must not create or amend a commit.

At each checkpoint:

1. Complete the scoped changes and appropriate validation.
2. Report the files to include, what was achieved, test results, and material limitations; provide a short suggested commit title/body.
3. Ask the user to create the commit and stop work at that checkpoint. Do not begin the next step or perform further edits while the commit is pending.
4. After the user confirms completion, inspect Git status and HEAD to establish the new baseline, then continue. Preserve unrelated changes.

Checkpoint 0 is ready now: commit the review, the reproduction tests, and this plan before implementation starts. The pre-existing untracked `contracts/CORRECTIONS.md 21-03-23-628.md` is unrelated to this checkpoint and must not be included automatically.

## Implementation sequence

Each numbered step ends in a user-created commit. If a step grows too large to review coherently, divide it into smaller validated checkpoints using the same protocol.

| Step | Scope and purpose | Acceptance evidence |
|---|---|---|
| 0 | Preserve the review and reproducible counterexamples | Existing review records 80 passing baseline contract tests, nine Solidity reproductions, solver checks, and successful web build; clearly label reproductions whose passing assertions demonstrate unsafe behavior |
| 1 | Define the implementation contract: integer mechanism, token semantics, supported numeric ranges, expiry, tie policy, recovery state machine, and surplus eligibility | A precise specification identifies enforceable guarantees and unresolved research questions; every review finding has a planned regression test and owning component |
| 2 | Replace unsafe deployment liquidity custody and enforce supported escrow-token behavior | An outsider cannot remove or collect another user's position; received escrow matches the credited amount; supported optional-return ERC20s work; unsupported semantics fail before commitment |
| 3 | Bound admission and deliver independent recovery with explicit expiry and LP exit behavior | An oversized batch cannot be admitted; one failed recipient does not prevent other claims; no double claim or settlement/refund overlap; economic completion and LP exits remain bounded during solver outages |
| 4 | Correct numerical handling in Solidity and the integer solver | Extreme asks classify safely; both sides satisfy specified integer IR; an empty payment interval is handled by the specified allocation rule; tied inputs follow the specified policy; oracle and Solidity agree at numeric boundaries |
| 5 | Enforce the prescribed allocation and payment rule in settlement | Incorrect feasible outcomes, zero-fill griefing, and solver underpayment are rejected; valid outcomes settle in both directions; fallback callers receive no weaker correctness checks; supported fees and actual swap deltas are handled |
| 6 | Replace captureable donation rewards with the specified historical LP/community distribution | Newly added liquidity cannot claim past surplus; prior eligible LPs retain their entitlement after exit; same-transaction flushes cannot bypass eligibility; bidder/solver/LP overlap is explicitly tested |
| 7 | Make testnet operation and wallet flows usable | Live solving and independent recovery are demonstrated; wallet state follows successful receipts; nonces work across bitmap words; batch IDs and claim/refund states appear correctly; outages and reorg handling are exercised |
| 8 | Produce reproducible economic evidence and a grant application package | Compare complete costs, execution, fill rates, latency, and LP returns; accurately describe demonstration data and guarantee limits; publish milestones, actual cost estimates, and independent-review scope |

## Design gates before implementation

Step 1 should resolve implementation choices using the codebase and documented tradeoffs. Ask the user only for decisions that change the intended product, asset support, or funding scope; routine engineering choices can be made within the authorized scope.

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

## Validation and regression discipline

- For each finding, retain the original reproduction in history and change the active regression to require the corrected behavior once its fix lands. A test that continues asserting an exploit succeeds is not evidence of a fix.
- Preserve the existing functional tests and add meaningful boundary and state-transition tests. Use independent small-domain optimization and exact arithmetic where it can detect shared mistakes between implementations.
- Test full sequences: submit, solve, settle, claim, expire, recover, liquidity exit, reward claim, and next batch. Include both trade directions, token callbacks, failed transfers, repeated calls, and cross-pool liabilities.
- Measure worst-case transaction resources under target-chain assumptions. Separate admission, settlement, claims, and approvals; include calldata and cold transaction behavior. Run benchmark generators deliberately because existing harness tests overwrite saved result files.
- Apply checks appropriate to each checkpoint. Do not repeatedly run broad suites without a change or unresolved concern that justifies them.
- Publish what is proven, what is tested, and what remains an assumption. An external contract review and a mechanism/economic review are separate deliverables.

## Checkpoint 0 commit handoff

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

Status: awaiting the user's checkpoint 0 commit. Implementation has not begun.
