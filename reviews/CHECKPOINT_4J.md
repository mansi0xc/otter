# Checkpoint 4J — bound and complete the legacy solver preflight

Prepared 5 October 2026. Starting commit:
`6cf5348ed40637c20479f30d338d45d2a2519d7a`. The working tree was clean.
Status: **committed by the user as `2404cce`; clean tree inspected before 7B**.

## Outcome and remaining limits

The prior `selfCheck` omitted minority outcomes from its verification and trusted
`out.diagnostics.dMinority` when constructing the crossing. It returned OK for
the now-rejected minority dust underpayment and for an outcome with missing
dominant funding concealed by a false diagnostic total. The saved before-check
log reproduces those false positives against the committed baseline.

`selfCheck` now delegates to `checkLegacyOutcome` in
[`settlement-check.ts`](../solver/src/settlement-check.ts). The checker uses only
the supplied reserve pair, actual orders, direction and fill/output arrays. It
classifies minority records before running the unchanged dominant verifier,
matching the current settlement's arithmetic check order for admitted numeric
inputs. It requires zero fill/output for an ineligible minority, exact full
budget and floored spot output for an eligible minority, and its signed ceiling.
It derives crossing from eligible minority budgets rather than metadata. Error
indices refer to original stored positions, including a minority at index zero.

Length mismatches and unsupported numeric inputs fail before arithmetic:

- 1–32 orders; Boolean direction fields; BigInt raw monetary values.
- Positive reserves at most `2^120 - 1`, a superset of positive virtual reserves
  under the admitted `2^64 <= sqrtPriceX96 < 2^128` and liquidity `< 2^88` bounds.
- Ask at most uint128, positive budget at most uint96, and per-side total budgets
  at most uint96. Proposed fill/output values must be uint256.

This is an arithmetic support envelope, not authentication of a synthetic
reserve pair as a real pool. Within it, eligibility products are below `2^248`,
ask/fill products below `2^224`, reserve products below `2^240`, and reserve/budget
products below `2^216`. Dominant fills exceeding their budgets fail before their
products. Dominance rejects `M > totalIn` before augmented-curve evaluation;
thus later curve products use `M <= totalIn <= uint96 max`. Large BigInt values
cannot silently acquire an OK verdict outside that supported input domain.
The standalone unrestricted `fixed.ts` helpers are unchanged; this does not
claim EVM equivalence for arbitrary callers of those helpers outside the envelope.

Codes 0–6 retain the existing dominant mapping. New codes are 7 (length), 8
(unsupported numeric domain/count/aggregate), 9 (filled ineligible minority),
and 10 (wrong minority fill or floor). Shape/domain failures are preflight-only
diagnostics; they do not claim to reproduce the revert sequence for invalid
signatures, unsupported pool state or values excluded at admission/ABI encoding.

Diagnostics, clamp displacement and claimed burn are ignored; these fields are
absent from the actual contract outcome ABI. Returned successful totals/burn
describe the dominant legacy model, not realised swap surplus. No metadata can
change which economic vector is checked.

An OK result establishes **offline current-rule arithmetic feasibility only**.
It does not authenticate identity/signatures/configuration/order commitments,
clocks, snapshot or fees; model actual finite execution, partial consumption or
asset delivery; or enforce canonical direction, allocation and pivot payments.
Feasible inefficient zero proposals still pass (R2). `solveExact` still generates
known rejected dust outcomes and arrival-dependent ties. Its numerical behavior,
original utility/type/asset targets, eligibility, payment/allocation rule, legacy
allowance, production Solidity and rewards remain unchanged. No repair, subsidy,
order dropping, new mechanism or weaker guarantee was selected. R2, the remaining
R6 issues, concentrated auction support and G1–G4 remain open.

Source comments remove the obsolete promise that every generated candidate
settles unchanged and the historical 630-order capacity claim. The current
admission bound is 32; it does not establish future canonical-verifier capacity.
The existing demo generator already checks `selfCheck` before writing its file.
No public/live solver, deployment, RPC transaction, external contact or grant
submission is introduced.

## Validation and provenance

- **152 solver groups passed** in `npm test`: the previous 129 plus 23 new
  preflight groups. Eight historical float groups are reference coverage, not
  redesigned-mechanism proof evidence. The seven saved research fixtures remain
  byte-identical through the existing tests.
- New tests cover both orientations and original record positions, minority
  exact-fill/floor/minimum boundaries, ineligible outputs, diagnostic poisoning,
  dominant error checks/ordering, array holes/lengths, negative/non-BigInt/width
  rejection, count and side-aggregate limits, zero asks and uint96 maxima.
  Small budgets 1–64 use independent signed-product inequalities; 512 seeded
  BigInt samples exercise full-width budget boundaries. A final targeted run of
  the same 23 groups also passes the added positive-fill maximum-reserve product,
  maximum-ask eligibility and large-crossing dominance cases.
- **38 targeted contract tests passed**, zero failures/skips across four suites.
  The minimum suite now has 14 tests, including five new integration tests and
  its existing 512 recovery fuzz cases. A live local Node bridge compares the
  new checker with actual book/vault/hook/settlement in **78 deterministic cases**.
  Comparisons include both directions, native/6-decimal and 18/6-decimal ERC20
  pairs, reordered minority positions, floor/minimum boundaries, wrong fills,
  over/underpayments, ineligibility, missing dominant crossing funding and check
  priority. Full revert payloads, unchanged escrow/pool/snapshot, then independent
  complete stored refunds are checked after rejected proposals. Safe proposals
  settle and deliver claims. The 512 contract fuzz cases do not invoke FFI; the
  512 separate Node samples are not claimed as matched identical fuzz inputs.
- The original 150 saved dominant verifier vectors still match Solidity full
  revert payloads. The saved solver demo still settles in the three existing
  end-to-end tests. Regenerating the demo to `/tmp/otter-4j-demo.json` compares
  byte-identically with the tracked fixture; it is not rewritten.
- `npm run exact`: 3,000 historical mid-scale batches passed preflight, 741 with
  partial fills (24.7%), maximum reported clamp 232 raw units. Its floating-point
  random scaling does not make this an exact domain or incentive proof.
  `test/grant-review.ts` still reproduces the generator's rejected dominant dust
  and arrival ties, and the unrestricted BigInt/uint256 overflow distinction.
- The local CLI bridge only parses decimal integer/Boolean arguments and emits
  seven static ABI words. Malformed requests fail without emitting an ABI result.
  It has no file writes, RPC, signing or transaction submission.
- [The separate 4J snapshot](./EVIDENCE_MANIFEST_4J.json) verifies **217 selected
  files**, the previous 214 plus the checker, CLI bridge and solver test. Its
  baseline is the pre-checkpoint commit; hashes identify explicitly labeled local
  checkpoint bytes, not a claim that they equal that commit. Both earlier
  manifests remain frozen. Exactly four previously selected files differ from 4I:
  the minimum-output test, solver package script, legacy solver and historical
  solver-test comments. The frozen 4I manifest still verifies its 214-file
  baseline archive without Git metadata. Hashes are not a safety certification.
- Test formatting, whitespace, local Markdown targets, exact handoff list,
  unchanged HEAD/empty index and preservation of production contracts, economic
  fixtures, benchmark/deployment/dependency artifacts are checked before handoff.
  No wallet/source/build changed, so no fresh wallet test or web build is claimed.
  The broad 312-test 4I contract result is historical; this checkpoint runs the
  affected suites rather than relabeling it as a fresh full result.

Commands from `solver/`:

```sh
npm test
npm run test:settlement-check
npm run exact
node --experimental-strip-types test/grant-review.ts
node --experimental-strip-types src/demo-cli.ts /tmp/otter-4j-demo.json
cmp ../fixtures/demo-batch.json /tmp/otter-4j-demo.json
```

Commands from `contracts/`, one Forge job at a time:

```sh
forge test --offline --match-contract '^(OtterMinimumOutputTest|GrantReviewSettlementTest|CrossCheckTest|SolverEndToEndTest)$'
forge fmt --check test/OtterMinimumOutput.t.sol
```

Content check from the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4J.json
```

Logs: `/tmp/otter-4j-before.log`, `/tmp/otter-4j-solver.log`,
`/tmp/otter-4j-boundaries.log`, `/tmp/otter-4j-contract.log`,
`/tmp/otter-4j-exact.log`, `/tmp/otter-4j-demo.log`,
`/tmp/otter-4j-repros.log`, `/tmp/otter-4j-handoff.log`.
Existing Node 24.10.0, Forge 1.5.1, solc 0.8.26/Cancun/via-IR/optimizer 200;
no dependencies installed or pins changed. Benchmark-writing suites are excluded.

## User-created commit handoff

Suggested title:

```text
fix: validate complete legacy solver outcomes
```

Suggested explanation:

> Check minority fills and signed minima, derive crossing totals from orders,
> and reject unsupported numeric inputs. Add real-settlement comparisons and
> recovery regressions; preserve the legacy rule and document preflight limits.

The assistant has not staged or committed anything. Commit these **15 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterMinimumOutput.t.sol
reviews/CHECKPOINT_4I.md
reviews/CHECKPOINT_4J.md
reviews/EVIDENCE_MANIFEST_4J.json
reviews/GRANT_RESEARCH_SCOPE.md
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
solver/package.json
solver/src/exact.ts
solver/src/settlement-check-cli.ts
solver/src/settlement-check.ts
solver/test/exact.ts
solver/test/settlement-check.ts
```
