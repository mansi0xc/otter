# Otter research dashboard and hardened wallet

Vite + React + TypeScript with wagmi/RainbowKit. The guided story uses historical
fixtures. The September Sepolia addresses in `src/config/contracts.ts` are
explorer references only. No public solver or hardened deployment is configured.
The default `src/config/deployment.json` contains `{"deployment":null}`: no
order approvals, signatures, submissions, faucets or recovery writes are offered.

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
settlement/book/ledger wiring, and ERC20 decimals. Related reads use one block.
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

## Evidence and remaining work

`npm test` runs offline mocked-RPC/wallet failure tests and checks the ABI subset
against local Foundry artifacts. In `contracts/`, run:

```sh
forge test --offline --match-contract OtterWalletEncodingTest --fuzz-runs 64
```

This cross-checks the actual browser hash/signature helper with Solidity, including
the reverse side and maximum fields. Its private key is a public test fixture.
No real wallet, RPC transaction or deployment is used by these tests.

One confirmation is a mined receipt, not reorg-proof finality. Pending transaction
recovery across reloads, robust indexing/reorg handling, demonstrated contract
wallet/EIP-1271 connector flows, LP deposits/exits, concentrated batch execution,
public solver operation and testnet end-to-end evidence remain unfinished. Save
admission IDs and inspect any broadcast transaction before retrying after an error.
See [checkpoint 7A](../reviews/CHECKPOINT_7A.md).
