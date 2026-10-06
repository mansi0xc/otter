# Checkpoint 4N — pinned opening-epoch collection and current eligibility

Prepared 6 October 2026. Starting commit:
`c3cccc6b31a2d107def42bf3b968193a40b0bf38`. The working tree was clean.
Status: **local epoch collection verified; waiting for the user's commit**.

## Outcome

The 4M validator required its caller to supply an authenticated opening anchor.
[The new collector](../web/src/protocol/epochSnapshot.ts) obtains that context
through a supplied read-only RPC at one selected block and checks it against
configured contract fingerprints. This closes the manual record/anchor assembly
gap for the **currently admitted full-range model**, with explicit RPC/configuration
trust. It is not independent consensus verification, a canonical outcome checker
or a promise that a later transaction can settle.

`EpochSource` declares a BigInt chain/configuration, reward-policy hash, exact pool
key and five distinct address/runtime hashes: book, guard, hook, settlement and
manager. The key's hook must equal the configured hook. These fingerprints must
be independently reviewed/configured; the collector does not discover safe
addresses, download deployments or authenticate the caller's chosen manifest.
Its separate read-only ABI does not change the wallet ABI or deployment format.

`EpochRequest` supplies the stored epoch, intended **settlement caller**, one/two
bounded curve domains and an optional exact BigInt block number. Controls are
copied/validated before awaits. The pipeline:

1. Checks the chain and selects a block number/hash/timestamp. All code, view and
   storage requests require that hash and `requireCanonical: true`.
2. Checks all five runtime fingerprints, pool registration, v2 snapshot domain,
   currencies/configuration/policy and book/guard/hook/settlement/manager wiring.
   The fixed **36-view plan** obtains opening pool/roster/weights/root, count/digest,
   lifecycle flags and settlement exclusivity. It requires successful actual book
   snapshot and vault batch-support assertions. Admission support is deliberately
   not used: pending exits must not veto the current batch.
3. Requires a current, nonempty 1–32-order, nonterminal/unconsumed epoch, with no
   execution/release/payout flags and derived state `Closed`. The selected block's
   timestamp must satisfy `closesAt <= timestamp < executeUntil`. The requested
   caller must equal the solver or reach the inclusive `closesAt + exclusivityWindow`
   boundary, which must precede expiry. Solver-zero configurations permit public
   callers after that boundary. Admission pause is not an added settlement veto.
4. Runs the existing curve reader through a wrapper that rejects an inner block
   hash/timestamp change before further state reads. The 4M binding validates the
   exact snapshot commitment, complete LP roster/weights, full-range schedule and
   every curve field. A final block/hash/timestamp/chain recheck rejects detected
   movement. No fallback, retry or partial successful result is returned on error.

ABI replies must be bounded, complete and canonical on decode/reencode. Dynamic
roster/weight responses must use the exact offset/length/shape and 1–32 elements
**before decoding**. Malformed scalar padding, bools, arrays or trailing bytes are
rejected. Existing quote domains/statuses remain unchanged: 0–64 raw prefixes,
partial consumption and unsupported diagnostic rows are retained.

The request bound is **212 RPC operations**: 36 view calls, up to 162 demanded
core storage calls, six code reads (manager is checked again by the curve reader)
and eight chain/block metadata queries. This is an upper bound from the existing
reader limits, not measured production latency, gas or capacity. No provider
timeout/cancellation implementation is supplied; that remains adapter behavior.

The result contains `binding`, `record`, `frame` and frozen primitive `eligibility`
metadata: block timestamp, count/digest, caller, solver and exclusivity endpoint.
Record/frame maps and quotes remain mutable. Returned hashes do not certify later
mutation or identify the entire RPC transcript/runtime/configuration. A valid
epoch window does not upgrade unsupported quote rows or authorize a wallet send.

## Fresh validation and provenance

- `web/: npm test`: **101 groups passed**, zero failures/skips/cancellations.
  The 13 new groups cover one-block selectors/request counts, read-only ABI/tuple
  agreement with local Foundry artifacts, all five fingerprint failures, every
  configured wiring/policy field, current lifecycle and count bounds, exact clock/
  solver boundaries, impossible exclusivity/deadline combinations, actual view
  errors and missing core data, hostile dynamic arrays/noncanonical replies,
  hash/timestamp changes at inner/final checks, each chain recheck, invalid/missing
  numbered blocks, caller mutation during awaits, pre-RPC control validation,
  stored roster/weight/root corruption and retained partial/unsupported/zero rows.
  The prior 88 wallet/reader/binding groups also pass. Transport is mocked.
- `web/: npm run build -- --outDir /tmp/otter-4n-web-dist`: TypeScript and
  production build passed. The existing roughly 951 kB main-chunk warning remains.
  Installed packages/pins and tracked `web/dist/` are unchanged. The product UI
  does not invoke the collector and its deployment manifest stays null.
- `contracts/: forge test --offline --match-contract '^OtterOpeningExecutionTest$'
  --fuzz-runs 64`: **13 tests passed**, zero failures/skips. Seven new collection
  tests include **64 collection fuzz cases**. The six retained pure-binding tests
  include another **64 binding fuzz cases**. The native fixture is shared between
  the old/new tests, with the old binding comparison retained.
- The new test-only bridge first emits the collector's fixed read plan. Solidity
  performs each actual `staticcall`, then exports success/revert data, five actual
  runtime byte strings and real core storage. The strict local bridge serves those
  replies to the collector. Solidity compares roster/weight/snapshot commitments,
  clock/count/digest/solver metadata and the normalized curve hash against the
  actual book and independent oracle. Core slot formulas retain the comparisons
  against `StateLibrary`. No runtime or opening record is fabricated in positive
  local contract cases; RPC and block identity remain synthetic.
- Actual cases cover native ETH at the public exclusivity endpoint, 32 LP positions,
  repeated owners, an individual zero-weight position and a pending exit at closing.
  Collecting, expired-but-unfinalized and refundable epochs must fail without a
  result. A non-solver at closing must fail. A changed live core liquidity slot
  causes the real book assertion to revert and collection to fail. Fuzzing varies
  uint64 chain/block identities, caps 0–8 and solver/public clock boundaries.
- This slice compares readonly oracle curves, without alternative swaps, a real
  provider or wallet session. Prior 4L swap evidence and 4M's 30 snapshot/reward
  regressions are historical, not claimed fresh here. No full solver, broad contract
  suite, benchmark or browser run is claimed. Test gas combines fixture setup,
  repeated FFI/oracle/read work and supplies no deployable verifier capacity result.
- [The separate 4N manifest](./EVIDENCE_MANIFEST_4N.json) verifies **285 selected
  files**: the 4M selection plus the collector, Node tests and Node bridge. Three
  previously selected files change: the Solidity binding suite, package test entry
  and fixture README. Selected Solidity imports are covered; older manifests
  retain their original bytes. This unsigned identity describes local pending
  checkpoint content separately from its starting commit, not independent review,
  consensus proof or deployment safety certification.
- Handoff checks the exact 14-file list, whitespace/local Markdown targets,
  selected hashes, unchanged HEAD and empty index. Production/vendor sources,
  solver/research/harness/benchmark bytes, dependency pins/lockfiles, published
  deployments, wallet ABI/config/UI, tracked build and older manifests are
  preserved. No real chain transaction, deployment, provider/wallet connection,
  install, reviewer contact, upload or grant submission occurred.

Run with existing dependencies from `web/`:

```sh
npm test
npm run build -- --outDir /tmp/otter-4n-web-dist
```

From `contracts/`:

```sh
forge test --offline --match-contract '^OtterOpeningExecutionTest$' --fuzz-runs 64
```

From the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4N.json
```

Logs: `/tmp/otter-4n-web.log`, `/tmp/otter-4n-build.log`,
`/tmp/otter-4n-core.log`, `/tmp/otter-4n-handoff.log`.
Node 24.10.0, Python 3.9.6, Forge 1.5.1, solc 0.8.26, Cancun, via-IR,
optimizer 200; configured fuzz default 512, explicit targeted override 64.

## Material limits and next work

RPC can lie, configured runtime hashes need independent review, and a later reorg
or state change can invalidate this block's observed eligibility. Hash selectors
and repeated checks do not independently establish consensus/finality. No live
provider implementation, wallet integration or asynchronous timeout/retry system
is supplied. A caller may deliberately select an old block: eligible **then** does
not mean eligible **now**. The intended caller must be the actual settlement
`msg.sender`, not merely an order's signed trader.

The collector reads count/digest, not the complete stored order/signature/nonce
or escrow/solvency ledger. It does not reauthenticate the reward ledger, token
delivery, canonical allocation/payment computation or future swap success. Book/
vault assertions use the current admitted full-range locking/version model; this
is not general concentrated ownership authentication. Small caller-chosen curve
prefixes do not cover original uint96 budgets or complete counterfactual domains.
The result is not an accepted on-chain witness or executable settlement outcome.

**G1–G4 remain open; concentrated auction admission and swaps remain gated.**
R2 canonical allocation/payments, R6 whole-payment incentive/liveness issues and
combined trader/LP redistribution remain unresolved. No asset representation,
minimum trade policy, valuation, utility, payment/reward rule or weaker guarantee
is selected. Production Solidity and wallet actions are unchanged.

Next bind complete stored orders/digest/escrow obligations and original-domain
counterfactual coverage to this context, while meeting the G1–G4 mechanism and
verifier requirements. Concentrated integration and independent review remain
necessary. This checkpoint does not establish grant qualification.

## User-created commit handoff

Suggested title:

```text
feat: collect pinned epoch records and eligibility
```

Suggested explanation:

> Check configured contract fingerprints and wiring, then collect opening records
> and curves at one block hash. Reject stale lifecycle, invalid clocks/caller
> exclusivity and live-state drift; preserve mechanism and auction gates.

The assistant has not staged or committed anything. Commit these **14 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterOpeningExecution.t.sol
fixtures/README.md
reviews/CHECKPOINT_4M.md
reviews/CHECKPOINT_4N.md
reviews/EVIDENCE_MANIFEST_4N.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/package.json
web/src/protocol/epochSnapshot.ts
web/test/epochSnapshot.test.ts
web/test/epoch-snapshot-cli.ts
```
