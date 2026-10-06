# Checkpoint 4Q — original-domain stored-batch pivot diagnostics

Prepared 6 October 2026. Starting commit:
`14044fe2db62afbe080010965ca27a7074cdefaa`. The working tree was clean.
Status: **local bound calculations verified; waiting for the user's commit**.

## Outcome and unresolved failures

[The new pure adapter](../web/src/protocol/boundResearch.ts) connects the complete
stored-batch/opening binding and original-prefix coverage guard to the existing
one-sided linear-welfare laboratory. Every original, single-record removal and
whole-address removal is optimized and independently checked on the same full
original raw-unit domain. The adapter exposes exact and rounded transfer
diagnostics without selecting a production payment or participant policy.

Actual admitted orders and Uniswap core oracle output reproduce the following
integer witnesses at a zero-fee 1:1 opening. All budgets/inputs/outputs below are
raw underlying asset units, not whole human-display tokens. The relevant table
is **F(0)=0, F(1)=0, F(2)=1**. Exact costs, welfare and payments use WAD-scaled
raw output numerators; whole-unit delivery requires an integer output amount.

| Original records | Optimal fills / output | Record pivots | Whole-address pivots | Consequence |
| --- | --- | --- | --- | --- |
| Same trader, two budget-1 records, ask 0 | `[1,1]` / 1 | 1 unit each; total 2 | 1 unit for the address | Record raw and ceil deficits are 1; grouping changes this calculation |
| Same trader, one budget-2 record, ask 0 | `[2]` / 1 | 1 unit | 1 unit | Same aggregate input/output, different record-payment total |
| Distinct traders, two budget-1 records, ask 0 | `[1,1]` / 1 | 1 unit each; total 2 | 1 unit each; total 2 | Address grouping does not resolve the integer funding deficit |
| Same trader, two budget-1 records, ask WAD/4 | `[1,1]` / 1 | 3/4 unit each; each ceil 1 | Exact and ceil payment 1 unit | Group payment is funded, but two original per-record minima need 2 units |

For the last row, exact base welfare is WAD/2. Each single-record removal has
zero optimal welfare; each record pivot is 3WAD/4, with floor 0, ceil 1 and
signed minimum `ceil((WAD/4)*1/WAD)=1`. The record raw deficit is WAD/2 and
ceil deficit is one unit. Removing both records has zero welfare, so the grouped
pivot is WAD: aggregate minimum is one, while the sum of original minima is two.
`groupedCeilMeetsRecordMinimums` is false. No division of a one-unit group payment
can deliver one unit to both original filled records. Replacing per-record IR
with aggregate IR would change delivery semantics; this checkpoint does not do it.

The zero-ask split witness also reproduces for actual native-input orders.
These calculations are scoped hypothetical pivots. Production settlement does
not execute this new adapter, and these results alone establish neither a
profitable production exploit nor a universal impossibility theorem. In
particular, no address grouping, distribution policy, report restriction,
fractional asset or subsidy is adopted as a fix.

## Bound computation and identity

`researchBoundOneSidedBatch(anchor, record, frame, orders)` accepts the same
caller-authenticated 4O inputs as the 4P coverage guard. It revalidates mutable
record/frame/order content and requires supported, fully consumed rows for every
required original/removal prefix, with explicit zero rows in both directions.
It derives the trading direction from all original orders; mixed batches are
rejected instead of dropping opposing orders or selecting one side silently.

The existing laboratory bounds are **1–8 original records**, at most **64 original
raw input units**, and at most **100,000 original Cartesian budget vectors**.
The vector bound is the exact product of `(original budget + 1)` for every record.
The coverage guard rejects missing/unsupported/partial data; record/work bounds
reject excessive computation before optimization. No quantity is sampled,
clipped, rescaled or replaced to fit. These bounds constrain local research work,
not production admission, useful trade sizes or measured verifier capacity.

All cases share the full original directional output table and price limit.
Removing a record/address changes retained reports and available quantities,
without shortening the original table or changing retained budgets/asks/IDs.
The original batch and each of at most 16 removal cases agree between quantity
scan and independent Cartesian optimizers in fills, input, output, exact welfare
and cost. The fixed research tie order is greater welfare, greater input, then
greater fill in ascending ask/order-hash priority. This tests the existing
laboratory hypothesis; it selects no canonical production rule.

Each case preserves omitted and retained original indices, retained-order hash,
aligned fill vector, exact objective quantities and both evaluation counts.
Record diagnostics retain the original order hash/address, spent/unspent input,
verified single-removal welfare, exact pivot and floor/ceil/minimum/IR checks.
Whole-address diagnostics retain all member indices, group cost, verified
all-records removal welfare, pivot, aggregate minimum, original per-record minimum
sum, summed record pivots/ceils and the exact record-versus-group difference.
An address is not proof of beneficial ownership or an alias/LP removal model.

Raw funding differences and ceil residuals stay signed. Positive deficits remain
failures, not clamped payments, refunded-on-deficit fallback, borrowed escrow or
a funded LP reward pot. Group minimum coverage is only a necessary diagnostic;
no group-payment division or trader/LP utility is supplied. Both directions use
their actual sold/payment currencies; no two-sided common objective is invented.

The detached result is frozen through all objects/nested arrays. The versioned
`OtterBoundOneSidedResearch/v1` ABI hash binds the 4P coverage hash and normalized
calculation fields, including all transfers and signed deficits. It supplies
local input/calculation identity, not an accepted on-chain economic witness.
Mutable input frames must still be revalidated when reused. The pure function
makes no RPC, authenticates no new anchor and rechecks neither current lifecycle/
custody nor historical signatures. The test bridge first calls the existing
complete 4O collector using synthetic RPC/block metadata.

## Fresh validation and provenance

- `web/: npm test`: **137 groups passed**, zero failures/skips/cancellations.
  Eleven added groups cover split/merged/distinct traders, original signed
  fractional asks/minima, every retained allocation/removal, reverse currency
  orientation and maximum nonce, zero allocation/maximum asks, incomplete/
  unsupported/partial prefixes, missing opposite zero domain, excess records/
  work and mixed batches, exact-consumption price endpoints, content/hash/freeze
  validation and **64 seeded independently checked bound cases**. Existing 126
  groups pass. The coverage fixture is extracted into the shared helper without
  duplicate test registration. Their data transport and trusted anchor are mocked.
- `web/: npm run build -- --outDir /tmp/otter-4q-web-dist`: TypeScript and
  production build passed. The existing approximately 951 kB main-chunk warning
  remains. Package pins/lockfile and tracked `web/dist` are unchanged; only the
  test script adds the new suite. The UI does not call the adapter and the
  deployment manifest remains null.
- `solver/: npm run test:discrete`: **17 groups passed**. This reruns the existing
  independent optimizer/pivot, finite-concavity, deviation and saved-counterexample
  checks, including 3,000 bounded model tables and 1,000 finite concave tables.
  Unsafe-candidate reproductions remain open findings. No numerical solver source
  or saved research/benchmark artifact changes, and no full solver run is claimed.
- `contracts/: forge test --offline --match-contract '^OtterOpeningExecutionTest$'
  --fuzz-runs 64`: **34 tests passed**, zero failures/skips. Seven new tests include
  **64 bound-research fuzz cases**. The four retained binding/epoch/batch/coverage
  fuzz groups also run 64 cases each: **320 contract fuzz cases** in total.
- The new test-only `--research` mode obtains the actual complete stored batch,
  runtimes, staticcall replies, balances and core storage through the existing
  bridge. Solidity reconstructs all omitted/retained orders and hashes. A separate
  Cartesian enumerator visits every retained budget vector against independent
  oracle outputs, checks the tie result and evaluation counts, then derives every
  record/group transfer, minimum, deficit and normalized ABI hash. It does not
  merely compare Node scan with itself or trust the returned deficit flags.
- Actual cases cover split/merged and distinct-address records, the original
  signed per-record minimum witness and native input, plus rejection of missing,
  partial, unsupported and mixed inputs, excess original records and excess work.
  Fuzz cases vary both directions, count 1–3, budgets 1–3, asks through 2WAD and
  repeated/distinct addresses. This does not exhaust every admitted budget/ask.
- Initial validation corrected an ABI TypeScript declaration, a test expectation
  for a fully consumed endpoint (the actual status is `Complete`; partial rows
  beyond it remain `PriceLimit`), and invalid local Solidity declaration syntax.
  The final complete runs pass. Numerical/status behavior was not changed.
- [The 4Q manifest](./EVIDENCE_MANIFEST_4Q.json) selects **293 files**, retaining the
  frozen 291-file 4P selection and adding the adapter and Node test. Six previously
  selected files differ: Solidity suite, fixture README, package test entry,
  test bridge, coverage Node test and shared batch fixture. The selected Solidity
  import closure remains 97 files. Earlier manifests stay byte-for-byte frozen.
  This unsigned pending-local-content snapshot is not equality with the baseline
  commit, authenticated history, independent review or safety certification.

Temporary logs: `/tmp/otter-4q-web.log`, `/tmp/otter-4q-build.log`,
`/tmp/otter-4q-discrete.log`, `/tmp/otter-4q-core.log` and
`/tmp/otter-4q-check-handoff.log`. Temporary build/log files are not selected
evidence or committed artifacts. Local fixture/FFI/oracle gas does not benchmark
an accepted production verifier. No alternative swap or real RPC/provider,
wallet, new broad contract suite, deployment or external submission is claimed.

## Remaining work

**G1–G4 remain open; concentrated auction admission and swaps remain gated.**
Complete input data does not turn the legacy feasible noncanonical settlement
into a mechanism implementing the paper's guarantees. The new adapter uses only
the existing one-sided raw-unit linear-cost hypothesis. General original-budget
computation, two-sided units/direction/netting, finite-capacity adaptations,
canonical on-chain verification and measured resources remain unresolved.
Address removal neither merges aliases nor removes associated LP ownership;
combined trader/LP and repeated-epoch incentives remain open. Caller-authenticated
anchors, configured code/RPC trust, token behavior, future delivery and finality
boundaries remain explicit. [Original-domain requirements](./ORIGINAL_DOMAIN_REQUIREMENTS.md)
continue to govern a future selected rule and complete accepted witness.

The next investigation must preserve original per-record delivery while checking
useful integer allocations, funding and the requested incentives together. A
funded aggregate or a promising tiny case alone cannot justify adopting a rule.
Production Solidity, numerical rules, valuations, asset/utility representation,
minima and wallet actions are unchanged. No weaker guarantee is selected and
this checkpoint does not establish grant qualification.

## User-created commit handoff

Suggested title:

```text
test: bind pivot research to complete stored batches
```

Suggested explanation:

> Check original and record/address-removal allocations against independent
> optimizers and actual core outputs. Preserve signed quantities and expose
> funding deficits and per-record minimum failures without changing payment rules.

The assistant has not staged or committed anything. Commit these **16 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterOpeningExecution.t.sol
fixtures/README.md
reviews/CHECKPOINT_4P.md
reviews/CHECKPOINT_4Q.md
reviews/EVIDENCE_MANIFEST_4Q.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/package.json
web/src/protocol/boundResearch.ts
web/test/boundResearch.test.ts
web/test/batchCoverage.test.ts
web/test/epoch-batch-fixture.ts
web/test/epoch-snapshot-cli.ts
```
