# Checkpoint 4P — original-prefix coverage and explicit removal inventories

Prepared 6 October 2026. Starting commit:
`c644c321cdecb66bd1b1d6ec2c905b1e2cb488b0`. The working tree was clean.
Status: **committed by the user as `14044fe`; the tree was clean before 4Q**.

## Outcome

[The new pure inspector](../web/src/protocol/batchCoverage.ts) makes the
original-budget coverage gap machine-checkable. Complete stored-batch content
from 4O does not mean a small curve prefix covers the original feasible input
domain. This checkpoint preserves original quantities and exposes that gap
before experiments which assume complete requested input. It supplies no new
allocation/payment rule, pivot computation or incentive proof.

`inspectOpeningPrefixCoverage(anchor, record, frame, orders)` requires a caller-
authenticated 4O batch binding. It revalidates the mutable opening record/frame
with the existing validator and compares positions/weights/curve hashes and
point count with that binding. It revalidates all original orders and compares
order/rolling-digest/domain hashes and original side budgets. Valid but changed
curve content cannot inherit an older binding. This pure step does not obtain
or authenticate a new anchor, call RPC, recheck current lifecycle/custody or
validate historical signatures.

The bounded inventory includes:

- The original batch, with no omissions.
- Each single-record omission, identified by its original index/address.
- Each complete omission of all records for one trader address, in first-
  appearance order. These address cases are distinct from record cases.

Every case preserves the retained original signed fields/order sequence and
records their ABI hash. Side input demands are exact sums of retained original
budgets. These are fixed-opening hypotheses, not independently admitted/signed
replacement batches, a selected participant model, computed welfare/pivots or
LP-removal counterfactuals. An address is not proof of beneficial ownership.

For both directions, each case inventories requested inputs
`0..sum(retained side budgets)`. It reports the captured domain/limit, represented
row count, exact missing suffix and first missing input, unsupported row indices
and supported rows whose actual consumption is smaller than requested. Supported
partial capacity is represented data, not full consumption. Missing zero points
are not invented; the actual quote model's zero no-op remains supported.
Diagnostics beyond a case's required prefix do not veto that case. Individually
covered budgets and passing smaller removal cases cannot promote an uncovered
original aggregate.

`requireWholeInputOpeningPrefixes` re-evaluates the bound content and refuses
missing, unsupported or partial required inputs before whole-input experiments.
It accepts no saved report flag as proof and imposes no production admission
restriction. A future mechanism handling actual consumption may need different
data requirements; that mechanism is not selected here. Complete small input
data can include economically unfillable signed asks and proves no canonical
outcome or liveness guarantee.

The result's case/direction/array entries are detached and frozen. The versioned
`OtterOpeningPrefixCoverage/v1` ABI hash binds chain/book/pool/epoch/configuration,
read block number/hash, snapshot/curve/original-order/rolling-digest hashes and
the normalized case inventory. This is input/content identity, not an accepted
on-chain witness or an outcome commitment. Mutable input frames remain mutable
and must be revalidated when reused.

The bounds remain 32 original records, at most 32 address groups, **65 cases**,
130 original captured points and at most **8,450 bounded row classifications**
after existing content revalidation. Missing uint96 ranges are counted with
BigInt without enumeration or Number coercion. No additional RPC is made; the
4O collector's operation limits and 0–64 research prefixes are unchanged. These
are work bounds, not measured production gas, latency or verifier capacity.

[Original-domain requirements](./ORIGINAL_DOMAIN_REQUIREMENTS.md) state the
remaining participant/utility, deterministic policy, full feasible computation,
counterfactual, economic-witness and resource obligations. Record removal and
address removal remain inventory hypotheses rather than silently selected
strategic participant definitions.

## Fresh validation and provenance

- `web/: npm test`: **126 groups passed**, zero failures/skips/cancellations.
  Twelve new groups cover aggregate rather than individual budgets, uncovered
  originals with covered removal cases, exact maximum uint96 missing ranges,
  both removal inventories/empty retained batches, absent directions/zero rows,
  supported partial capacity, unsupported diagnostics/model no-op, diagnostics
  beyond required prefixes, altered original orders/records/quotes, valid changed
  curves against old anchors, corrupted batch metadata, declared ABI hashing,
  frozen output and **64 seeded independent inventory comparisons**. The seeded
  cases reach 32 distinct traders and the 65-case maximum. Prior 114 groups pass.
  Transport for obtaining their opening frames is mocked.
- `web/: npm run build -- --outDir /tmp/otter-4p-web-dist`: TypeScript and
  production build passed. The existing approximately 951 kB main-chunk warning
  remains. Dependencies/pins and tracked `web/dist/` are unchanged; the UI does
  not invoke this inspector and the deployment manifest remains null.
- `contracts/: forge test --offline --match-contract '^OtterOpeningExecutionTest$'
  --fuzz-runs 64`: **27 tests passed**, zero failures/skips. Seven new coverage
  tests include **64 coverage fuzz cases**. The retained 20 tests include three
  further 64-case binding/epoch/batch fuzz groups, for 256 contract fuzz cases.
- The bridge's new `--coverage` mode first obtains the actual complete 4O stored
  batch using exported staticcalls, runtimes, storage and balances. Solidity
  independently derives every original/removal retained-order hash and budget,
  computes oracle quotes from the unchanged local opening state and compares
  missing/unsupported/partial classifications and the versioned ABI coverage
  hash. Both directions and all supplied case fields are checked; it does not
  merely compare a copied report boolean.
- Actual cases include complete small mixed prefixes with repeated traders,
  incomplete aggregates whose individual budgets fit, maximum original budgets/
  asks/nonces, supported price-limit partial consumption, unsupported price
  diagnostics and the actual zero no-op, and a native batch whose original
  budget remains larger than the prefix. Fuzzing varies order count 1–8,
  original uint96 budgets, repeated trader addresses, directions and caps 0–8.
  The positive mixed case includes a maximum ask: input coverage alone does not
  claim economic eligibility. No original field is clipped to pass the tests.
- Initial validation caught and corrected a TypeScript tuple declaration, a
  test attempting to clone a function, the mistaken expectation that the model
  zero no-op inherits a nonzero-input unsupported limit, and a Solidity test
  identifier reserved by the compiler. The final complete runs above pass;
  production numerical/status behavior was not altered for those fixes.
- RPC and block hashes remain synthetic. No alternative swap, real provider,
  wallet, new full solver/broad contract suite or economic benchmark run is
  claimed. Earlier execution/reward/economic evidence is historical. Local test
  gas includes fixture/FFI/oracle work and does not measure an accepted verifier.
- [The 4P manifest](./EVIDENCE_MANIFEST_4P.json) records **291 selected files**:
  the frozen 4O selection plus the inspector, Node tests and requirements.
  Four previously selected files differ: the Solidity suite, fixture README,
  package test entry and bridge. The selected Solidity import closure remains
  97 files. Earlier manifests are byte-for-byte frozen. The unsigned snapshot
  identifies pending local checkpoint content, not equality with its baseline
  commit, independent review, or certification.

Temporary logs are `/tmp/otter-4p-web.log`, `/tmp/otter-4p-build.log`,
`/tmp/otter-4p-core.log` and `/tmp/otter-4p-check-handoff.log`. Temporary build/log
outputs are neither selected evidence nor committed artifacts.

## Remaining boundaries

Coverage applies to alternative opening single-swap input tables. It proves no
canonical allocation, direction selection, common welfare units, payments,
counterfactual welfare, sequential/netting/ownership-changing trace or guarantee
under a yet unspecified mechanism. Same-address removal is not an authenticated
strategic-party or LP/trader overlap model. It cannot establish historical
signature approval, current custody, token behavior/future delivery, finality
or eligibility for a later transaction. Caller-authenticated anchors and the
4O configured-code/RPC trust boundaries remain explicit.

**G1–G4 remain open; concentrated auction admission and swaps remain gated.**
Large original domains still require a scalable exact computation or a complete
authenticated proof design with measured verifier resources. Integer-payment/
incentive/liveness and combined trader/LP issues remain unresolved. Production
Solidity, numerical rules, assets/utility/valuation, minimum trade policy and
wallet actions are unchanged. No replacement rule or weaker guarantee is selected
and this checkpoint does not establish grant qualification.

## User-created commit handoff

Suggested title:

```text
feat: check original batch prefix coverage
```

Suggested explanation:

> Revalidate bound batch and curve content, inventory original and record/address
> removal budgets, and reject missing, unsupported or partial required inputs for
> whole-input research. Preserve signed quantities and document witness obligations.

The assistant has not staged or committed anything. Commit these **15 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterOpeningExecution.t.sol
fixtures/README.md
reviews/CHECKPOINT_4O.md
reviews/CHECKPOINT_4P.md
reviews/EVIDENCE_MANIFEST_4P.json
reviews/ORIGINAL_DOMAIN_REQUIREMENTS.md
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/package.json
web/src/protocol/batchCoverage.ts
web/test/batchCoverage.test.ts
web/test/epoch-snapshot-cli.ts
```
