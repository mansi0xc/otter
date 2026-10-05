# Checkpoint 7A — checked v2 wallet and individual recovery

Prepared 5 October 2026. Starting commit: `8517538`. The working tree was clean.
Status: **committed by the user as `2c24344`; clean tree inspected before 8A**.
The commit handoff below is retained as the historical record of this checkpoint.

## Outcome

The old wallet signed version 1 orders against the September deployment, guessed
nonce 256 after exhausting word zero, accepted rounded decimal input, used a
local-clock deadline unrelated to the signed epoch, and marked a returned hash as
a completed approval/submission. Its compatibility batch boolean could not
distinguish expiry from successful settlement. The UI also presented proof and
capacity claims beyond the current contracts.

The replacement uses the actual v2 tuple/domain and separates historical explorer
references from a reviewed deployment manifest. **The manifest is null by default;
all transaction controls are absent. No hardened stack was deployed or configured.**
No Solidity production code, mechanism/redistribution policy, solver, dependency,
saved economic fixture or published legacy build was changed.

This wallet work is independent of selecting an asset/curve/utility redesign.
The user's guarantee priority remains unchanged. It does not complete steps 4–7
or resolve G1–G4, R2's solver discretion or R6's minority IR issue.

## Controls implemented

1. Validate the Sepolia manifest, distinct addresses, ordered asset currencies,
   supported decimals and string-encoded configuration version. Check deployed
   runtime fingerprints for book/settlement/reward ledger/vault, domain and type
   hashes, snapshot version, registered configuration/currencies/policy and
   contract wiring. Related RPC reads share a block. Mismatches fail before writes.
2. Parse decimals exactly and convert human prices using both assets' decimal
   counts. Reject excessive precision and amount limits; no price rounding.
   Native ETH never targets an ERC20 approve/mint function.
3. Grant only the budget allowance, confirm any required zero reset and approval,
   reread allowance, then preview the current epoch. Read up to eight actual nonce
   words starting at the selected word; never guess a free bit or use a failed read.
4. Bind signatures to trader/pool/direction/ask/budget/admission deadline/nonce/
   configuration/epoch/execution cap under domain version 2. Admission validity is
   at most 60 seconds; the displayed execution cap includes a fixed 60-second
   tolerance for first-order opening. Recheck timing, epoch and nonce after signing
   without extending the signature. The contract still rejects stale mined calls.
5. Recheck account/network at signing, simulation, broadcast and result boundaries.
   Serialize writes across both panels in this tab. Simulate before sending. A
   hash remains pending; confirmation requires success and actual sender/target/
   calldata/value matching the requested action. Accept repricing; reject changed
   replacements/cancellation. Admission additionally requires one matching event
   and retains its stored epoch/index for the user to save.
6. Display the actual current stored epoch and all six states, without treating
   a hypothetical opening preview as a live countdown. Historical epochs remain
   inspectable. Expose timeout expiry, authenticated fee invalidation, own-record
   recovery, partial trader/reward claims in either currency to an alternate
   recipient, and single-nonce invalidation in any word. Recovery creates a credit;
   withdrawal is separate. Admission pause does not remove these controls.
7. Remove the historical mint/write path. Label explorer links, fixture outcomes
   and old gas data as historical. Replace proven-truthfulness/IR promises with
   the known canonical-payment, integer and combined-role limits. Current caps
   are 32 orders and 32 opening LP positions, not the old 630-order benchmark.

The manifest is a local trust anchor, not an audit: fingerprints must come from
reviewed deployment evidence, including immutable substitutions. An untrusted
RPC or operator-chosen hash does not independently authenticate an implementation.
See [wallet configuration and semantics](../web/README.md).

## Validation

- `web/: npm test`: **21 offline test groups passed**. Cover ABI correspondence
  with local Foundry artifacts, default/invalid manifests, decimal and numeric
  limits, every nonce bit across four representative words including uint256 max,
  domain/code/wiring/network failures, reset/confirmed approvals, native and
  reverse-side orders, stale epoch/timing/nonce, account switches, pause, simulation
  failures, reverted/unmatched/duplicate admission events, refundable state,
  timeout/fee recovery, ownership, partial claims, delivery failure, invalidation,
  actual viem replacement handling and confirmed transaction intent.
- `contracts/: forge test --offline --match-contract OtterWalletEncodingTest
  --fuzz-runs 64`: **2 contract tests passed**. Compare the actual browser helpers'
  struct hashes, v2 digests and recoverable low-s signatures against the Solidity
  book in 64 fuzz cases plus reverse-side maximum fields. FFI uses a public test
  key, no live wallet or RPC. The previous broad 6B contract baseline was 301
  passing tests; it was not rerun because production Solidity is unchanged.
- `web/: npm run build -- --outDir /tmp/otter-7a-web-dist`: TypeScript and production
  build passed. Vite still warns about the large wallet bundle; no dependencies
  were installed/upgraded. The tracked historical `web/dist/` is unchanged.
- Local browser smoke check: corrected research claims and historical labels
  render; the unconfigured sandbox displays one disabled notice and no transaction
  controls. No console errors were observed. No wallet was connected or transaction
  sent. Screenshot: `/tmp/otter-7a-wallet-disabled.jpg` (temporary review artifact).
- Whitespace, local Markdown targets, exact handoff list, unchanged HEAD/empty
  index, production/fixture/build/dependency preservation checked at handoff.

Logs: `/tmp/otter-7a-wallet.log`, `/tmp/otter-7a-forge.log`,
`/tmp/otter-7a-build.log`. Local preview server stopped after inspection.

## Material limits and next work

One confirmation is a mined receipt, not reorg-proof finality. Pending transaction
recovery across reloads and persistent indexing are unfinished. Store admission
IDs and inspect a broadcast transaction before retrying. Contract EIP-1271
admission exists, but real contract-wallet connector/signing/submission/withdrawal
flows are not demonstrated by these offline tests. LP deposit/exit controls and
concentrated auctions remain unfinished. The wallet accepts decimals 0–36 and
still requires stable exact-transfer assets. No public solver, new deployment,
external audit or grant acceptance is demonstrated.

Continue the guarantee-preserving asset/curve/utility and joint redistribution
design described in [6C](./CHECKPOINT_6C.md) and
[the proposal](./REDISTRIBUTION_DESIGN.md). Do not adopt fractional claims,
restricted valuation grids, new subsidies or current-pot routing merely to unblock
the UI. G1–G4 require a complete compatible rule and independent mechanism review.

## User-created commit handoff

Suggested title:

```text
fix: migrate wallet to checked v2 signing and recovery
```

Suggested explanation:

> Replace legacy wallet writes with deployment checks, exact amounts, epoch-bound
> v2 signatures and confirmed receipts. Add native/ERC20 recovery and funded claim
> controls, and correct prototype guarantee and benchmark claims. Keep writes
> disabled until a reviewed hardened deployment is configured.

The assistant has not staged or committed anything. Commit the following files,
including the removed obsolete mint hook, then confirm before work continues.

```text
README.md
contracts/test/OtterWalletEncoding.t.sol
reviews/CHECKPOINT_7A.md
reviews/IMPLEMENTATION_SPEC.md
reviews/REMEDIATION_PLAN.md
web/README.md
web/index.html
web/package.json
web/src/App.tsx
web/src/components/GasChart.tsx
web/src/components/Header.tsx
web/src/components/HomePage.tsx
web/src/components/OrderComposer.tsx
web/src/components/OutcomePanel.tsx
web/src/components/ProofRail.tsx
web/src/components/RecoveryPanel.tsx
web/src/components/SepoliaStatus.tsx
web/src/config/contracts.ts
web/src/config/deployment.json
web/src/config/deployment.ts
web/src/hooks/useBatchStatus.ts
web/src/hooks/useMintTokens.ts
web/src/hooks/useSubmitOrder.ts
web/src/hooks/useWalletActions.ts
web/src/protocol/abi.ts
web/src/protocol/client.ts
web/src/protocol/deployment.ts
web/src/protocol/orders.ts
web/src/protocol/viemTransport.ts
web/test/hash-order.ts
web/test/protocol.test.ts
```

Total: **31 files**, including one deletion.
