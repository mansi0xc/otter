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
