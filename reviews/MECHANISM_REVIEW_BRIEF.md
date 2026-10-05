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
[EVIDENCE_MANIFEST_7C.json](./EVIDENCE_MANIFEST_7C.json). That manifest records the
pre-patch baseline, local checkpoint, dependency commits and observed tools.
It identifies the post-patch selected bytes and does not hash this brief or later
status edits, authenticate an author, inspect unlisted files, or certify safety.
Source content hashes also cover the imported vendor Solidity, rather than
relying on submodule HEAD alone. Review the verifier before running it.

From the repository root, with the already available tools:

```sh
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_7C.json
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
The frozen 4J selection is unchanged by the wallet slice: it selected only the
dashboard from `web/`, so a passing older hash check does not cover the new wallet
changes. The separate 7B snapshot includes wallet files, build configuration,
the existing lockfile and tests, excluding installed packages and generated builds.
The 7B manifest remains frozen at its checkpoint bytes; five selected wallet
files now differ from it. The separate 7C snapshot covers those changes plus the
four new journal/inspection/interface files. A passing content check supplies
identity only, not authenticated history, receipt correctness or grant readiness.
A reviewer should retain their own tool versions,
logs and content identifiers, and explain any reproduction difference. No
external transfer or publication is authorized by this local packet.
