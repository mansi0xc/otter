# Checkpoint 4I — reject minority payouts below signed minima

Prepared 5 October 2026. Starting commit:
`149db343cf6d3e9c76151f14fd54668cbef26432`. The working tree was clean.
Status: **local safety patch verified; waiting for the user's commit**.

## Outcome

The legacy minority branch required a full-budget fill paid at the floored
opening spot. It did not compare that floor with the order's signed reservation
price. At a quarter-unit minority spot, spending one input unit could pay zero
despite a positive signed ask; spending five could pay one despite a signed
minimum of two. The dominant branch already rejected below-minimum payments.

Settlement now rejects an eligible minority's prescribed spot floor when it is
below `ceil(ask * budget / WAD)`, using `OtterMath.IndividualRationality` with the
original stored order index. The check follows the existing exact-fill rule and
precedes escrow release, swap, payout and reward funding. Authentication is still
the actual committed order sequence. Admission bounds `ask` to uint128 and
`budget` to uint96, so this additional product fits below `2^224` before division.

No payment is topped up, eligibility/allocation altered, or stored order omitted.
Reversion rolls back `consume` and retains full escrow, the opening snapshot and
admission nonces. If the batch cannot settle, the existing fixed execution
deadline enables permissionless expiry and independent stored-budget refunds.
Failed proposals do not introduce early-expiry discretion for a solver.

This closes **R6's accepted minority underpayment path**, not the complete R6
finding. Empty intervals, arrival/hash ties, canonical allocation/payments,
integer truthfulness and useful-fill liveness remain unresolved. R2 and G1–G4
remain open; safe rejection and refunds do not prove the paper's guarantees.
The old residual LP reward policy and concentrated auction gate are unchanged.

The original grant-review reproduction now asserts rejection and stored recovery.
New regressions use real book/vault/hook/settlement rather than a stub. They cover
both directions across native/6-decimal and 18/6-decimal ERC20 pairs; raw units
determine the signed floor regardless of metadata. The legacy allowance comments
no longer claim that a fixed formula is incentive-neutral or can shave an
accepted signed minimum. Its arithmetic is unchanged.

README, the dashboard, specification, plan and review/grant drafts describe this
local check and the remaining liveness/incentive limits. Published addresses,
the unconfigured wallet manifest and the tracked legacy web build remain as
before. No deployment, RPC transaction or external review/submission occurred.

## Validation

- **Before the fix:** the new zero-minority-payment regression failed because
  settlement did not revert. This independently reproduces the accepted
  underpayment with real custody and native/ERC20-compatible fixtures.
- **Targeted after the fix:** 28 tests passed across the initial eight new minimum
  regressions and the inherited grant-review settlement suite. Includes zero and
  nonzero underpayments, exact whole spot, a one-WAD-unit ask change crossing the
  ceiling, zero-ask compatibility, minority-first indices, dominant-side minimum
  preservation and 512 sampled boundary/recovery fuzz cases.
- **Final full contract run:** **312 tests passed**, zero failures/skips across
  35 suites, including all nine new minimum-output tests and 512 boundary/recovery
  fuzz cases. The earlier full run passed 311 tests; the final run includes the
  subsequently added explicit maximum-uint96-budget case and formatted test file.
- Rejected outcomes preserve closed/recoverable state, book asset backing,
  snapshot and actual pool price/tick/liquidity; no trader/reward credit appears.
  Stored refunds then deliver full budgets and reject a repeated recovery.
  Safe cases settle and satisfy independent exact-product minimum comparisons.
  The explicit maximum-budget case covers rejection at uint96 max and valid
  settlement at the neighboring exact multiple of four, for all four pair/direction
  variants. These are local tests, not a proof over every pool or deviation.
- `web/: npm test`: **21 offline wallet tests passed** against the current artifacts.
  `npm run build -- --outDir /tmp/otter-4i-web-dist`: TypeScript/production build
  passed. The existing large wallet-bundle warning remains; no dependency changes.
  This is a copy-only dashboard update, without a new live wallet/browser demo.
- The [4I content snapshot](./EVIDENCE_MANIFEST_4I.json) verifies **214 selected
  files**. It records the pre-patch baseline plus explicitly labeled local
  checkpoint bytes; it is not a claim that those bytes equal that Git commit.
  The previous [8A manifest](./EVIDENCE_MANIFEST.json) is unchanged and verifies
  its 212-file prior-baseline archive without Git metadata. Exactly three of its
  source files differ now: math comments, settlement and the grant-review test.
  The new snapshot additionally includes the new test and updated dashboard.
- New test formatting, whitespace, local Markdown targets, exact handoff list,
  unchanged HEAD/empty index and preserved research/benchmark/deployment/dependency
  artifacts checked before handoff. Solver research code/fixtures are unchanged;
  their fresh 129-group baseline from 8A is not rerun or claimed as a new result.

Commands, from `contracts/`:

```sh
forge test --offline --match-contract '^(OtterMinimumOutputTest|GrantReviewSettlementTest)$'
forge test --offline --no-match-contract 'GasCurveTest|SandwichHarness'
forge fmt --check test/OtterMinimumOutput.t.sol
```

Current content check, from the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4I.json
```

The verifier's default remains the frozen original manifest. Use it against the
original baseline/archive; three changed hashes are expected on this patched tree.
Hashes do not certify safety or prove the mechanism. No historical evidence is
rewritten to conceal the patch.

Logs: `/tmp/otter-4i-red.log`, `/tmp/otter-4i-targeted.log`,
`/tmp/otter-4i-forge.log`, `/tmp/otter-4i-final-forge.log`,
`/tmp/otter-4i-wallet.log`, `/tmp/otter-4i-build.log`. Node 24.10.0, Forge 1.5.1,
solc 0.8.26/Cancun/via-IR/optimizer 200; existing tools only. Benchmark-writing
suites are excluded and the large test-only gas ceiling is not deployment evidence.

## User-created commit handoff

Suggested title:

```text
fix: enforce minority signed minimum output
```

Suggested explanation:

> Reject rounded minority payouts below signed minima while preserving escrow
> and independent timeout refunds. Add both-direction native/ERC20 boundary and
> recovery regressions; update prototype claims and preserve evidence provenance.

The assistant has not staged or committed anything. Commit these **13 files**
and confirm before work continues:

```text
README.md
contracts/src/OtterMath.sol
contracts/src/OtterSettlement.sol
contracts/test/GrantReview.t.sol
contracts/test/OtterMinimumOutput.t.sol
reviews/CHECKPOINT_4I.md
reviews/CHECKPOINT_8A.md
reviews/EVIDENCE_MANIFEST_4I.json
reviews/GRANT_RESEARCH_SCOPE.md
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/src/components/HomePage.tsx
```
