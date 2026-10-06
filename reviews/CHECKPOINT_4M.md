# Checkpoint 4M — full-range opening-record content and curve binding

Prepared 6 October 2026. Starting commit:
`e4cdfb1ebb1db2724bf1fae23374f8dbdda2249b`. The working tree was clean.
Status: **local content binding verified; waiting for the user's commit**.

## Outcome

The raw curve reader did not connect its quote table to Otter's stored opening
record. [The new pure helper](../web/src/protocol/openingExecution.ts) checks that
connection for the **currently admitted full-range model**. It performs no RPC,
wallet action or settlement. Its caller must independently authenticate the
expected anchor and same-block data. A fabricated anchor and matching fabricated
record can pass; the helper does not establish ownership or provenance itself.

`openingCommitment(record)` recomputes the book's exact
`OtterOpeningSnapshot/v2` ABI commitment, roster hash and weight hash. It validates
representations, not economic/domain correctness. `bindOpeningExecution` adds:

- Expected chain, book, guard, pool, epoch, configuration, reward policy, stored
  snapshot hash and read-block number/hash. The opening block cannot follow the
  read block. Block numbers and quantities remain BigInts, without Number coercion.
- A complete 1–32-position roster with nonzero owners, unique positive IDs,
  positive liquidity and the pool's usable full-range endpoints. Multiple
  positions may share an owner. It independently recomputes every capital weight
  from rounded principal and checks liquidity/weight totals. Individual zero
  weights remain valid when the total is positive.
- Pool ID/key/manager/source/header consistency, the existing zero-fee bounded
  execution domain, active/total liquidity agreement and exact boundary tick
  semantics. A nonzero runtime hash must be represented, but its authenticity is
  still the caller/collector's responsibility; the anchor contains no independently
  verified runtime fingerprint.
- Every cached bitmap word and tick against the deterministic full-range
  two-endpoint schedule. A fabricated initialized tick is rejected even if all
  supplied quotes agree with that fabricated state. Explicit zero words are
  retained; absent visited state throws rather than being treated as zero.
- One or two distinct directional prefixes, each 0–64 raw units, with the
  existing cache bounds/read count and every row present. All ten quote fields
  are checked against the exact BigInt reference. Partial consumption and
  unsupported diagnostic statuses remain explicit.

The helper returns a frozen object containing only declared primitive metadata,
the roster/weight/snapshot hashes, `curvesHash` and point count. Extra caller
properties and mutable frame/record references are excluded. `curvesHash` is
keccak256 of ABI-encoded ordered curve domains and all ten fields of their quote
arrays. It identifies that normalized table, not the runtime, RPC transcript,
cache or an authenticated witness. Later input mutation cannot change the returned
hashes, but the result does not certify the mutated inputs or authorize a send.

No production Solidity, wallet ABI/interface, deployment, dependency pin,
numerical execution/reward rule, allocator/payment rule, asset representation,
valuation, minimum trade policy or utility changes. Concentrated/mixed ranges
are rejected by this helper. The source wallet manifest stays null.

## Fresh validation and provenance

- `web/: npm test`: **88 groups passed**, zero failures/skips/cancellations.
  The 13 new groups check identity, commitment, roster, weight and all quote-field
  changes; malformed widths/clocks; full-range header/boundary checks; fabricated
  schedules; missing records; cache/read counts; incomplete/oversized/duplicate
  domains; partial and unsupported rows; no input mutation; and primitive-only
  frozen results. One seeded group checks **1,152 points across 64 synthetic
  full-range frames**, including spacings 1, 60 and 32,767 and varying prices.
  Synthetic native/ERC20 frames use a block number above JavaScript's safe integer
  range. The prior 75 wallet/reader/curve groups also pass; transport is mocked.
- `web/: npm run build -- --outDir /tmp/otter-4m-web-dist`: TypeScript and
  production build passed. The existing roughly 951 kB main-chunk warning remains.
  Installed packages and tracked `web/dist/` are unchanged. The product interface
  does not invoke this helper and no browser/wallet run is claimed here.
- `contracts/: forge test --offline --match-contract '^OtterOpeningExecutionTest$'
  --fuzz-runs 64`: **six tests passed**, zero failures/skips, including **64 fuzz
  cases**. The tests export actual book/vault opening records, the stored snapshot
  hash, manager bytecode and raw core storage. Slot formulas are checked against
  `StateLibrary`. The strict local Node bridge runs the existing reader and new
  validator over an in-memory RPC, then Solidity compares roster/weight/root hashes
  with the actual book and the curve-content hash with its independent oracle.
- Actual local cases cover ERC20 and native epochs, the maximum 32-position
  roster, repeated owners, an individual zero-weight position, queued exits and
  changed live state after expiry/exit. The last case must fail with a header
  mismatch and no stdout result. Positive cases revalidate `book.assertSnapshot`
  before and after comparison. Fuzzing varies chain/block identity, second-owner
  liquidity and curve caps. The initial fuzz setup exceeded Foundry's uint64
  chain-ID limit; the test was corrected to that harness limit. Production
  uint256 chain representation remains unchanged, and the final run passes.
- `contracts/: forge test --offline --match-contract
  '^(OtterSnapshotsTest|OtterHistoricalRewardsTest)$' --fuzz-runs 64`:
  **30 tests passed**, zero failures/skips, including **64 snapshot-drift fuzz
  cases**. Existing native/full-range authentication, historical rewards, recovery,
  queued exits and concentrated rejection remain intact.
- The new FFI bridge receives one canonical bounded ABI fixture and serves only
  explicitly exported storage. It uses existing Node/viem and no HTTP, install,
  wallet, signature request or send. Its anchor/RPC/block hash are **synthetic**;
  real local contract bytes do not convert that transport into consensus proof.
  This slice compares readonly oracle curves, without alternative swaps. The
  prior 4L real-swap evidence is historical, not claimed fresh here. Test gas sums
  fixture setup/FFI/oracle work and supplies no production verifier capacity result.
- [The separate 4M manifest](./EVIDENCE_MANIFEST_4M.json) verifies **282 selected
  files**: 4L's 278-file selection plus the new validator, Node tests, Node bridge
  and Solidity binding test. Two earlier selected files change: `web/package.json`
  adds the test entry, and `fixtures/README.md` documents the bridge. The selected
  Solidity import closure is covered; older manifests retain their original bytes.
  This unsigned local identity describes pending checkpoint content separately
  from its starting commit, not proof, independent review or safety certification.
- Handoff checks the exact 14-file list, whitespace/local Markdown targets,
  selected hashes, unchanged HEAD and empty index. Production/vendor sources,
  solver/research/harness/benchmark bytes, dependency pins/lockfiles, published
  deployments, null wallet configuration, tracked web build and older manifests
  are preserved. No real provider, wallet, chain transaction, deployment, reviewer
  contact, upload or grant submission occurred. No fresh full solver, broad
  contract suite or economic benchmark is claimed.

Run with existing dependencies from `web/`:

```sh
npm test
npm run build -- --outDir /tmp/otter-4m-web-dist
```

From `contracts/`, sequentially:

```sh
forge test --offline --match-contract '^OtterOpeningExecutionTest$' --fuzz-runs 64
forge test --offline --match-contract '^(OtterSnapshotsTest|OtterHistoricalRewardsTest)$' --fuzz-runs 64
```

From the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4M.json
```

Logs: `/tmp/otter-4m-web.log`, `/tmp/otter-4m-build.log`,
`/tmp/otter-4m-core.log`, `/tmp/otter-4m-regression.log`,
`/tmp/otter-4m-handoff.log`. Node 24.10.0, Python 3.9.6, Forge 1.5.1,
solc 0.8.26, Cancun, via-IR, optimizer 200; configured fuzz default 512,
explicit targeted override 64.

## Material limits and next work

The caller must still obtain authenticated, hash-pinned book/guard/hook/runtime
and core records at the same block. The helper does not implement that RPC
collection, authenticate the actual vault's ownership, inspect a complete batch,
check current epoch/state/deadline eligibility, prevent consensus dishonesty or
prove finality. Clock representation checks are not time eligibility checks.
Historical matching content can pass without being eligible to settle now.

The curve caps/limits remain caller-chosen research parameters, not immutable
epoch execution policy. The tables do not cover all original uint96 budgets or
counterfactuals, sequential trading, token delivery, arbitrary hook behavior or
future execution. A content hash is not an accepted on-chain proof. Complete
authenticated collection, full domain coverage and affordable canonical verification
remain G2/G3 obligations.

**G1–G4 remain open; concentrated auction admission and swaps remain gated.**
R2 canonical allocation/payment failures and R6 integer incentive/liveness issues
remain. Matching book/curve bytes neither fixes whole payments nor establishes
combined trader/LP incentives. No fractional asset, subsidy, cost grid, changed
utility, replacement redistribution or weaker guarantee is selected.

Next define and test authenticated same-block epoch collection and current
lifecycle checks, alongside complete original-domain verifier obligations and
a compatible mechanism under G1/G4. This checkpoint improves validation plumbing;
it does not establish grant qualification or permit concentrated activation.

## User-created commit handoff

Suggested title:

```text
feat: bind full-range execution curves to opening records
```

Suggested explanation:

> Validate snapshot commitments, LP weights and every curve quote against
> supplied opening context. Reject fabricated tick schedules and changed headers;
> keep anchor authentication, mechanism research and auction gates explicit.

The assistant has not staged or committed anything. Commit these **14 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterOpeningExecution.t.sol
fixtures/README.md
reviews/CHECKPOINT_4L.md
reviews/CHECKPOINT_4M.md
reviews/EVIDENCE_MANIFEST_4M.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/package.json
web/src/protocol/openingExecution.ts
web/test/openingExecution.test.ts
web/test/opening-execution-cli.ts
```
