# Checkpoint 8A — mechanism review packet and research grant scope

Prepared 5 October 2026. Starting commit:
`2c2434476f48a6e96dbaef8f2051259c084e6d88`. The working tree was clean.
Status: **local packet verified; waiting for the user's commit**.

## Outcome

The next blocker is a complete compatible mechanism, not another wallet patch.
The prior evidence needs to be reviewed as a connected set of asset, curve,
utility and redistribution requirements before implementing canonical settlement.
This checkpoint makes that decision concrete and reproducible.

- [Independent review brief](./MECHANISM_REVIEW_BRIEF.md): current implementation
  status, the whole-payment and LP-cash witnesses, precision/residual-input,
  changing-price and auxiliary-reward limits, explicit G1–G4 questions, requested
  review outputs and a local runbook. Actual v4/cash tests, stubbed candidate
  integration, synthetic models and scoped analytical arguments are distinguished.
- [Research grant scope](./GRANT_RESEARCH_SCOPE.md): public contribution, candid
  production-readiness gaps, provisional research milestones, acceptance criteria,
  useful KPIs, budget inputs and submission requirements. It proposes funding
  research and tools; it does not promise a production hook before a compatible
  rule is established. Official funding/portfolio sources were checked on
  5 October; those pages do not guarantee Otter's eligibility or acceptance.
- [Evidence manifest](./EVIDENCE_MANIFEST.json): SHA256s of **212 baseline files**,
  including **85 imported vendor Solidity sources**, all seven research fixtures,
  solver sources/tests and supporting reports/configuration. Includes the actual
  baseline, nine recursive submodule pins and observed/configured tool versions.
  It excludes this packet, changing status documents, generated artifacts and
  unrelated/unlisted files, avoiding recursive self-hashes.
- [Read-only verifier](./verify_evidence.py): checks those selected bytes with no
  Git dependency; reports changed/missing files and rejects duplicate or unsafe
  relative paths. No network access, subprocess execution or source writes.
- README/spec/plan link the packet and record the user's completed 7A commit.
  The specification's stale “three gates” count is corrected to four.

The user’s requested guarantees and expanded asset/liquidity scope are unchanged.
No fractional asset, valuation grid, subsidy, current-pot destination, mechanism
or payment policy was selected. No reviewer was contacted, no application was
submitted and no repository content was uploaded. No production code, contract
test, solver, wallet, dependency, saved economic fixture, legacy web build,
deployment record or benchmark was changed.

## Validation

1. `solver/: npm test`: **129 groups passed**: eight legacy floating-point groups
   and 121 integer execution/research/reward groups. All seven saved research JSON
   fixtures byte-compare in their suites. This includes intentional reproductions
   of unsafe candidate behavior; passing them does not close a finding or gate.
2. The brief's transfer and reward-composition CLI commands regenerate their
   fixtures byte for byte into `/tmp`, with `cmp` success. Saved files are untouched.
3. The exact Forge command in the brief: **50 tests passed**, zero failed/skipped
   across seven selected suites. Covers 32 oracle/core/integration tests, one raw
   transfer-capacity test, two representation tests, one sequential cost-grid test,
   three reward-composition tests and 11 authentic historical-owner tests. Fuzz
   configuration is 512; three oracle fuzz tests also replayed a saved corpus case
   for 513 reported runs each. Candidate cash composition still uses a stubbed
   book; the historical ownership suite uses the actual integration.
4. Evidence verifier: all 212 repository files match. **Six isolated checks** pass:
   an equivalent full selected archive without Git metadata; detection of one
   changed source and one missing fixture; rejection of parent traversal, an
   escaping symlink and a duplicate path. Negative cases change only temporary
   copies. The verifier does not authenticate the unsigned manifest or evaluate
   safety, prove claims, run tests, or inspect unlisted content.
5. Local Markdown targets, normalized manifest paths/import closure, whitespace,
   exact handoff list, unchanged HEAD/empty index and preservation of production,
   fixture, dependency and generated artifacts checked at handoff.

Tool baseline: Node 24.10.0, Python 3.9.6, Forge 1.5.1; Foundry configuration uses
solc 0.8.26, Cancun, via-IR and optimizer 200. Existing dependencies/compiler only;
no install, live RPC, key or transaction. The large Foundry test gas ceiling is
not evidence of deployable transaction cost. Historical benchmark-writing suites
were not run. Web tests/build were not repeated because the wallet is unchanged.

Logs: `/tmp/otter-8a-solver.log`, `/tmp/otter-8a-forge.log`. CLI reproductions:
`/tmp/otter-8a-transfer-research.json`, `/tmp/otter-8a-reward-composition.json`.
Temporary files are not durable grant evidence; retain reviewed logs separately
when sharing an authorized packet.

## Material limits and next work

R2's noncanonical solver discretion and R6's minority dust IR defect remain.
G1–G4 are open. The independently reviewed complete rule, concentrated snapshot/
auction integration, deployable verification costs, real hardened testnet flows,
economic comparisons, reviewer quotes and final grant budget remain unfinished.
The manifest is provenance for selected bytes, not a signed attestation or audit.

After this commit, continue design and falsification against the review questions.
A change to asset representation, utility, valuation domain or guarantees needs
its consequences made explicit before a product decision. External reviewer
contact or grant submission requires the user's explicit authorization; a local
commit does not authorize either action. A research grant draft does not complete
step 8 or assert that the Foundation will fund this work.

## User-created commit handoff

Suggested title:

```text
docs: prepare mechanism review and research grant scope
```

Suggested explanation:

> Pin reproducible evidence and define G1–G4 review criteria. Draft research
> milestones, evaluation metrics and budget requirements without claiming
> production readiness or selecting a weaker mechanism.

The assistant has not staged or committed anything. Commit these **nine files**,
then confirm before work continues:

```text
README.md
reviews/CHECKPOINT_7A.md
reviews/CHECKPOINT_8A.md
reviews/EVIDENCE_MANIFEST.json
reviews/GRANT_RESEARCH_SCOPE.md
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
reviews/verify_evidence.py
```
