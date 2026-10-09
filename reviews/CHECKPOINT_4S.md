# Checkpoint 4S — complete bound ask-response transfer diagnostics

Prepared 8 October 2026. Starting commit:
`b25bea017f07b37f9a64b24912dc825ebbeb3dec`. The tree was clean, and 4R was
committed by the user. Status: **local diagnostics verified; waiting for the
user's commit**. No Git staging/commit, production rule or external action was
performed in this checkpoint.

## Outcome

[The new pure inspector](../web/src/protocol/reportMenu.ts) compares finite
ask-response profiles that freshly revalidate the complete small original
one-sided domain. Only one target record's ask may change. Its original budget,
identity, nonce, clocks, other orders and opening/execution context stay fixed.
It reuses the existing integer transfer checker and verifies every returned
necessary payment/cycle certificate before returning detached, frozen results.

An actual native/core case now separates integer truthfulness from delivery and
funding. All chosen efficient fills satisfy the original signed minima, and the
candidate ceil pivots are funded, yet **no whole-unit target payments implement
those efficient ask responses truthfully**. This strengthens the earlier 4H
partial-original-capacity witness: this opening fully consumes every request in
the original aggregate domain. It closes neither G1–G4 nor the concentrated gate.

## Exact complete-original witness

Quantities are raw underlying asset units; asks are original WAD rates. Utility
for the stated single-role linear hypothesis is `payment*WAD - trueAsk*input`.
The pool is zero-fee full-range, at 1:1 with liquidity **2**, native currency0 and
ERC20 currency1. The declared down limit is tick -60000. Actual oracle results:

| Requested input q | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| Consumed input | 0 | 1 | 2 | 3 | 4 |
| Output F(q) | 0 | 0 | 1 | 1 | 1 |

The target and fixed rival each have original budget 2; rival ask is WAD/8.
Target asks are WAD/16, WAD/8 and 3WAD/16. Every original/removal calculation uses
this same complete original table. The unrestricted one-sided exact linear
welfare hypothesis chooses target input **2** at the low ask and **0** at the
high ask. At the middle ask, the existing deterministic order-hash tie may select
either trader; the proof below needs only the two strict endpoint choices.

At each profile the one filled budget-2 record receives one output unit under
ceil pivot payments. Its signed minimum is also one; the unfilled record needs
zero. Thus the chosen fill is deliverable and the ceil total is funded. There is
no partial-consumption, missing-original-prefix or minimum shortfall excuse in
this example.

Let pL and pH be any whole-unit target payments at the endpoint reports.
Truthfulness at true low ask requires `pL-pH >= 2/16 = 1/8`; truthfulness at true
high ask requires `pL-pH <= 6/16 = 3/8`. **[1/8,3/8] contains no integer.**
Equivalently, the exact integer pair constraints demand both `pL-pH >= 1` and
`pL-pH <= 0`. The returned loose certificate has a checked closed
truthfulness-only negative cycle of weight -1. Because it uses no funding,
minimum or payment-normalization edges, these restrictions do not cause the
contradiction. Even allowing signed whole-unit payments would not change the
nonintegral difference requirement.

Under the diagnostic ceil-pivot candidate, a target with true ask 3WAD/16 has
truthful input/payment 0/0, hence utility 0. Reporting WAD/16 instead gives input
2 and payment 1, hence true utility **5WAD/8**, or 5/8 raw output units. This is
an isolated hypothetical candidate calculation; it is not evidence of a live
production exploit, token trading profits or a universal impossibility result.

The claim is scoped to this fixed opening, original budget/utility domain,
unrestricted one-sided efficient fill response and whole-output-unit transfers.
It does not show the paper's continuous theorem is wrong or that every Otter
mechanism is impossible. Escaping the conflict requires an explicit compatible
mechanism/representation/domain argument; none is selected or silently adopted.

## Binding and necessary certificates

The pure API accepts **1–16 distinct target asks**, target index 0–7, and complete
4Q profiles. Each profile freshly runs the independent scan/Cartesian original
and removal checks with the existing bounds: 1–8 original records, full aggregate
input at most 64, original budget-vector bound at most 100,000. A saved research
result, flag or hash is not trusted. No quantity/domain is sampled or narrowed.
The diagnostic requires one target record and no directly owned opening LP
position: this states its single-role hypothesis, not new production admission.
Controlled aliases, indirect beneficial ownership, builder roles and auxiliary
benefits are not authenticated or excluded by an address check.

The common context hash binds opening/curves hashes, read block number/hash,
manager runtime and order-domain separator. The common original-order-array
comparison hash masks **only the selected ask**; all other fields and sequence
stay intact. Snapshot content already binds configuration, clocks, roster,
ownership, weights, pool, chain/book/epoch and reward policy. A changed source,
curve, clock, budget, identity, nonce or other report cannot form a common menu.
Alternate actual fixture worlds share the same configured runtimes, wiring and
capture checks; the pure context key does not independently authenticate code.

Each row retains target input, original target/other minima, actual chosen
output, 4Q/order/target hashes and candidate ceil-pivot/funding diagnostics.
Two necessary integer problems are reported:

- **Loose:** target payments range from 0 to the existing MAX_OUTPUT representation
  bound; every pair of true/report utility inequalities is enforced.
- **Funded:** lower bound is the target's original signed minimum and upper bound
  is chosen output minus the sum of all other original minima. This is only room
  for target payments, before extra obligations, rewards and joint incentives.
  If another-minimum sum exceeds output at any profile, funded analysis is
  **unavailable (kind 0)**; zero available payment is then only a sentinel, never
  a falsely funded zero-budget graph.

Kind 1 has a checked finite necessary payment certificate. It proves neither
truthfulness on unseen asks/budget/identity strategies nor simultaneous truthful
payments for other participants, joint roles or repeated epochs. Kind 2 has a
checked closed negative cycle; every edge and signed floor weight is validated
against the exact problem. The actual-contract tests check direct scaled utility
inequalities or the exact floor bracket and closed cycle independently of the
graph algorithm. The versioned `OtterBoundAskResponse/v1` ABI hash covers context,
fixed fields, normalized rows and both certificates. It is calculation identity,
not an accepted canonical settlement witness or transaction permission.

Pure anchors remain caller authenticated. The test-only `--menu` bridge reuses
4O complete stored capture, runtime/wiring checks, block pinning and custody/
nonce/recovery checks. Each exported profile is bounded/canonical; the outer
fixture array is 1–16 and at most 8,000,000 hexadecimal characters, with the
existing 500,000-character per-profile cap retained. Host command-argument limits
can impose a smaller practical local test transport size. These are research
bounds, not measured production capacity or new on-chain admission limits.

## Fresh validation and provenance

- **159 Node groups passed**, zero failures/skips/cancellations. Eleven new groups
  include 64 independently checked seeded menus. They cover the complete scarce
  witness, constant-fill necessary feasibility, delivery-only incompatibility,
  other-minimum deficit/unavailable funding, fixed original field/sequence and
  source/context guards, direct opening ownership/repeated-record hypothesis,
  report count/duplicate/index/incomplete-domain refusal, sixteen reports,
  reverse currencies, maximum nonce, ABI hashing, deep freeze and revalidation.
- **TypeScript and production build passed** into `/tmp/otter-4s-web-dist`.
  The existing approximately 951 kB main-chunk warning remains. Tracked web/dist,
  UI actions, null deployment configuration, package pins and locks are unchanged.
- **12 existing transfer implementability research groups passed**, including
  1,000 bounded graph problems checked against exhaustive payment search
  (983 independently infeasible), 125 raw allocation menus and golden artifact
  comparison. Existing numerical sources and saved artifacts were not modified.
- **45 targeted local contract tests passed**, zero failures/skips: four new
  actual-contract report-menu tests plus all 41 retained tests. The six retained
  fuzz groups each run 64 cases, for **384 contract fuzz cases**. New Node seeded
  menus are separate from this count; no new contract fuzz group was added.
- Actual tests independently validate every 4Q original/removal vector against
  oracle output, profile fields/hashes, context/fixed fields, normalized menu hash
  and direct utility/cycle certificates. Cases include native liquidity 2,
  reverse-currency constant fills, signed-minimum failure, other-minimum shortage
  and changed original budget refusal. Snapshots isolate alternative worlds;
  exported contract reads/storage are actual, but block identity and RPC
  transport are synthetic, not simultaneous real historical alternatives.
- Native pool test setup now optionally accepts liquidity; its existing default
  remains 1000. The research helper accepts an optional declared down limit;
  existing defaults/old tests are unchanged. No minimum-frontier algorithm or
  production pool/quote/admission behavior changes.
- Initial validation caught an implicitly inferred callback type and address
  checksum comparison in the new diagnostic; both were corrected. The direct
  opening-LP-owner refusal test now passes. The final full validation above is
  against the corrected source.
- [The 4S manifest](./EVIDENCE_MANIFEST_4S.json) selects **297 files**, retaining
  the 295-file 4R selection and adding the inspector and Node tests. Four old
  selected files differ: Solidity suite, fixture README, package test entry and
  bridge. The Solidity import closure remains **97 files**. Earlier manifests
  remain byte-for-byte frozen. This unsigned local-content snapshot does not
  assert equality with its pre-checkpoint baseline or safety certification.

Reproduce with already installed pins:

```sh
# web/
npm test
npm run build -- --outDir /tmp/otter-4s-web-dist
# solver/
npm run test:transfers
# contracts/ — one Forge job, freeze source until it finishes
forge test --offline --match-contract OtterOpeningExecutionTest --fuzz-runs 64 \
  --out /tmp/otter-4s-forge-out --cache-path /tmp/otter-4s-forge-cache
# repository root
python3 reviews/verify_evidence.py --root . --manifest reviews/EVIDENCE_MANIFEST_4S.json
```

Temporary logs are `/tmp/otter-4s-web.log`, `/tmp/otter-4s-build.log`,
`/tmp/otter-4s-transfers.log`, `/tmp/otter-4s-forge.log` and
`/tmp/otter-4s-check-handoff.log`. Logs/generated builds are uncommitted and not
selected evidence. No fresh broad contract/full solver suite, economic benchmark,
provider/RPC, wallet, deployment, independent external review or grant submission
is claimed. Avoid GasCurveTest/SandwichHarness: those overwrite saved benchmarks.
Local fixture gas and graph counts do not measure an accepted production verifier.

## Completion and next decision

[Completion status](./COMPLETION_STATUS.md) answers how far the project is from
completion. Local safety/custody/execution/evidence foundations are implemented
and tested, but mechanism compatibility, canonical verification, concentrated
auctions, external reviews, current live integration and complete economics are
still major stages. A research-grant packet is closer; actual applicant, owners,
effort/rates/budget/reviewer arrangements and current intake terms remain needed.
No credible percentage/date follows from commit or test counts. The old draft's
conditional eight-week research schedule is not a finish estimate.

Next consolidate the fixed assumptions, proven conflicts and open obligations
into an explicit claim matrix and implementation decision. New experiments must
answer a named obligation or a concrete compatible proposal. This checkpoint
selects no replacement rule, new report/budget/minimum restriction, payment asset,
subsidy, joint-role policy or weaker guarantee. G1–G4 and concentrated auctions
remain gated under the user's guarantee-preserving preference.

## Exact commit handoff

Exactly these **15 paths**, including new files, belong to this checkpoint:

```text
README.md
contracts/test/OtterOpeningExecution.t.sol
fixtures/README.md
reviews/CHECKPOINT_4R.md
reviews/CHECKPOINT_4S.md
reviews/COMPLETION_STATUS.md
reviews/EVIDENCE_MANIFEST_4S.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/package.json
web/src/protocol/reportMenu.ts
web/test/reportMenu.test.ts
web/test/epoch-snapshot-cli.ts
```

Suggested commit title: **`test: validate bound ask-response incentives`**

Short explanation: Bind complete original ask-response profiles, independently
verify integer payment/cycle certificates, reproduce a funded-but-untruthful
actual-native allocation witness, and document the remaining completion path.
Please create the commit yourself, then confirm before further checkpoint work.
