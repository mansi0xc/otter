# Checkpoint 4L — exhaustive small execution prefixes from one shared state

Prepared 6 October 2026. Starting commit:
`71504c7145b3c42d1db9568c763888c017a609ba`. The working tree was clean.
Status: **bounded research curve collection verified; waiting for the user's commit**.

## Outcome

A single quote's sparse maps do not describe every alternative input. Calling
the old collector separately could also select different latest blocks between
directions. [The reader](../web/src/protocol/executionSnapshot.ts) now exposes
`captureExecutionCurves`: every integer raw input from zero through a declared
maximum is quoted from **one shared opening state**, in one or both directions.
Both sides share the block/hash, source/key/layout, runtime check and storage cache.
The single-quote API uses the same internal pipeline and keeps its original bounds.

Each domain specifies `down`, a BigInt maximum input **0–64**, and a fixed raw
price limit. There may be one or two domains with distinct directions. Domain
order and every point are retained. Domain/source values are copied before RPC
awaits. `points[j]` requests `BigInt(j)` from the opening state; it is never a swap
following `points[j-1]` or a preceding opposite-direction result.

This cap bounds exhaustive **research work**. It does not change production
budgets, minimum trades, asset representation, valuation, utility, allocations
or payments. It does not select a restricted production domain or claim that a
64-unit prefix covers every original uint96 budget/counterfactual.

Up to **130 points**, **32 bitmap words**, **128 reached initialized ticks** and
**162 storage calls** (including two header/liquidity reads) are collected.
One direction retains the 82-call bound. Each quote still has its own 16-word,
64-crossing and 80-step bounds, even if the shared cache already contains more
opposite-direction state. There are at most 290 collection attempts across two
maximum prefixes after pre-RPC representation checks: every attempt finishes a
point or adds one new record. The input loop cannot grow past the cap.

All code/storage reads retain the block-hash canonical selector, with one initial
chain/block/code check and a final numbered-block/chain recheck. Missing/malformed
state or a detected block/chain change aborts **the entire collection**, without
returning an earlier first-direction table. There is no provider fallback,
network implementation, cache persistence, automatic retry or wallet action.

Exhaustive enumeration does not mean every row is supported. The returned quote
preserves status, requested/consumed input, output, final state and traversal
usage. `PriceLimit` can consume less than its requested index. Other statuses
remain unusable diagnostic prefixes. Zero input is a model no-op and must still
be skipped in actual public swaps. No hole is interpolated, extrapolated,
concavified, silently removed or promoted into a supported output budget.

## Fresh validation and provenance

- `web/: npm test`: **75 groups passed**, zero failures/skips/cancellations.
  Ten new curve groups check all 130 maximum-prefix points against the offline
  reference, one block/code/chain collection and unique slot reads, reversed
  domain order, partial consumption, unsupported positive inputs with a supported
  zero row, zero-only domains, a full 32-word shared union with each quote still
  limited to 16, a 128-tick union with unchanged crossing rejection, late missing
  state, block/chain changes, exact historical heights, caller mutation during
  awaits and malformed/oversized/duplicate domains before RPC. The seeded group
  compares **1,152 points across 64 synthetic concentrated frames**. The prior
  65 wallet/single-reader groups also pass. RPC/wallet transport is mocked.
- `web/: npm run build -- --outDir /tmp/otter-4l-web-dist`: TypeScript and
  production build passed. The existing roughly 951 kB main-chunk warning remains.
  Installed dependencies/pins and tracked `web/dist/` are untouched. No product
  interface, manifest or connected wallet behavior changed.
- `contracts/: forge test --offline --match-contract '^OtterSnapshotReaderTest$'
  --fuzz-runs 64`: **16 tests passed**, zero failures/skips. Eight new curve tests
  include **64 concentrated curve fuzz cases**; the existing eight reader tests
  include **64 single-quote fuzz cases**. Actual manager bytecode and raw storage
  from both directions are exported once, with slot formulas checked against
  `StateLibrary`. The strict local Node bridge's `--curves` mode serves those
  slots to the reader, compares every quoted field/status against the oracle,
  then verifies supported points against actual PoolManager deltas/final state.
  Foundry restores the opening state between every alternative input/direction.
  The RPC and block metadata are synthetic, not real provider/finality evidence.
- Real-core curve tests cover native ETH, concentrated gaps, partial consumption,
  exact downward boundary/reverse activation, zero-only requests, independent
  word/crossing bounds and the complete existing transfer witness. At sqrt price
  `3*Q96/2` and liquidity 1,000, requests 0–4 produce outputs `0,2,4,6,8`; request
  five at the four-input terminal limit consumes four and returns eight. All raw
  alternatives start at the same opening price. **The incentive finding remains
  unresolved**; the reader does not supply compatible integer payments.
- The crossing stress fixture uses **140 raw core positions** to reach the
  shared tick cache bound. It is outside the authenticated vault's 32-position
  admission policy and does not relax that policy. Test gas includes many
  alternative swaps/state restorations, not a single production verification or
  settlement. No G3 capacity/cost result follows from those totals.
- No numerical solver source, allocation/payment/reward rule, production Solidity,
  saved economic artifact, deployment or ABI changed. The broader solver/contract
  suites and earlier benchmark/browser results are historical, not claimed fresh
  in this reader-only slice. The fresh retained single-quote tests cover the
  shared-pipeline refactor. No failure was hidden by skipping a domain or changing
  a quote status; the final scoped runs pass.
- [The 4L snapshot](./EVIDENCE_MANIFEST_4L.json) verifies **278 selected files**, the
  same selection as 4K. Five selected files change: the collector, Node tests,
  Node bridge, Solidity reader test and `fixtures/README.md`. The frozen 4K check
  detects those differences; older manifests retain their original bytes. The
  new manifest identifies local checkpoint content separately from its starting
  commit, without claiming proof, independent review or deployment certification.
  Installed packages, generated artifacts/builds/logs and changing packet/status
  docs are excluded. Source hashes still select the Solidity import closure.
- The handoff checks the exact 13-file list, whitespace/local Markdown targets,
  content hashes, unchanged HEAD and empty index. Production/vendor bytes, solver/
  research fixtures, harness/benchmarks, dependency pins/lockfiles, published
  deployments, null wallet configuration, tracked web build and older manifests
  are preserved. No real provider, wallet, testnet transaction, deployment,
  reviewer contact, upload or grant submission occurred.

Run with existing dependencies from `web/`:

```sh
npm test
npm run build -- --outDir /tmp/otter-4l-web-dist
```

From `contracts/`:

```sh
forge test --offline --match-contract '^OtterSnapshotReaderTest$' --fuzz-runs 64
```

From the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4L.json
```

Logs: `/tmp/otter-4l-web.log`, `/tmp/otter-4l-build.log`,
`/tmp/otter-4l-core.log`, `/tmp/otter-4l-handoff.log`.
Node 24.10.0, Python 3.9.6, Forge 1.5.1, solc 0.8.26, Cancun, via-IR,
optimizer 200; configured fuzz default 512, explicit targeted override 64.

## Material limits and next work

These tables exhaust only their declared prefixes. They do not cover larger
original budgets, every admitted/counterfactual input or all pool storage.
Limits and caps are caller-chosen research parameters, not an authenticated
epoch's immutable execution policy. Results are alternatives at the opening
state, not predictions for multiple sequential swaps. The maps/quotes remain
caller-mutable after collection.

The RPC and configured runtime fingerprint are trust inputs. Block selectors
and consistency checks neither independently verify consensus nor prevent a
later reorg. There is no network timeout/cancellation/retry implementation.
The raw zero-fee core model does not simulate arbitrary hooks, token delivery,
ownership/reward commitments or book/vault state. It does not reserve liquidity,
prove future execution or provide an accepted on-chain witness.

**G1–G4 remain open; concentrated auction admission and swaps remain gated.**
R2 canonical allocations/payments and R6 integer incentive/liveness failures
remain. The witness's correct execution menu supplies evidence of the original
whole-payment conflict, not its resolution. Native/concentrated custody and
accurate raw quotes do not establish combined trader/LP incentives. No fractional
asset, subsidy, cost grid, new utility, replacement redistribution or weaker
guarantee is selected. The wallet manifest stays null.

Next specify complete original-domain/epoch binding and verifier obligations
under G2/G3 together with a compatible asset/curve/utility and redistribution
mechanism under G1/G4. Do not activate concentrated auctions or represent grant
qualification as established from these bounded execution tables.

## User-created commit handoff

Suggested title:

```text
feat: collect exhaustive execution curves from shared state
```

Suggested explanation:

> Quote every input in bounded research prefixes at one shared block. Reuse
> storage while retaining partial consumption and per-quote limits, and compare
> all alternatives against local v4. Keep mechanism and auction gates unchanged.

The assistant has not staged or committed anything. Commit these **13 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterSnapshotReader.t.sol
fixtures/README.md
reviews/CHECKPOINT_4K.md
reviews/CHECKPOINT_4L.md
reviews/EVIDENCE_MANIFEST_4L.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/src/protocol/executionSnapshot.ts
web/test/executionSnapshot.test.ts
web/test/snapshot-reader-cli.ts
```
