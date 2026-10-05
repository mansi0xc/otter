# Checkpoint 4K — bounded raw-core state collection at one block hash

Prepared 6 October 2026. Starting commit:
`0e5b727263df5ebc75ff1605049f6d05b035654d`. The working tree was clean.
Status: **local reader slice verified; waiting for the user's commit**.

## Outcome

The exact quote reference previously required manually assembled bitmap/tick
maps. [The new collector](../web/src/protocol/executionSnapshot.ts) prepares the
state needed for one exact-input quote through a caller-supplied read-only RPC
callback. It checks the chain and configured manager bytecode, selects an explicit
or latest block, and pins every code/storage query to that block's hash with
`requireCanonical: true`. It rereads the original numbered block and chain before
returning. Unsupported providers, missing blocks, invalid state and detected
block/chain changes abort; there is no numbered/latest state fallback.

The single-slot `extsload` calls use the layout of pinned core commit
`e50237c43811bd9b526eff40f26772152a42daba`: pool mapping slot 6, liquidity offset 3,
tick mapping offset 4 and bitmap mapping offset 5. Signed mapping keys use full
ABI sign extension. Packed price/tick/fee/liquidity and signed tick net are decoded
exactly. Header consistency permits the stored inverse-price tick **or its
downward-boundary predecessor at an exact tick price**. Explicit empty words are
retained; missing storage never becomes zero liquidity.

The collector replays the existing exact reference and loads only its next missing
record. [Structured missing-state fields](../solver/src/execution.ts) identify the
bitmap/tick index without parsing error text. This changes no numerical quote
math, status, bound, allocation, payment or utility. There are at most two initial
header/liquidity reads, 16 bitmap words and 64 reached initialized ticks: **82
storage calls**, plus fixed chain/block/code checks. At most 81 model attempts
each retain the existing 80-step bound. ABI-representable unsupported requests
retain their diagnostic status; malformed inputs/storage throw.

The returned source/key/layout, block number/hash, sparse maps, quote and read
count describe **this request**. Only `Complete`/`PriceLimit` quotes are usable;
an unsupported prefix is never promoted into an output budget. Zero input remains
a model no-op, whereas public v4 swaps reject it. No retry, cache, RPC URL,
network implementation, wallet method or deployed service is supplied. The
helper is not connected to the wallet UI or null deployment manifest.

## Fresh validation and provenance

- `web/: npm test`: **65 groups passed**, zero failures/skips/cancellations.
  The 18 added reader groups cover concentrated gaps in both directions,
  demand-driven unique storage reads, zero-input and zero-liquidity behavior,
  stored boundary ticks and negative-net activation, explicit empty words,
  missing word/tick state, unsupported hash selectors and RPC errors, wrong
  chain/runtime/code bounds, changed/missing blocks and exact historical heights
  beyond JavaScript's safe integer limit, malformed quantities/returns/key/query
  representations, packed-state and tick-liquidity consistency, caller mutation
  during awaits, existing unsupported statuses and the 16-word/64-crossing bounds.
  The previous 47 wallet/history groups also pass. All RPC/wallet data here are
  mocked; no real provider or connector is exercised.
- `web/: npm run build -- --outDir /tmp/otter-4k-web-dist`: TypeScript and
  production build passed. The existing large-chunk warning remains (about
  951 kB main JS). No packages/pins were installed or changed; the package edit
  only adds the new test file to `npm test`. Tracked `web/dist/` is untouched.
- `solver/: npm test`: **152 groups passed**, including the existing execution
  checks and seven byte-compared research artifacts. Eight groups are legacy
  floating-point references. Reproducing documented failure witnesses is not
  proof that those incentive/funding failures are fixed. No numerical solver,
  allocation/payment rule or saved research artifact changed.
- `contracts/: forge test --offline --match-contract '^OtterSnapshotReaderTest$'
  --fuzz-runs 64`: **8 tests passed**, zero failures/skips, including **64
  concentrated fuzz cases**. The new test exports actual local manager bytecode
  and raw header/liquidity/bitmap/tick slots. Its independent Solidity slot
  formulas are compared with `StateLibrary`, then the local Node reader bridge
  compares every quote field with the on-chain oracle. Supported results are
  checked against actual PoolManager swap deltas and final price/tick/liquidity.
  Native ETH, concentrated gaps, both directions, exact downward boundaries,
  reverse activation, empty-word rounding and unsupported bounds are covered.
  Zero public swaps remain rejected. **The RPC and block metadata are synthetic**;
  exported storage and swaps are real local core execution, not provider/finality
  or authenticated-book evidence. The bridge has no HTTP or wallet capability.
- Existing core regression command with `--fuzz-runs 64`: **44 tests passed**,
  zero failures/skips: 30 oracle and 14 BigInt reference tests, including **64
  reference fuzz cases**. This covers existing status precedence, native/unequal
  decimals, prices/liquidity, tick/word/step/output bounds, partial consumption,
  topology and real-core comparisons. These are scoped fresh runs at 64 fuzz
  cases, not a claim to have rerun the whole contract suite at its default 512.
- Initial local test harness issues were corrected: JavaScript strict comparison
  distinguishes `-0` from `0`, so fixture divisibility uses a Boolean condition;
  Solidity ternaries for negative tick endpoints need explicit `int24` casts.
  These were test-fixture errors, not hidden production failures. Final runs pass.
- [The new content snapshot](./EVIDENCE_MANIFEST_4K.json) verifies **278 selected
  files**, adding the four reader/bridge/test sources to 7C's 274. Three earlier
  selected files change: structured errors in `solver/src/execution.ts` and the
  test command in `web/package.json`, plus the bridge explanation in
  `fixtures/README.md`. The frozen 7C check therefore detects those three changes,
  and frozen 4J detects the reference and fixture README; their older content
  is retained, not rehashed. The 4K snapshot explicitly identifies local checkpoint
  bytes separately from the pre-checkpoint commit. Installed packages, generated
  builds/artifacts, logs and mutable packet/status docs are excluded. Content
  identity is unsigned and does not certify safety, a theorem or a deployment.
- The handoff checks whitespace/local Markdown targets, the exact file list,
  unchanged HEAD and empty index. Production Solidity/vendor bytes, allocator/
  payments/research fixtures, benchmarks/harness, dependency pins/lockfiles,
  published deployments, older manifests, null wallet config and tracked web
  build are preserved. No full audit, numerical guarantee proof, browser preview,
  real RPC connection, public transaction or testnet deployment is claimed fresh.

Run using existing dependencies, from `web/`:

```sh
npm test
npm run build -- --outDir /tmp/otter-4k-web-dist
```

From `solver/`:

```sh
npm test
```

From `contracts/`, sequentially:

```sh
forge test --offline --match-contract '^OtterSnapshotReaderTest$' --fuzz-runs 64
forge test --offline --match-contract '^(OtterExecutionOracleTest|OtterExecutionReferenceTest)$' --fuzz-runs 64
```

From the repository root:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4K.json
```

Logs: `/tmp/otter-4k-wallet.log`, `/tmp/otter-4k-build.log`,
`/tmp/otter-4k-solver.log`, `/tmp/otter-4k-reader-contract.log`,
`/tmp/otter-4k-core-regression.log`, `/tmp/otter-4k-handoff.log`.
Node 24.10.0, Python 3.9.6, Forge 1.5.1, solc 0.8.26, Cancun, via-IR,
optimizer 200; default fuzz setting 512, explicit targeted override 64.

## Material limits and next work

The callback's RPC data and caller-selected runtime fingerprint remain trust
inputs. Matching a hash is not independent bytecode review. A provider can lie
or ignore selectors; block-consistency checks do not verify consensus. A later
reorg remains possible, and no timeout/cancellation/retry policy is provided.
The numerical/storage budgets bound work, not network latency or finality.

Captured maps can be mutated by a consumer and cover only the visited path, not
every alternative input/counterfactual. A complete supported finite curve must
bind each read to the same opening state and preserve unsupported holes. The
reader does not authenticate the opening book/vault ownership records, capital
weights, reward policy or an on-chain witness, nor revalidate them at settlement.
It models the pinned raw zero-fee core, not arbitrary hook fees/deltas, token
delivery or custody. A quote cannot reserve liquidity or guarantee future execution.

**Concentrated auction admission and swaps remain gated. G1–G4 remain open.**
Native/concentrated custody and isolated exact execution are useful prerequisites,
not canonical allocation/payment verification or combined trader/LP incentives.
No weaker rule, fractional asset, subsidy, cost grid, new utility or redistribution
destination is selected. Production Solidity, published deployments and the
disabled wallet manifest are unchanged. No external reviewer was contacted, no
independent audit was obtained and no grant application was submitted.

Next, specify complete finite-domain/epoch authentication and verifier obligations
under G2/G3 while resolving the asset/curve/utility and joint redistribution
requirements under G1/G4. Do not activate concentrated trading on this reader's
test results alone.

## User-created commit handoff

Suggested title:

```text
feat: capture hash-pinned v4 execution state
```

Suggested explanation:

> Collect bounded core storage at one block hash and reject missing or changed
> state. Cross-check native/concentrated quotes against real local v4 swaps while
> preserving quote math, guarantee targets and the concentrated auction gate.

The assistant has not staged or committed anything. Commit these **15 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterSnapshotReader.t.sol
fixtures/README.md
reviews/CHECKPOINT_4K.md
reviews/CHECKPOINT_7C.md
reviews/EVIDENCE_MANIFEST_4K.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
solver/src/execution.ts
web/README.md
web/package.json
web/src/protocol/executionSnapshot.ts
web/test/executionSnapshot.test.ts
web/test/snapshot-reader-cli.ts
```
