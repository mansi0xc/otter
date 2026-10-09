# Otter research dashboard and hardened wallet

Vite + React + TypeScript with wagmi/RainbowKit. The guided story uses historical
fixtures. The September Sepolia addresses in `src/config/contracts.ts` are
explorer references only. No public solver or hardened deployment is configured.
The default `src/config/deployment.json` contains `{"deployment":null}`: no
order approvals, signatures, submissions, faucets, LP exits or recovery writes are offered.

With existing dependencies:

```sh
npm run dev
npm test
npm run build -- --outDir /tmp/otter-web-dist
```

The temporary build destination avoids changing the repository's tracked legacy
`dist/` output. Updating or publishing that output needs a separate release.
Do not present it as the hardened wallet build.

## Configuring a future research deployment

Deploying or operating a public instance is a separate step. Do not copy the
historical addresses into the hardened manifest or infer grant/production
readiness from the wallet checks. Canonical payments, integer IR, joint LP
incentives and concentrated auctions remain unresolved.

After a reviewed version 2 stack exists, replace the manifest's `deployment`
with this schema. Placeholders below are deliberately not a usable deployment:

```json
{
  "deployment": {
    "chainId": 11155111,
    "poolId": "<nonzero bytes32 pool ID>",
    "configVersion": "1",
    "rewardPolicyHash": "<nonzero bytes32 registered policy hash>",
    "contracts": {
      "orderBook": {"address": "<address>", "runtimeHash": "<bytes32>"},
      "settlement": {"address": "<address>", "runtimeHash": "<bytes32>"},
      "rewardLedger": {"address": "<address>", "runtimeHash": "<bytes32>"},
      "liquidityGuard": {"address": "<vault address>", "runtimeHash": "<bytes32>"}
    },
    "assets": [
      {"address": "<currency0>", "symbol": "<symbol>", "decimals": 18},
      {"address": "<currency1>", "symbol": "<symbol>", "decimals": 18}
    ]
  }
}
```

`runtimeHash` is keccak256 of reviewed **deployed runtime bytecode**, including
deployment-specific immutable substitutions. It is not the creation-code hash
or the hash of an arbitrary artifact before deployment. The manifest is the
local trust anchor and must come from independently reviewed deployment evidence;
observing a hash from an untrusted address and copying it supplies no assurance.
There is no environment-variable fallback or wallet-entered deployment selector.

Each action checks the RPC chain, all four code fingerprints, book domain/type
and snapshot version, pool registration/currencies/configuration/guard/policy,
settlement/book/ledger wiring, the vault's immutable book, and ERC20 decimals. Related reads use one block.
RPC responses are still trusted; this is not a deployment audit or a proof of
economic correctness. Wallet account and chain are checked again at signing,
simulation, broadcast and confirmation boundaries.

Assets are in currency0/currency1 address order. Zero currency0 means native ETH
with 18 decimals; currency1 must be ERC20. The current wallet accepts ERC20
metadata with 0–36 decimals. Protocol raw-unit limits still apply. Supported tokens
need stable, exact transfers; the manifest cannot make rebasing or taxed tokens
safe. No demo-token mint function is exposed against a newly configured asset.

## Submission and recovery

- Parse budgets exactly in the sold asset's units. Convert the human received
  asset/sold asset price to the contract's raw-unit WAD ask with both decimal
  counts. Reject unrepresentable precision; never round a trader's price.
- Approve only the budget to the checked book. If a smaller nonzero allowance
  exists, confirm a zero reset and then the budget. Confirm receipts and reread
  allowance before signing. Native ETH needs no approval and attaches exact value.
- Preview after approval. Sign the actual v2 fields, in contract order:
  `trader,poolId,sellingCurrency0,ask,budget,deadline,nonce,configVersion,epoch,maxExecutionTime`.
  Domain version is `2`. `deadline` is admission validity, not epoch expiry.
- Scan up to eight actual nonce words from a user-selected starting word. A failed
  read or full scan fails explicitly. Nonces are never guessed from word zero.
- Admission validity is at most 60 seconds. The signed execution cap is the
  preview boundary plus an explicit 60-second opening tolerance. Display the
  signed epoch/configuration/nonce and absolute limits. Recheck after signing;
  stale signatures fail without silently extending their limits.
- Simulate before sending. A hash means pending. Confirm a successful receipt,
  verify the actual sender/target/calldata/value, and require exactly one matching
  `OrderSubmitted` event before showing the epoch and stored index as admitted.
  Repricing is allowed; cancellation or a different replacement is not success.
- Inspect the **stored current epoch**, rather than an `openBatchId` preview that
  could invent a fresh countdown or revert when execution is pending. Distinguish
  all six states, including `Refundable` versus `Settled`. Show chain timestamps.
- Enter an older epoch and stored index to recover your order. Timeout expiry,
  fee invalidation, individual recovery and independent trader/reward withdrawals
  remain available when admission is paused. Failed delivery affects its own
  withdrawal. Use an alternate recipient when necessary.
- Withdraw whole or partial funded claims by source/currency. Invalidate a
  selected signature nonce in any word; this does not refund admitted escrow.

## LP exit and vault credits

Use the vault position ID from a deposit receipt for the configured pool. The
wallet reads ownership, pool ID, range ticks, liquidity, reserved exit and the
book's actual `isBatchActive` status at one checked block. It accepts only the
connected owner's position in that pool, including retained IDs after full removal.
It does not discover all positions or navigate arbitrary vault pools.

An owner can queue an exit during collection or execution. **The request is
irrevocable and has no token-output minimum.** The current batch may change the
principal before removal. The interface requires acknowledging this and displays
the exact liquidity units being authorized; liquidity is not a token amount.
There is one pending request per position. The API refreshes ownership/liquidity/
reservation before simulation, and requires one exact matching `ExitRequested`
event before reporting confirmation. UI reads become stale when the account,
network or position changes.

Process the reserved exit after settlement or expiry makes the pool idle. A
passed execution deadline alone is insufficient; use epoch expiry when needed.
Processing mints owner credits and invokes no beneficiary transfer. It precedes
new epoch admission and does not veto the current swap. The wallet requires a
matching `ExitProcessed` event and displays its actual credited amounts, rather
than a deposit-price estimate. The contract permits any caller to process a
request and always credits the position owner; this interface selects only the
connected owner's position.

Choose **Liquidity exit / fee credit** in recovery to withdraw vault principal
and harvested core fees, separately from trader credits and Otter historical
rewards. Balances aggregate the owner's credits per currency across vault
positions/pools, rather than belonging exclusively to the displayed position.
Read current balances, select either asset and an alternate recipient,
and withdraw a partial amount. Each vault withdrawal is limited to
`2^120 - 1` raw units; larger balances require multiple calls. Native claims use
the native currency address and no approval or attached ETH value. A blocked
recipient/asset affects only its claim. The wallet also refuses vault-credit
delivery to any of the four configured custody addresses, a conservative UI
restriction beyond the vault's nonzero-recipient check.

Each request, process and withdrawal is simulated and confirmed with the shared
wallet account/chain/transaction-intent checks. A hash is pending; failed or
unmatched confirmations must be inspected before retrying. Queueing does not
promise when processing will occur or guarantee a token amount or economic return.

## Local transaction history

Each wallet broadcast records its returned hash, account, Sepolia chain, target,
ETH value, method, calldata hash and local timestamp. A fingerprint of the entire
configured deployment keeps old manifests separate. **Raw calldata and reusable
order signatures are not stored.** Records use separate `localStorage` keys and
are visible only for the selected wallet and manifest. The 100-record history
does not silently evict older entries. Inspect and explicitly forget an old
record to free space; forgetting does not cancel, reverse or refund a transaction.

Storage must be readable and writable before starting a wallet flow and again
before each broadcast. Corrupt, unavailable or
full history prevents a new broadcast. If storage fails after the wallet returns
a hash, report that hash and retain the new intent in this tab where possible;
save it separately before closing. No action is automatically retried. This
cannot recover a broadcast if the tab closes before the wallet returns its hash,
nor compensate for erased/private browser storage or a different browser/origin.

Use **Check mined receipt** after a reload. This only reads the configured Sepolia
RPC. It checks sender, target, exact calldata hash and ETH value, transaction/
receipt block metadata against the returned block hash, then rereads the receipt
and chain to detect movement during inspection. It decodes only existing wallet
methods at configured contracts/assets. A submission needs one matching
`OrderSubmitted` event to recover its epoch and stored index. Those IDs identify
admission, not settlement, refund eligibility or a current claim balance. Other
actions show a matching mined receipt without reconstructing vault credit amounts
or the current epoch/position state. Refresh those panels independently.

Missing receipts remain unresolved: pending, dropped, cancelled or replaced
transactions can look alike at this RPC. RPC errors are reported separately.
Repricing discovered and verified during a live wait saves its observed receipt
hash. Replacement discovery after interruption/reload is not implemented. An
observed hash in editable local storage is not independently authenticated as a
replacement of the original nonce. Local records are untrusted display metadata
and never become a signing or sending request. Receipt responses still trust the
RPC, and a later reorg remains possible. Results are not cached as finality.

Storage events synchronize displayed history across tabs; separate keys prevent
unrelated transaction records overwriting each other. This does not serialize
other tabs' wallet actions, prevent duplicate manual sends or eliminate capacity
races at the record limit. The existing action lock operates within one tab.

## Read-only exact execution state preparation

`src/protocol/executionSnapshot.ts` exports `captureExecution(rpc, source,
request)`. It is a standalone research helper, not connected to the wallet UI or
deployment manifest. `source` specifies a BigInt chain ID, manager address,
reviewed runtime hash and full pool key. `request` specifies direction, BigInt raw
input/price limit and an optional BigInt block number. The caller supplies a
`SnapshotRpc` callback supporting only `eth_chainId`, `eth_getBlockByNumber`,
`eth_getCode` and `eth_call`. No default RPC URL, network adapter, wallet, signing,
sending or automatic retry is provided.

The pinned layout is core commit `e50237c43811bd9b526eff40f26772152a42daba`.
The manager runtime must match the caller-configured hash; that hash is a trust
input, not an independent audit. Code and storage reads require the selected
block's hash and `requireCanonical: true`, following
[EIP-1898](https://eips.ethereum.org/EIPS/eip-1898). Unsupported providers fail
instead of falling back to numbered/latest state. Before returning, the reader
rereads the selected numbered block and chain to reject detected changes.
Missing blocks, storage errors, malformed returns, inconsistent packed fields
and invalid reached tick liquidity also fail explicitly.

The exact BigInt reference requests missing records with structured errors. The
reader loads at most two header/liquidity slots, 16 bitmap words and 64 reached
initialized ticks (82 storage calls), retaining explicit empty words and signed
tick/net-liquidity data. Up to 81 bounded model replays leave the quote's math,
domain and statuses unchanged. Zero input is a model no-op; actual v4 public swaps
reject zero input. Only `Complete`/`PriceLimit` quote statuses are usable;
unsupported prefixes are diagnostics. The result includes block identity,
source/key/layout, sparse maps, quote and storage-read count.

Those maps cover **this request**, not a complete counterfactual curve. They do
not prove consensus, finality, opening ownership, epoch validity, fee/hook/token
delivery behavior or later execution. A trusted RPC can still lie and a later
reorg can still occur. The raw-core model supports the existing zero-fee domain;
arbitrary hooks remain outside it. The helper does not activate concentrated
auctions or choose a new mechanism under G1–G4.

`npm test` includes bounded mocked-RPC failure tests. For actual exported local
core storage and swap comparisons, run from `contracts/`:

```sh
forge test --offline --match-contract '^OtterSnapshotReaderTest$' --fuzz-runs 64
```

The FFI bridge uses existing Node/viem and an in-memory RPC with synthetic block
metadata. It uses no real provider, wallet or chain transaction. See
[checkpoint 4K](../reviews/CHECKPOINT_4K.md) for fresh results and limits.

`captureExecutionCurves(rpc, source, request)` reuses this pipeline to collect one
or two exhaustive research prefixes at the same block. `request.domains` contains
distinct directions, each with `down`, `maxInput` (BigInt 0–64) and one fixed raw
`limit`; `request.blockNumber` remains optional. Domains are cloned before awaits.
Each `curves[i].points[j]` is the exact quote for requested input `BigInt(j)` from
the shared opening state. Domain order is retained. Queries never advance the
pool or chain the previous point's terminal state into the next one.

There are at most 130 points, with a shared union of 32 bitmap words and 128
reached initialized ticks: at most 162 storage calls including the two header/
liquidity slots. Each quote retains its own 16-word, 64-crossing and 80-step
bounds even when the union already contains opposite-direction state. Code and
chain/block checks occur once per collection. Any failed state read or detected
block/chain change aborts the entire collection, without returning a first-side
partial table. At most 290 collection attempts add missing records or finish a
point, after the bounded representation checks before RPC work.

An exhaustive prefix is not a fully supported curve: inspect **each status and
actual consumed input**. `PriceLimit` rows can consume less than the requested
index, and unsupported rows remain unusable diagnostic prefixes. No row is
silently removed, extrapolated, interpolated or assigned a different status.
This 64-unit bound limits research work; it changes no production budget, minimum
trade size, asset, valuation or mechanism. Larger original budgets, complete
auction counterfactual domains and book/vault ownership authentication remain
open under G1–G4. All raw-RPC, finality, hook/token and epoch limits above still
apply. [Checkpoint 4L](../reviews/CHECKPOINT_4L.md) records fresh mocked and local
real-core checks, including the existing whole-payment witness's exact fills.

`bindOpeningExecution(anchor, record, frame)` in
[`openingExecution.ts`](./src/protocol/openingExecution.ts) is a pure content
validator for the **currently admitted full-range model**. The caller supplies
an independently authenticated `OpeningAnchor`, the stored `OpeningRecord`
and a captured curve frame at the anchor's read block. The anchor declares chain,
book, guard, pool, epoch, configuration, reward policy, snapshot hash and read
block number/hash. The record includes the complete bounded LP roster and
weights; its ABI matches the book's `OtterOpeningSnapshot/v2` commitment.

The validator checks that commitment and all identity fields, recomputes each
capital weight from rounded principal, and checks IDs, full-range endpoints and
liquidity totals. Same owners may hold several positions; individual zero weights
are retained when the total is positive. It binds the frame's key/manager/header
and read block, checks every cached word/tick against the deterministic two-endpoint
full-range schedule, and requotes every declared raw input. Fabricated tick data
is rejected even when its quotes agree with that fabricated schedule. Missing
visited records throw. Fee, numeric, roster and existing traversal/prefix bounds
remain unchanged; partial and unsupported rows retain their actual statuses.

The returned frozen object contains only declared primitive identity fields,
`positionsHash`, `weightsHash`, `snapshotHash`, `curvesHash` and `pointCount`.
`curvesHash` is keccak256 of ABI-encoded ordered curve domains and all ten quote
fields. It identifies that normalized table, not the RPC/cache/runtime history.
The result contains no frame or roster references and cannot certify a later
mutation of those inputs. `openingCommitment(record)` exposes the exact v2 hashes
with representation checks; it alone does not apply economic/domain validation.

This helper performs **no RPC or wallet action**. A forged anchor can be supplied
with a forged record. Real use still needs hash-pinned book/guard/hook/runtime
authentication and same-block reads, current lifecycle/deadline/configuration
checks, complete batch/counterfactual domains and execution revalidation. An old
record with matching old state is historical content, not current permission to
settle. Concentrated/mixed ranges are rejected, and the helper supplies no
canonical payment or incentive proof. The product UI does not invoke it and its
deployment manifest remains null. [Checkpoint 4M](../reviews/CHECKPOINT_4M.md)
records fresh mocked and actual local book/core comparisons, with synthetic
transport and block identity.

`captureEpochExecution(rpc, source, request)` in
[`epochSnapshot.ts`](./src/protocol/epochSnapshot.ts) composes that validator with
read-only epoch collection. Its separate research `EpochSource` declares a BigInt
chain/configuration, reward-policy hash, exact pool key and **five distinct
address/runtime fingerprints**: book, guard, hook, settlement and manager. These
are caller-configured trust inputs, not discovered or downloaded safe defaults.
The existing wallet manifest/ABI and interface are unchanged.

`request` specifies the stored epoch, intended settlement `caller`, one/two bounded
curve domains and an optional exact BigInt block number. All controls are copied
and validated before awaits. The helper selects one block number/hash/timestamp,
requires `blockHash`/`requireCanonical` for every code/view/storage read, verifies
all runtimes and checks registration, snapshot domain, configured currencies/
policy/version and book/guard/hook/settlement/manager wiring. Its 36 view calls
collect the opening record and stored hash, count/digest, lifecycle flags and
settlement exclusivity; successful book snapshot and vault batch-support assertions
are required. It does not call the admission assertion: a queued exit cannot veto
the current batch. Canonical ABI replies and bounded 1–32 dynamic arrays are
required, with array shape checked before decoding.

The epoch must be current, nonterminal, nonempty and unconsumed, with derived
state `Closed` and `closesAt <= blockTimestamp < executeUntil`. A non-solver caller
must also reach `closesAt + exclusivityWindow`; that endpoint is inclusive and
must precede expiry. A zero configured solver is supported after the public
window. This checks the **existing** rule; it does not remove solver exclusivity.
Admission pause is not a settlement veto. Historical/collecting/expired/consumed
records cannot be returned as currently eligible.

The same-block curve reader then runs through a wrapper that rejects an inner
block change before further state reads. The 4M validator checks commitments,
full-range schedule, weights and every curve row. Final block/hash/timestamp and
chain rechecks reject detected changes. There are at most 36 view calls, 162 core
storage calls, six code reads (the manager is checked twice) and eight metadata
queries: **212 RPC operations** under existing reader bounds, with no retries or
number/latest state fallback. This bounds requests, not provider latency; timeout/
cancellation behavior is still the adapter's responsibility.

The return contains `binding`, `record`, `frame` and frozen primitive `eligibility`
metadata (block timestamp, count/digest, caller, solver, exclusivity endpoint).
Record/frame maps and quotes remain mutable; do not treat a later-mutated frame
as certified by the returned hashes. Partial/unsupported rows remain diagnostic
even when epoch/caller timing is valid. No complete order replay/signature/escrow
balance check, canonical allocation/payment verification, token delivery, ledger
authentication, complete original-budget counterfactual domain, finality or future
execution promise is supplied. RPC can lie and fingerprints require independent
review/configuration. The UI does not invoke this helper; concentrated auctions
and G1–G4 remain gated. [Checkpoint 4N](../reviews/CHECKPOINT_4N.md) records local
mocked-RPC and actual-contract comparisons with synthetic transport/block metadata.

`captureEpochBatch(rpc, source, request)` in
[`epochBatch.ts`](./src/protocol/epochBatch.ts) extends that collector with the
complete stored 1–32-order batch. It uses the same source/request controls and
adds hash-pinned `eth_getBalance` for native custody. No HTTP adapter or signing/
sending method is supplied. It checks the book's EIP-712 name/version/BigInt-chain/
address domain and order type, every stored pool/configuration/epoch, admitted
numeric bounds, positive and per-side aggregate budgets, distinct trader/nonce
pairs and execution validity through `executeUntil`. The original order sequence
must reproduce the stored rolling digest; the book's `replay` must also succeed.
Admission deadlines may already have expired: they governed admission, not
settlement. The same nonce is valid for different traders. Nonce-word reads are
cached per trader/word; every order's bit must be present and recovery flag false.

For each currency, global `totalEscrow` must cover this batch's original side
budget, and the book's native/ERC20 balance must cover the checked sum of global
escrow and `totalClaimable`. Equality with the batch would incorrectly reject
other pools' custody. All added reads require the selected canonical block hash;
an extra final block/hash/timestamp/chain check rejects detected movement. At most
**288 RPC operations** follow the existing reader/batch bounds. There is no
retry, numbered-state fallback or partial successful result. Timeouts and
cancellation remain the supplied adapter's responsibility.

The result adds detached, frozen `orders`, a frozen two-entry `liabilities` array
and primitive `batchBinding` (opening binding plus count, orders hash, rolling
digest, domain separator and original side budgets). Its record/frame remain
mutable. `storedBatchCommitment` is a pure content validator; `storedBatchReads`
emits a bounded extra staticcall plan for local comparisons. `BATCH_ABI` is separate
from the wallet ABI. Stored-order arrays are bounded and shape-checked before
decoding; every reply must decode/reencode canonically.

Configured book code and RPC are still trusted. Historical signatures are not
retained or revalidated, and nonce presence alone does not prove authorization.
An ERC20 balance reply does not authenticate token behavior or future delivery.
Original uint96 budgets are preserved; the existing 0–64 curve prefixes supply
no complete original-budget/counterfactual proof. Canonical outcomes, incentives,
finality, later settlement and concentrated auctions remain unresolved. The UI
does not invoke this helper. See [checkpoint 4O](../reviews/CHECKPOINT_4O.md).

`inspectOpeningPrefixCoverage(anchor, record, frame, orders)` in
[`batchCoverage.ts`](./src/protocol/batchCoverage.ts) is a pure inventory of
original input coverage. Authenticate its 4O `batchBinding` anchor independently.
It revalidates mutable record/frame/order content against that binding and
inventories the original batch, omission of each record, and omission of all
records for each trader address. Those last two hypotheses deliberately remain
distinct; no participant or pivot-payment policy is selected. LP ownership and
opening state remain fixed in these inventory cases.

Each case preserves the retained original fields/order hash and sums original
side budgets. For both directions, it reports the represented prefix, exact
missing suffix, unsupported row indices and supported partial-consumption rows.
A represented partial quote is not full consumption; even a missing zero point
stays missing. Supported diagnostics outside a case's required prefix do not
veto that case. The original case cannot be promoted because smaller removal
cases happen to fit. All nested output arrays/entries are detached and frozen.
The normalized, versioned `coverageHash` binds input context and inventories.

`requireWholeInputOpeningPrefixes` re-evaluates those inputs and rejects any
missing, unsupported or partial required row before whole-input experiments.
It accepts no saved report flag as proof. At most 65 cases scan already bounded
tables; original uint96 demands are counted exactly without Number coercion or
enumeration. No additional RPC is made and the 0–64 work bound is unchanged.
Passing this conservative data precondition supplies no optimization, canonical
payments, participant guarantee, sequential/netting trace, current custody/
lifecycle recheck, finality or later settlement promise. It is not wired into
the UI or production settlement. [The requirements](../reviews/ORIGINAL_DOMAIN_REQUIREMENTS.md)
state the remaining mechanism/witness obligations; [checkpoint 4P](../reviews/CHECKPOINT_4P.md)
records the local comparisons. G1–G4 and concentrated auction gates remain open.

## Stored-batch one-sided pivot research

`researchBoundOneSidedBatch` in [boundResearch.ts](./src/protocol/boundResearch.ts)
revalidates the same authenticated batch/opening inputs and requires complete,
supported, fully consumed original prefixes in both directions, including the
explicit zero rows. It derives the sole trading direction from all original
orders and refuses mixed batches. It accepts at most eight original records,
0–64 whole raw input units and 100,000 original Cartesian budget vectors. Those
are laboratory work bounds, not a production trade-size or admission policy.
Large quantities are rejected rather than clipped, sampled or rescaled.

The fixed original table is shared by the original batch and every single-record
and whole-address removal. Retained signed fields/budgets are unchanged. Exact
linear welfare, quantity and ask/order-hash ties match independent scan and
Cartesian optimizers in every case. The output preserves retained identities,
allocations, exact WAD-scaled pivot numerators, floor/ceil/minimum diagnostics,
unspent inputs and signed deficits. Address diagnostics also retain the sum of
original per-record whole-unit minima; an aggregate minimum cannot replace it.
All result objects/nested arrays are detached and frozen. The versioned
`researchHash` binds the coverage hash and normalized result, without granting
settlement authority. Input frames must still be revalidated when reused.

Actual book/core comparisons expose integer funding and per-record delivery
failures. Record and address pivots are separate hypotheses; address grouping
neither proves beneficial ownership nor supplies a policy for distributing a
group payment. No two-sided objective, sequential/netting trace, new LP utility,
subsidy, fractional asset, guarantee-preserving mechanism or scalable verifier
is supplied. The pure API makes no RPC/custody/lifecycle/signature recheck, and
the UI does not call it. See [checkpoint 4Q](../reviews/CHECKPOINT_4Q.md) for exact
witnesses and the synthetic-transport boundary. G1–G4 and concentrated auction
gates remain open.

## Complete small-domain signed minimum feasibility

`inspectSignedMinimumFeasibility` in
[minimumFeasibility.ts](./src/protocol/minimumFeasibility.ts) recomputes the bound
4Q research from the original authenticated inputs; a saved result/hash is not
accepted. Its full-input, one-sided, eight-record, 64-raw-unit and 100,000-vector
research bounds and refusal behavior are unchanged. It adds no RPC or UI action.

For each original/record/address-removal case and every reachable retained input
quantity, a quantity dynamic program minimizes `sum(ceil(ask_i * fill_i / WAD))`.
Separate Cartesian enumeration must agree. Ties use lower exact report cost,
then greater fill in ascending ask/order-hash priority. Each row keeps its aligned
fill, actual opening output, exact cost, signed welfare, aggregate minimum,
original per-record minimum sum, deficit and numeric feasibility flag. The
original table/price limit and retained quantities remain fixed across cases.

The result distinguishes whether the 4Q welfare fill meets original minimums,
whether a different fill at the same input can meet them, and whether any positive
input/positive output allocation meets them. An unfunded pivot can have a feasible
fill; some positive-ask split batches have no positive-output feasible fill.
Minimizing whole-unit payouts can select higher exact report cost and lower
welfare. This is a delivery diagnostic, not maximization of welfare on a new
feasible set or a payment/participant policy. Treating it as such needs separate
incentive and allocation proofs. No grouped delivery or aggregate IR replaces
original per-record checks.

All nested results are frozen. The versioned `minimumHash` binds the normalized
frontier to the recomputed 4Q research hash, without creating an accepted on-chain
witness. Numeric feasibility concerns exact integer output backed only by the
represented one-sided single swap, before extra fees/rewards. It supplies no
future token delivery, lifecycle/custody/signature recheck, finality or current
execution permission. [Checkpoint 4R](../reviews/CHECKPOINT_4R.md) records exact
witnesses, actual-core comparisons and trust/model limits. G1–G4 and concentrated
auction gates remain open.

## Evidence and remaining work

`npm test` runs offline mocked-RPC/wallet failure tests and checks the ABI subset
against local Foundry artifacts. In `contracts/`, run:

```sh
forge test --offline --match-contract OtterWalletEncodingTest --fuzz-runs 64
```

This cross-checks the actual browser hash/signature helper with Solidity, including
the reverse side and maximum fields. Its private key is a public test fixture.
No real wallet, RPC transaction or deployment is used by these tests.

One confirmation is a mined receipt, not reorg-proof finality. Local history now
supports receipt inspection across reloads. Robust indexing/reorg handling,
replacement discovery after interruption, demonstrated contract
wallet/EIP-1271 connector flows, LP deposits/discovery and cross-pool navigation,
automated exit processing, concentrated batch execution,
public solver operation and testnet end-to-end evidence remain unfinished. Save
admission IDs and inspect any broadcast transaction before retrying after an error.
See [checkpoint 7A](../reviews/CHECKPOINT_7A.md).
The local exit interface and fresh validation are recorded in
[checkpoint 7B](../reviews/CHECKPOINT_7B.md). Its visual preview uses synthetic
state and disabled writes; it is not a real wallet connection or live deployment.
History, storage and receipt failure tests and the isolated synthetic browser
preview are recorded in [checkpoint 7C](../reviews/CHECKPOINT_7C.md).


## Bound finite ask-response research

`src/protocol/reportMenu.ts: inspectBoundAskResponses` takes 1–16 freshly
revalidated complete small one-sided profiles and an original target index.
Only that record's reported ask may change: original budget, identity, nonce,
clocks, other orders, opening/curve/block/runtime context and order sequence
remain fixed. The target must have exactly one original record and no direct
opening LP position under this diagnostic's single-role hypothesis. This is
not production admission policy or authentication of beneficial control/aliases.

Each profile recomputes 4Q and retains chosen input, original per-record minima,
actual output, candidate ceil pivot and funding deficit. The existing integer
transfer checker returns a finite necessary payment certificate or a closed
negative cycle, which is checked before returning. A loose check uses lower 0
and the existing raw output representation ceiling. A tighter necessary check
uses the target's signed minimum and the room remaining after the other
original minima. If those other minima already exceed output, the funded check
is explicitly unavailable (kind 0); its zero-room sentinel is not a funded
zero-payment result. Kind 1 only satisfies these finite target inequalities;
kind 2 has a checked infeasibility certificate. Other traders' truthful payments,
extra rewards/obligations and full type spaces are not proved.

The actual native/core full-range liquidity-2 example covers original input
0–4 completely. Efficient target inputs change from 2 to 0 between asks WAD/16
and 3WAD/16 with a fixed budget-2 rival at WAD/8. Every selected fill meets all
signed minima and the ceil pivots are funded, yet even loose integer
truthfulness has a truthfulness-only negative cycle. No integral transfer
assignment implements those fill responses. A constant-fill reverse-currency
example passes the finite inequalities without proving a complete mechanism.

The normalized `OtterBoundAskResponse/v1` ABI hash binds context, fixed report
fields, all profile diagnostics and certificates. Results are detached/frozen;
input content is rechecked on each call. Caller-authenticated anchors, book code,
source and RPC remain trust inputs. The UI does not call the helper, and a hash
is not an accepted settlement witness or permission to transact. The test-only
`--menu` bridge reuses complete batch capture in isolated alternative fixture
worlds, with synthetic block identity and no real RPC. Per-profile payload,
record/vector and prefix bounds remain in force. See [4S](../reviews/CHECKPOINT_4S.md)
for checks, exact witness, model limits and the commit handoff. G1–G4 and the
concentrated auction gates remain open; production numerical/asset/minimum
policies are unchanged.
