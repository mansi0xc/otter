# Checkpoint 4O — complete stored-batch binding and shared custody coverage

Prepared 6 October 2026. Starting commit:
`e9eecb576255ea2eee9a31cbb8987758016880c3`. The working tree was clean.
Status: **local batch collection verified; waiting for the user's commit**.

## Outcome

[The complete-batch collector](../web/src/protocol/epochBatch.ts) extends 4N's
pinned full-range epoch context with every stored order and current shared
custody obligations. This closes the gap between a checked count/digest and the
actual order sequence supplied to further research. It does not select or prove
a canonical allocation/payment mechanism or establish grant qualification.

`captureEpochBatch(rpc, source, request)` accepts the same caller-configured
source and epoch request. It first runs the unchanged 4N collector and its
runtime/wiring/opening/lifecycle/caller checks. All added state calls use that
same block hash with `requireCanonical: true`. Native custody requires the same
hash selector on `eth_getBalance`; an unsupported selector fails without a
number/latest fallback. There is no HTTP adapter or signing/sending method.

The additional checks are:

1. Obtain exactly the complete stored 1–32-order sequence. Check its static tuple
   array offset, exact count and byte length before decoding, then require
   canonical decode/reencode. Scalar replies and empty `replay` replies must
   also be bounded and canonical.
2. Require every order's pool/configuration/epoch to match the checked context,
   with nonzero trader, exact boolean side, uint128 ask, positive uint96 budget,
   uint64 admission/execution times and uint256 nonce. Each side's aggregate
   must fit uint96. Trader/nonce pairs are unique; the same nonce across different
   traders is valid. Execution validity must reach `executeUntil`. Admission
   deadlines may already have passed and do not become settlement deadlines.
3. Reproduce the original ordered rolling digest using the book's order hash and
   compare with the stored digest. Check the exact order type hash and EIP-712
   `OtterOrderBook`/`2`/BigInt-chain/book domain against the actual getters.
4. Require every recovery flag false and each admitted nonce bit present. Cache
   bitmap reads per trader/word while checking every order index/bit separately.
5. For both currencies, global `totalEscrow` must cover this batch's original
   side budget. The book's actual native/ERC20 balance must cover the checked
   uint256 sum of global escrow plus `totalClaimable`. These ledgers cover other
   pools/epochs sharing a currency; requiring equality with this batch would
   incorrectly reject valid shared custody.
6. Require the book's `replay(pool, epoch, orders)` to succeed. Recheck the selected
   numbered block's hash/timestamp and chain after all additional reads. Any
   error aborts without returning a partially successful batch or retrying.

`storedBatchCommitment` is a pure validator, not network authentication. It copies
only the ten primitive order fields and returns detached frozen orders, order
sequence hash, rolling digest, domain separator and original side budgets.
`storedBatchReads` emits the bounded extra staticcall plan used in local contract
comparisons. `BATCH_ABI` is separate from the existing wallet ABI.

The collected result retains 4N's `binding`, `record`, `frame` and `eligibility`,
and adds frozen normalized `orders`, a frozen two-entry `liabilities` array with
frozen entries, and primitive `batchBinding`. The latter includes the opening
binding, count, order hash, rolling digest, domain separator and original budgets.
Record/frame maps and quotes remain mutable; returned hashes do not certify
later mutations or identify the entire RPC transcript/configuration.

The maximum is **288 RPC operations**: 4N's 212 plus three order/domain/type reads,
up to 32 recovery flags and 32 distinct nonce words, four ledger reads, two
currency balances, one replay and two final metadata queries. Native balance
replaces one ERC20 view. Word caching reduces the actual count. This is a bound
from existing limits, not measured production latency, gas or capacity. Provider
timeouts/cancellation remain adapter behavior.

## Fresh validation and provenance

- `web/: npm test`: **114 groups passed**, zero failures/skips/cancellations.
  Thirteen new groups cover ordered digest/content tampering, missing/duplicated
  orders, admitted bounds and aggregate budgets, maximum values, wide chain
  domains, expired admission deadlines, distinct traders sharing a nonce,
  immutable detached output, shared native/ERC20 escrow and claims, 32 orders
  with cached nonce words, maximum read-plan bounds, domain/type/recovery/nonce/
  replay failure, insufficient coverage/uint256 overflow, hostile arrays/scalars,
  missing/provider failures, unsupported native hash selectors, extra metadata
  drift, control mutation during awaits and ABI agreement with local artifacts.
  The prior 101 groups pass after extracting their unchanged mock fixture into
  a shared test helper. These RPC transports are mocked.
- `web/: npm run build -- --outDir /tmp/otter-4o-web-dist`: TypeScript and
  production build passed. The existing approximately 951 kB main-chunk warning
  remains. Installed packages/pins and tracked `web/dist/` are unchanged; the
  product UI does not invoke this collector and its deployment manifest stays null.
- `contracts/: forge test --offline --match-contract '^OtterOpeningExecutionTest$'
  --fuzz-runs 64`: **20 tests passed**, zero failures/skips. Seven new complete-
  batch tests include **64 batch fuzz cases**; the retained 13 tests include
  another 64 opening-binding and 64 epoch-collection fuzz cases.
- The extended test bridge emits extra reads, exports actual staticcall success/
  revert results and actual native custody, then serves them alongside the five
  actual runtimes and core storage through its synthetic RPC. Solidity compares
  all original epoch/commitment/curve metadata, the exact ABI order-sequence hash,
  original side-budget sums and every current balance/escrow/claim quantity with
  the actual book and tokens. The independent oracle comparison is retained.
- Actual cases cover mixed sides, repeated traders, nonce bits 255/256 and shared
  nonces across different traders; expired admission deadlines; 32 orders within
  one nonce word; native/ERC20 custody at public exclusivity; maximum uint96
  budgets/uint128 asks/uint64 times/uint256 nonces; a wide block number and maximum
  uint64 chain identity; and a second pool's escrow plus an unwithdrawn prior
  refund claim. An intentionally underfunded local book must fail without output.
  Fuzzing varies chain/block, uint96 budget, uint256 nonce, side and quote caps 0–8.
- The first contract run passed 19 cases and failed its oversized chain fixture
  because Foundry's chain environment is limited to uint64. The fixture was
  corrected and the complete 20-test run passed. The pure Node test retains a
  uint256 chain-domain check beyond that environment limit. No production rule
  was narrowed to satisfy the test tool.
- RPC and block hash identity remain synthetic. No alternative swaps, real
  provider, wallet session, full solver/broad contract suite or benchmark run is
  claimed fresh. Earlier swap/reward/economic evidence is historical. Test gas
  includes repeated fixture/FFI/oracle work and is not deployable verifier capacity.
- [The 4O manifest](./EVIDENCE_MANIFEST_4O.json) records **288 selected files**:
  the frozen 4N selection plus the batch collector, Node tests and shared fixture.
  Five previously selected files differ: the Solidity suite, fixture README,
  package test entry, epoch Node test and bridge. Its Solidity import closure
  includes 97 selected files. Earlier manifests remain byte-for-byte frozen.
  This unsigned content identity describes local pending-checkpoint bytes,
  not equality with the pre-checkpoint commit or an independent audit.

Temporary logs are `/tmp/otter-4o-web.log`, `/tmp/otter-4o-build.log`,
`/tmp/otter-4o-core.log`, the first-attempt diagnostic log and
`/tmp/otter-4o-check-handoff.log`. Build outputs and temporary logs are not selected
evidence or committed artifacts.

## Remaining boundaries

Configured book code and RPC remain trust inputs. Stored signatures are not
retained or revalidated. EIP-1271 validation can change after admission; checking
it today would not prove the historical result. A nonce bit may also have been
set by invalidation and is not standalone signature proof. Admission is trusted
through the configured book implementation, not inferred from that bit alone.

The shared ledger check relies on that implementation's accounting; it does not
enumerate and independently prove every other batch's obligations. Token code/
behavior is not authenticated by these extra balance reads. Current coverage
does not prove future delivery, rebase behavior, consensus/finality or that a
later transaction can settle. Epoch/caller eligibility does not upgrade partial
or unsupported curve rows or authorize a wallet send.

Original uint96 budgets and signed values remain intact. The unchanged 0–64
research prefixes do not supply full original-budget or leave-one-out coverage.
**G1–G4 remain open; concentrated auction admission and swaps remain gated.**
Canonical allocation/payments, whole-payment incentives/liveness and combined
trader/LP redistribution remain unresolved. No production Solidity, mechanism,
asset/utility/valuation, minimum trade or weaker guarantee is selected. Next
specify full original-domain/counterfactual and canonical witness obligations
alongside a compatible mechanism; concentrated integration and independent
review remain necessary for grant evidence.

## User-created commit handoff

Suggested title:

```text
feat: bind stored batches and check shared custody
```

Suggested explanation:

> Bind complete admitted orders, original budgets and signing domains to the
> pinned epoch. Check replay, recovery and nonce bits, then require native/ERC20
> custody to cover shared escrow and claims; add offline and real-contract tests.

The assistant has not staged or committed anything. Commit these **16 files**
and confirm before work continues:

```text
README.md
contracts/test/OtterOpeningExecution.t.sol
fixtures/README.md
reviews/CHECKPOINT_4N.md
reviews/CHECKPOINT_4O.md
reviews/EVIDENCE_MANIFEST_4O.json
reviews/IMPLEMENTATION_SPEC.md
reviews/MECHANISM_REVIEW_BRIEF.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/package.json
web/src/protocol/epochBatch.ts
web/test/epochBatch.test.ts
web/test/epoch-batch-fixture.ts
web/test/epochSnapshot.test.ts
web/test/epoch-snapshot-cli.ts
```
