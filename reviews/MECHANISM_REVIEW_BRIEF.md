# Otter: independent mechanism review brief

Prepared 5 October 2026 against commit
`2c2434476f48a6e96dbaef8f2051259c084e6d88`. **Request prepared locally; no reviewer
has been contacted and no independent review has occurred.**

Local safety update 4I starts from user-created commit `149db34`: settlement now
rejects minority payments below signed whole-unit minima. The witnesses and
mechanism questions below remain open. The current evidence snapshot and runbook
include that patch; the original 8A manifest retains the earlier baseline bytes.

Local 4J update starts from the user-created signed-minimum commit `6cf5348`.
The solver preflight now validates minority outcomes and numeric bounds and
derives crossing totals from orders. It remains an offline current-rule
arithmetic check, with real-settlement comparisons, not an authenticated
execution check or canonical/incentive verifier. See [4J](./CHECKPOINT_4J.md).

Local 7B update starts from the user-created `2404cce` commit. The source wallet
adds owned-position exit requests, idle processing and separate vault principal/
fee claims, with its manifest still null. It changes no mechanism or contract
policy. The latest snapshot additionally selects the wallet source/config/test
closure; [7B](./CHECKPOINT_7B.md) records local mock-wallet and real-core evidence.

Local 7C update starts from the user-created `d76b12c` commit. It adds bounded
browser history and read-only receipt recovery, including admission IDs after
reloads, without storing reusable signatures. Receipt/block consistency checks
do not establish finality or an authenticated indexer. The wallet remains disabled
by its null manifest. [7C](./CHECKPOINT_7C.md) records fresh local wallet/build and
synthetic interface checks; no new contract or mechanism evidence is claimed.

Local 4K update starts from the user-created `0e5b727` commit. It adds a bounded
read-only raw-core state collector using one block hash, a configured runtime
fingerprint and exact signed slot decoding. Only the quote's demanded words/ticks
are loaded; missing state and detected block/chain changes fail. Local raw-storage
and real-swap comparisons include native ETH and concentrated liquidity, with
synthetic RPC/block metadata. It does not authenticate a complete epoch/curve,
activate concentrated auctions or resolve G1–G4. See [4K](./CHECKPOINT_4K.md).

Local 4L update starts from the user-created `71504c7` commit. It collects every
raw input in one or both declared 0–64 research prefixes from the same block,
reusing storage without changing per-quote bounds/statuses. Partial consumption
and unsupported points remain explicit. Every alternative is checked against
the local oracle and supported real swaps after restoring the opening state.
This preserves the transfer witness below; the 64-unit research work bound is
not a production minimum/maximum trade size or a replacement mechanism. Complete
original-domain/epoch authentication and G1–G4 remain open. See [4L](./CHECKPOINT_4L.md).

Local 4M update starts from the user-created `e4cdfb1` commit. A pure validator
binds bounded execution curves to supplied full-range opening records: exact v2
commitment, roster/weights, expected identity/read block, header, deterministic
tick schedule and every quote field. Local tests export actual book/vault/core
records and compare commitments and curve hashes with Solidity. RPC/anchor/block
metadata are synthetic; the caller must authenticate a real anchor independently.
No current lifecycle or canonical mechanism validation is supplied. G1–G4 and
concentrated integration remain open. See [4M](./CHECKPOINT_4M.md).

Local 4N update starts from the user-created `c3cccc6` commit. A read-only epoch
collector checks five configured runtimes, wiring, opening records and current
closed-window/caller eligibility at one block hash, then binds the bounded curve
table. Book/vault assertions reject live drift; pending exits do not veto current
batch support. Local tests export actual staticcall replies and core storage,
with synthetic transport/block identity. Fingerprints/RPC remain trust inputs;
complete order/escrow/canonical computation, ledger delivery, consensus and future
execution are not established. G1–G4 remain open. See [4N](./CHECKPOINT_4N.md).

Local 4O update starts from the user-created `e9eecb5` commit. The read-only
extension binds every stored order, original side budgets, rolling digest and
v2 signing domain to the pinned epoch. Recovery flags/nonce bits and actual
replay are checked, and native/ERC20 book balances must cover shared global
escrow plus claims. Admission deadlines retain their admission-only meaning.
Configured code/RPC are trusted; signatures are not retained or revalidated.
Current balances establish neither future delivery nor token behavior. Original
budgets are preserved, but the small curve prefixes still leave original-domain
counterfactual coverage and canonical computation unresolved. G1–G4 and
concentrated integration remain open. See [4O](./CHECKPOINT_4O.md).

Local 4P update starts from the user-created `c644c32` commit. A pure inspector
revalidates bound opening/batch content and inventories original summed side
prefixes plus record/address removals. Missing rows, unsupported diagnostics and
supported partial consumption remain distinct. A whole-input research precondition
refuses incomplete required prefixes without clipping original budgets or
trusting an old report flag. The inventory selects no participant, optimizer,
payment or ownership-removal rule and supplies no economic witness. See
[4P](./CHECKPOINT_4P.md) and [the remaining original-domain requirements](./ORIGINAL_DOMAIN_REQUIREMENTS.md).

Local 4Q update starts from the user-created `14044fe` commit. The complete
original-prefix guard feeds the existing one-sided linear-welfare laboratory
using unmodified stored quantities. Original and every record/address removal
agree between independent optimizers on the same original table. Actual core
outputs expose record funding deficits, a distinct-trader deficit after address
grouping, and a funded grouped payment unable to cover original per-record
minima. Grouping remains a hypothesis, with no distribution or replacement
participant policy. Mixed/large/incomplete domains refuse calculation rather
than narrow reports. G1–G4 remain open. See [4Q](./CHECKPOINT_4Q.md).

Local 4R update starts from the user-created `ff2718d` commit. A pure inspector
recomputes 4Q and compares dynamic programming with independent enumeration of
least whole-unit per-record minima at every original/removal input quantity.
Actual cases distinguish infeasible signed delivery from a feasible fill with
unfunded pivots. At tick -6000, a funded same-input fill can require higher exact
report cost and lower welfare than the unrestricted choice. The frontier changes
no delivery semantics or allocation/payment policy and proves no incentive
guarantee. G1–G4 remain open. See [4R](./CHECKPOINT_4R.md).

Local 4S update starts from the user-created `b25bea0` commit. Finite ask-response
profiles freshly recompute complete original 4Q domains while only one target
ask changes. An actual native liquidity-2 full-range example has funded and
deliverable efficient fills but no whole-unit truthful target transfer assignment:
the winning-minus-losing payment must lie in [1/8,3/8] raw output units. Checked
truthfulness-only negative cycles establish the conflict independently of delivery
bounds. Passing finite constant-fill certificates do not prove a mechanism;
other-minimum deficits leave funded analysis unavailable. No participant/rule/
representation change is selected. See [4S](./CHECKPOINT_4S.md) and
[completion status](./COMPLETION_STATUS.md); G1–G4 remain open.

## Decision the review must support

Determine whether a useful v4 mechanism can meet the requested incentive targets
with the intended asset and liquidity support. If it can, specify a complete
rule and proof obligations before implementation. If a set of requirements is
incompatible, identify precisely which assumptions conflict and what product
decision would be needed. A funded rule or a correct swap quote alone is not
sufficient evidence.

The user selected native ETH and concentrated liquidity, and prioritized
preserving the paper's guarantees over shipping a weaker integer adaptation.
No fractional asset, restricted valuation grid, new subsidy or current-pot
destination has been adopted. Product changes need an explicit decision after
their consequences are presented. An all-zero mechanism does not meet the
intended useful-trading objective.

Source paper: [Otter, arXiv version 1](https://arxiv.org/html/2609.03474v1).
Distinguish its continuous model from the finite integer extension under review.
In particular, retain the signed net-flow utility gates in section 2.1; do not
replace them with report-cost utility, individual gross flows, or a wallet model
that silently includes auxiliary gifts inside those gates. Specify any additive
external fee separately. Theorem 23's inclusion assumptions do not follow from
an admission digest or a testnet deployment.

## Reading route and current implementation

1. Read the two short witnesses below, then reproduce their fixtures and tests.
2. Read [the redistribution proposal](./REDISTRIBUTION_DESIGN.md) and
   [the implementation specification, section 7](./IMPLEMENTATION_SPEC.md#7-discrete-mechanism-required-contract-and-unresolved-gates).
3. Inspect the actual [settlement](../contracts/src/OtterSettlement.sol),
   [math verifier](../contracts/src/OtterMath.sol),
   [reward ledger](../contracts/src/OtterRewardLedger.sol) and
   [execution oracle](../contracts/src/OtterExecutionOracle.sol).

Custody, stored refunds, bounded epochs/exits, exact read-only execution and
opening-owner cash rewards are implemented locally. The source wallet uses v2
signatures and receipt-based recovery, but its deployment manifest is null.
The published September addresses and tracked web build are historical.

Local settlement still accepts feasible noncanonical outcomes (**R2**). It now
checks signed minima on both sides, rejecting the minority dust underpayment
path. **R6** remains open for empty payment intervals, ties and complete integer
incentives/liveness; rejecting an unsafe proposal does not supply a new rule.
Historical reward accounting fixes
later-entry capture locally (**R7**), but its current residual allocation has the
combined-role incentive failure below. Concentrated positions can be custodied;
concentrated auction admission and swaps remain gated. No independent security
audit, live hardened deployment or complete incentive proof is claimed.

## Evidence that a proposed rule must address

### E1: changing partial fills does not remove whole-payment constraints

Fix other reports and a true input budget `C`. Let deterministic net input
expenditure be `x(a)` in `[0,C]`, whole net output be `p(a)`, and `a` be the
original positive WAD ask. Exact truthfulness at two types `a < b` requires

```text
a * (x(a) - x(b)) <= WAD * (p(a) - p(b)) <= b * (x(a) - x(b)).
```

If `b*C < WAD`, a positive fill difference would require a strictly positive
payment difference smaller than one output raw unit. Hence both fill and payment
must be equal. The argument permits whole output subsidies and losing payments;
it does not rely on a pivot formula, IR or a funding deficit. It excludes other
assets, additional benefits, randomization and a changed utility.

At sqrt price `3*Q96/2`, full-range liquidity 1,000 and a report-independent
four-input price limit, real v4 outputs for inputs `0..4` are `0,2,4,6,8`.
Requesting five consumes four, so all possible integer fills are accounted for.
With a rival ask `1/8`, both budgets four and target asks `1/16,1/8,3/16`, the
efficient target fills are `4,0,0` under the declared middle tie. Only five of
125 possible fill responses admit whole truthful payments; all five are constant.
The best constant response loses at least `1/8` of an output raw unit of the
one-sided allocation objective in one profile. This is a welfare accounting
fraction, not a promised fractional payout.

See [4H](./CHECKPOINT_4H.md),
[the constraint checker](../solver/src/transfer-research.ts),
[the saved certificate](../fixtures/research/transfer-research.json) and
[the real-core test](../contracts/test/OtterTransferResearch.t.sol).
This is a necessary single-identity condition and a scoped one-sided conflict,
not a universal impossibility theorem or a full two-sided welfare result.

### E2: exact trader pivots can still reward an existing LP trader's lie

A fixed real-v4 quantity table at the same sqrt price, total liquidity 40 and
four-input lots is `[0,7,13,null]`; `null` is an unexecutable full request that
only partially consumes eight. A owns one of two equal opening LP stakes.
Its true cost is four output units per lot; it reports two instead. B's cost
is one. All costs in this example have exact original WAD encodings.

| Raw quantity | A reports truthfully | A underreports |
|---|---:|---:|
| Each trader's input spend | 4 | 4 |
| Actual v4 output | 13 | 13 |
| Exact pivot payment to A | 6 | 6 |
| Exact pivot payment to B | 4 | 2 |
| Current residual pot | 3 | 5 |
| A's funded LP claim | 1 | 2 |
| A's trade utility at its true cost | 2 | 2 |
| A's trade utility plus LP cash | **3** | **4** |

The actual final price/tick/liquidity and LP principal are identical. The gain
is whole delivered cash before gas, not a hypothetical token price. The Solidity
test computes candidate pivots independently, executes real v4 and uses the real
reward ledger, with an explicitly **stubbed book**. It does not claim that
production settlement enforces those pivots. Actual opening ownership is covered
separately by the historical reward tests.

See [6B](./CHECKPOINT_6B.md),
[the composition reference](../solver/src/reward-composition-research.ts),
[the fixture](../fixtures/research/reward-composition.json) and
[the cash reproduction](../contracts/test/OtterRewardComposition.t.sol).
The fixed-state same-range split bound in that checkpoint does not prove
arbitrary range selection, LP principal, entry timing or multi-epoch incentives.

### E3–E5: tempting repairs have additional obligations

| Candidate or assumption | Existing evidence | What remains to establish |
|---|---|---|
| Fractional compensation / credit claims | [4F](./CHECKPOINT_4F.md): generic spot denominators, whole redemption dust and neighboring real-core residual swaps | Both-side underlying IR, fractional matching/residual input, redeemable value, backing, identity aggregation and changing prices; a nominal credit alone is insufficient |
| Integer per-lot cost grids or larger exchange lots | [4G](./CHECKPOINT_4G.md): exact grid pivots and a real swap that makes the next WAD-preserving lots exceed uint96 | Original valuation domain and sequential support; rounding asks changes the types and has counterexamples |
| Fixed auxiliary LP benefits | [6C](./CHECKPOINT_6C.md): pre-funded calendar, plateau condition, vesting/caps, per-start farming, future funding and utility-gate examples | Current-pot destination, economic control, complete utility, LP principal and strategic history; adding the calendar alongside current rewards retains E2 |
| Tick-aware integer output as a continuous curve | [4B](./CHECKPOINT_4B.md): inputs `0,1,2` produce `0,0,1`; exact crossing/gap quotes in [4A](./CHECKPOINT_4A.md) | A theorem-compatible adaptation over finite capacity, both directions, price limits and changing ranges; execution agreement is not concavity or a mechanism proof |

The saved research tables preserve partial-capacity diagnostics. They must not
be read as full-fill outcomes. Synthetic redistribution examples are labeled
separately from actual v4/cash evidence. Earlier fixtures remain in
[the research directory](../fixtures/research); these witnesses are not an
exhaustive proof over all orders, pools or deviations.

## Questions and required review output

| Gate | Exact question | Evidence required before closing the gate |
|---|---|---|
| G1: full discrete rule | What allocation, payment and efficiency target can support the original types, both directions, integer escrow and signed minimum output while meeting the intended incentives? Which E1 premise must change, if any? | Versioned function specifying eligibility, side selection, fills, transfers, refunds, ties, zero allocations and all counterfactuals. Proof under an explicit type/strategy/utility domain, plus independent exhaustive tests. No silent valuation rounding or asset substitution. |
| G2: real curve domain | How do finite capacity, staircases, gaps, unsupported traces and post-swap prices change the necessary assumptions? | Supported pool/range/price/amount domain; both-side capacity and residual execution rules; proof of the claimed extension or a precise qualified negative result. Native/ERC20 raw units and repeated supported epochs included. |
| G3: enforceable computation | How will a caller prove the entire selected outcome within a measured transaction budget? | Complete authentication for batch, opening pool/ticks/roster/policy and counterfactuals; omission/tie/payment rejection criteria; worst-case resource evidence. A quote or welfare value alone is not a witness. Changed trust or delayed-finalization assumptions must be explicit. |
| G4: combined economic roles | Can current surplus and future benefits be routed while preserving incentives for economically controlled trader/LP/builder/community roles? | Utility and strategy horizon covering principal, rewards, range/entry/exit choices, controlled identities, both-side net-flow gates, repeated epochs and current-pot routing. Explain how E2 and E3–E5 are addressed. |

For each claimed guarantee, list its quantifiers, assumptions, proof status and
counterexamples. Distinguish trader truthfulness, false-name resistance, builder
incentives, IR, funding and inclusion. A test pass must identify whether it proves
safe behavior or intentionally reproduces an unsafe behavior.

Requested deliverables: an assumptions/claims matrix; review of E1–E5 with any
corrections; a complete feasible proposal **or** a scoped incompatibility result;
an implementation and verification plan only for the proposal that passes review;
and remaining research/security questions with owners. Independent mechanism
review is distinct from a Solidity audit. Record reviewer expertise, conflicts,
scope and compensation; do not label internal tests as independent review.

## Local reproduction and provenance

Use the full repository with submodules populated. The selected evidence files
and their Solidity import closure are hashed in
[EVIDENCE_MANIFEST_4S.json](./EVIDENCE_MANIFEST_4S.json). That manifest records the
pre-patch baseline, local checkpoint, dependency commits and observed tools.
It identifies the post-patch selected bytes and does not hash this brief or later
status edits, authenticate an author, inspect unlisted files, or certify safety.
Source content hashes also cover the imported vendor Solidity, rather than
relying on submodule HEAD alone. Review the verifier before running it.

From the repository root, with the already available tools:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4S.json
```

From `solver/`:

```sh
npm test
npm run research:transfers --silent > /tmp/otter-transfer-research.json
npm run research:reward-composition --silent > /tmp/otter-reward-composition.json
cmp ../fixtures/research/transfer-research.json /tmp/otter-transfer-research.json
cmp ../fixtures/research/reward-composition.json /tmp/otter-reward-composition.json
```

The Node suites also byte-compare all seven saved research fixtures. No package
installation, RPC or secret is required for these references. Amounts are BigInts
serialized as decimal strings. Eight legacy floating-point test groups are
historical reference checks, not proof evidence for the redesigned mechanism.

From `contracts/`, run one Forge job at a time:

```sh
forge test --offline --match-contract '^(OtterTransferResearchTest|OtterRepresentationTest|OtterCostGridTest|OtterRewardCompositionTest|OtterExecutionOracleTest|OtterExecutionOracleIntegrationTest|OtterHistoricalRewardsTest)$'
```

For the signed-minimum safety patch and stored recovery, also run:

```sh
forge test --offline --match-contract '^(OtterMinimumOutputTest|GrantReviewSettlementTest)$'
```

`OtterMinimumOutputTest` now includes live local-Node preflight comparisons for
78 deterministic native/ERC20/direction/order-position cases, followed by actual
settlement or exact revert and stored recovery. Its 512 recovery fuzz cases run
on-chain without FFI; the solver separately samples 512 exact BigInt boundaries
and exhausts small minority minimum cases. These are checks of the current rule,
not independent mechanism review or an exhaustive deviation proof. Codes 0–6
retain the original dominant mapping; 7–10 identify length, numeric support,
ineligible minority fill and incorrect minority floor/fill respectively.

These use local solc 0.8.26, Cancun, via-IR, optimizer 200 and 512 fuzz runs.

To reproduce the local LP exit wallet slice, run `npm test` from `web/`, then
`forge test --offline --match-contract '^(OtterExitsTest|OtterLiquidityVaultTest)$'`
from `contracts/`. Wallet tests check the selected ABI against local generated
artifacts, mocked-RPC/session/receipt failures and exact vault claim routing;
the contract suites exercise real custody and execution. These are separate
layers, not a connected-wallet testnet demonstration. The default wallet remains
unconfigured, and no public transaction is required by the runbook.
To reproduce the local history slice, run `npm test` and
`npm run build -- --outDir /tmp/otter-7c-web-dist` from `web/`.
Checkpoint 7C records 47 passing mocked wallet/history/receipt groups and a
synthetic browser preview, including persisted records, stale account reads,
explicit forgetting and admission-ID recovery. No contract suite is claimed as
fresh in 7C because contracts and their ABI are unchanged. History is untrusted,
read-only display data; finality, durable indexing, post-interruption replacement
discovery and actual connector/testnet evidence remain open.

To reproduce 4K's hash-pinned reader slice, run `npm test` and
`npm run build -- --outDir /tmp/otter-4k-web-dist` from `web/`, and from `contracts/`:

```sh
forge test --offline --match-contract '^OtterSnapshotReaderTest$' --fuzz-runs 64
forge test --offline --match-contract '^(OtterExecutionOracleTest|OtterExecutionReferenceTest)$' --fuzz-runs 64
```

Run the commands sequentially. Fresh 4K results: 65 mocked wallet/reader groups,
152 solver groups, a successful TypeScript/production build, eight new reader
tests (64 concentrated fuzz cases), and 44 existing oracle/reference regressions
(64 reference fuzz cases). Forge metadata/storage transport is synthetic, while
the exported storage and supported swaps use actual local core contracts. These
tests do not exercise a provider's canonical-chain behavior or a real wallet.
No numerical quote rule, production Solidity or economic fixture changed. The
reader does not close G2/G3; ownership/epoch authentication and complete finite
counterfactual coverage remain open. Detailed provenance is in the 4K report.

To reproduce 4L's exhaustive-prefix slice, run `npm test` and
`npm run build -- --outDir /tmp/otter-4l-web-dist` from `web/`, then from `contracts/`:

```sh
forge test --offline --match-contract '^OtterSnapshotReaderTest$' --fuzz-runs 64
```

Fresh 4L results: 75 mocked wallet/reader/curve groups, a successful TypeScript/
production build, and 16 local-core reader tests with 64 new exhaustive-curve
fuzz cases and 64 existing single-quote fuzz cases. The Node curve tests also
compare 1,152 exact points over 64 seeded synthetic concentrated frames. Real-core
tests restore opening state between alternative swaps and preserve all quoted
fields/statuses, including the full E1 raw-fill menu and over-capacity request.
The traversal stress fixture includes 140 raw core positions, beyond the
authenticated vault's 32-position admission policy; it tests reader limits, not
admission of that pool. Its gas includes many alternative swaps and is not an
on-chain verifier benchmark. No fresh full solver, broad contract, economic
benchmark, live provider or browser-to-wallet run is claimed in 4L. Numerical
solver/production Solidity and the seven saved research artifacts are unchanged.

To reproduce 4M's opening-record binding slice, run `npm test` and
`npm run build -- --outDir /tmp/otter-4m-web-dist` from `web/`, then sequentially
from `contracts/`:

```sh
forge test --offline --match-contract '^OtterOpeningExecutionTest$' --fuzz-runs 64
forge test --offline --match-contract '^(OtterSnapshotsTest|OtterHistoricalRewardsTest)$' --fuzz-runs 64
```

Fresh 4M results: 88 Node groups, a successful TypeScript/production build,
six local book/core binding tests including 64 fuzz cases, and 30 snapshot/
historical-reward regressions including 64 snapshot-drift fuzz cases. The 13 new
Node groups include 1,152 points across 64 seeded full-range frames, quote/roster/
identity tampering and fabricated schedules. The new bridge compares exact
book commitments and curve hashes with the Solidity oracle, without running
alternative swaps. It covers native/ERC20 epochs, 32 positions, repeated owners,
zero-weight positions, queued exits and expired history at changed live state.
Its transport/anchor/block identity remain synthetic. No fresh full solver,
broad contract, benchmark, real provider or wallet run is claimed. Production
Solidity, numerical rules and saved research evidence are unchanged; a passing
content binding supplies neither authenticated history nor settlement permission.

To reproduce 4N's pinned epoch-collection slice, run `npm test` and
`npm run build -- --outDir /tmp/otter-4n-web-dist` from `web/`, then from `contracts/`:

```sh
forge test --offline --match-contract '^OtterOpeningExecutionTest$' --fuzz-runs 64
```

Fresh 4N results: 101 Node groups, TypeScript/production build and 13 local book/
core tests with two 64-case fuzz groups. Thirteen new Node groups cover ABI
agreement with artifacts, fingerprints/wiring, clocks/exclusivity, lifecycle,
malformed replies, view failures, missing core state, source mutation and detected
chain/block/timestamp drift. Seven new contract tests include 64 collection fuzz
cases and actual native/public-boundary, maximum-roster, zero-weight/pending-exit
and negative lifecycle/live-state comparisons. The prior six binding tests,
including 64 binding fuzz cases, pass in the same run. The separate bridge exports
36 actual staticcall replies and five runtimes; RPC/block metadata remain synthetic.
No alternative swaps, fresh full solver/broad contract suite/economic benchmark,
real provider or wallet session is claimed. The prior 4M 30-regression run is
historical. Production Solidity/rules and saved research evidence are unchanged.

To reproduce 4O, run `npm test` and
`npm run build -- --outDir /tmp/otter-4o-web-dist` from `web/`, followed by the same
targeted `OtterOpeningExecutionTest` command above from `contracts/`.
Fresh 4O results: 114 Node groups, TypeScript/production build and 20 local
book/core tests with three 64-case fuzz groups. The seven added contract tests
compare actual stored-order hashes, original side budgets and global liabilities,
including native custody, expired admission deadlines, 32 orders, maximum fields,
shared-pool escrow/unwithdrawn claims and an actual custody shortfall. The bridge
exports real additional staticcalls/balances; transport/block hash are synthetic.
The first run's unsupported above-uint64 Foundry chain fixture was corrected;
the pure Node test still covers a larger uint256 signing domain. No signatures,
full original counterfactual domain, canonical payments, future delivery or new
mechanism are proved. No fresh full solver/broad suite/benchmark/provider/wallet
run is claimed; production rules and saved economic evidence are unchanged.

To reproduce 4P, run `npm test` and
`npm run build -- --outDir /tmp/otter-4p-web-dist` from `web/`, then the targeted
`OtterOpeningExecutionTest` command above from `contracts/`.
Fresh 4P results: 126 Node groups, TypeScript/production build and 27 local
contract tests with four 64-case fuzz groups. Twelve added Node groups cover
aggregate/missing/partial/unsupported bounds, both removal inventories, changed
content/anchors, frozen output and 64 seeded independently derived inventories
through the 65-case maximum. Seven new contract tests compare actual book
orders, oracle prefix classifications and the versioned ABI hash. Native and
maximum-budget cases stay explicitly incomplete. RPC/block hashes are synthetic;
no pivot computation, canonical rule, signature proof, full scalable original
domain, future delivery or new incentive guarantee is supplied. No fresh solver,
broad suite, benchmark, provider or wallet run is claimed.

To reproduce 4Q, run `npm test` and
`npm run build -- --outDir /tmp/otter-4q-web-dist` from `web/`,
`npm run test:discrete` from `solver/`, then the targeted
`OtterOpeningExecutionTest` command above from `contracts/` with 64 fuzz runs.
Fresh results: 137 Node groups, TypeScript/production build, 17 discrete research
groups and 34 local contract tests with five 64-case fuzz groups. Eleven new
Node groups include 64 independent seeded cases. Seven new contract tests cover
same-address split/merged records, distinct traders, signed fractional-cost minima,
native custody, refusal cases and fuzzed original/removal pivots. Solidity checks
every retained allocation by Cartesian enumeration over actual stored budgets
against independent oracle outputs, then derives all exact and rounded transfers,
minima, deficits and the versioned ABI hash. No accepted economic verifier,
production payment policy, historical signature proof, real provider, future
delivery, two-sided mechanism or new incentive guarantee is supplied. RPC/block
metadata are synthetic; saved research/benchmark artifacts remain unchanged.

To reproduce 4R, run `npm test` and
`npm run build -- --outDir /tmp/otter-4r-web-dist` from `web/`, then the targeted
`OtterOpeningExecutionTest` command above from `contracts/` with 64 fuzz runs.
Fresh results: 148 Node groups, TypeScript/production build and 41 local contract
tests with six 64-case fuzz groups. The eleven new Node groups include
64 independent seeded frontier checks; seven added contract tests independently
derive all original/removal per-quantity minimum vectors, costs, ties and numeric
delivery flags from actual budgets/core output, including native openings at
1:1 and tick -6000. The existing research helper now returns its already verified
hash and uses the actual opening tick for its default limit; old 1:1 behavior is
unchanged. No production contract, solver numerical source, saved economic
artifact, dependency pin, UI action or deployment configuration is changed.
The diagnostic is not constrained-welfare maximization or truthful payments.
No new full solver/broad contract suite, benchmark, provider or wallet run is
claimed. Old research tests/economic evidence retain their historical provenance.

Review `foundry.toml`: FFI is enabled for local reference comparisons and the
test-only gas ceiling is artificially large. That ceiling is not deployment
capacity evidence. Avoid `GasCurveTest` and `SandwichHarness` when preserving the
historical benchmark files; those suites overwrite results. Offline compilation
needs the compiler and dependency checkouts already available. For fresh tooling,
agree on setup separately rather than changing pins to make a test pass.

The [original 8A manifest](./EVIDENCE_MANIFEST.json) remains immutable: its default
verification is for the `2c24344` baseline/archive, and is expected to detect the
later Solidity patch in the current checkout. Do not rewrite old hashes to hide
differences. The [8A report](./CHECKPOINT_8A.md) records the original packet;
[checkpoint 4I](./CHECKPOINT_4I.md) records the safety patch and fresh checks.
The [4I snapshot](./EVIDENCE_MANIFEST_4I.json) is also frozen at its checkpoint
bytes. The separate 4J snapshot adds the checker, local CLI bridge and tests;
changes to the previously hashed solver/test sources are explicitly identified
in the [4J report](./CHECKPOINT_4J.md).
The frozen 4J selection was unchanged by the wallet slices: it selected only the
dashboard from `web/`, so its passing older hash check did not cover the new wallet
changes. In 4K, its selected `solver/src/execution.ts` differs solely by structured
missing-state metadata, and `fixtures/README.md` documents the new bridge.
Its current verification therefore detects those two changes;
retain the older archive for the old content check. The separate 7B snapshot includes wallet files, build configuration,
the existing lockfile and tests, excluding installed packages and generated builds.
The 7B manifest remains frozen at its checkpoint bytes; at 7C, five selected wallet
files differed from it. The separate 7C snapshot covers those changes plus the
four new journal/inspection/interface files. Its selected `solver/src/execution.ts`,
`web/package.json` and `fixtures/README.md` now differ in 4K. The separate 4K snapshot selects 278 files,
adding the reader, mocked tests, local FFI bridge and real-core test. All earlier
manifests retain their bytes. The 4K snapshot is now also frozen: five selected
files differ in 4L (the reader, Node test/bridge, Solidity reader test and fixture
README). The new 4L snapshot retains the same 278-file selection and records
those changed bytes, without altering earlier hashes. The 4L manifest is now
frozen: two selected files differ in 4M (`web/package.json` and the fixture README).
The separate 4M manifest retains that selection and adds four binding/test files,
for 282 selected files. The 4M manifest is now frozen: three selected files change
in 4N (the Solidity binding suite, package test entry and fixture README). The
separate 4N manifest adds three collector/test/bridge files for 285 selected files.
The 4N manifest is now frozen: five selected files differ in 4O (the Solidity
suite, fixture README, package test entry, epoch Node test and staticcall bridge).
The separate 4O snapshot adds the complete stored-batch collector, its Node tests
and extracted shared fixture, for 288 selected files. Earlier manifests retain
their bytes.
The 4O manifest is now frozen: four selected files differ in 4P (the Solidity
suite, fixture README, package test entry and bridge). The separate 4P snapshot
adds the coverage inspector, Node tests and original-domain requirements for
291 selected files, without modifying earlier manifest bytes.
The 4P manifest is now frozen: six selected files differ in 4Q (the Solidity
suite, fixture README, package test entry, bridge, coverage Node test and shared
batch fixture). The separate 4Q snapshot adds the bound adapter and Node tests
for 293 selected files, retaining all earlier manifest bytes.
The 4Q manifest is now frozen: four selected files differ in 4R (the Solidity
suite, fixture README, package test entry and bridge). The separate 4R snapshot
adds the signed-minimum inspector and Node tests for 295 selected files; older
manifests remain byte-for-byte frozen.
A passing content check supplies
identity only, not authenticated history, receipt correctness or grant readiness.
A reviewer should retain their own tool versions,
logs and content identifiers, and explain any reproduction difference. No
external transfer or publication is authorized by this local packet.


To reproduce 4S, run `npm test` and
`npm run build -- --outDir /tmp/otter-4s-web-dist` from `web/`, then
`npm run test:transfers` from `solver/`. From `contracts/`, run the targeted
`OtterOpeningExecutionTest` command with 64 fuzz runs, with generated build/cache
outputs in `/tmp`. The diagnostic is research tooling and is not called by the
wallet UI or production settlement. The test-only `--menu` capture bridge exports
actual isolated alternative stored states with synthetic transport/block identity.
Direct Solidity utility and signed-floor cycle checks do not reuse the graph
checker. No saved economic artifacts or production numerical rules are changed.
The separate [4S manifest](./EVIDENCE_MANIFEST_4S.json) retains the frozen 295-file
4R selection and adds the adapter and Node tests. Four old selected files differ:
the Solidity suite, fixture README, package test entry and bridge. Earlier
manifests remain frozen. Content identity is not proof, signatures, external
review, future settlement or deployment certification.

Fresh 4S results: 159 Node groups (eleven new, including 64 seeded independent
menu checks), TypeScript/production build, 12 existing transfer research groups
and 45 targeted contract tests with six 64-case fuzz groups. Four new actual-core
menu tests are added; all 41 old contract tests pass. The import closure remains
97 files. Native test setup optionally accepts liquidity and the research helper
optionally accepts its declared down limit; defaults and production behavior are
unchanged. See the checkpoint report for the exact 15-file commit handoff.
